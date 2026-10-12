// Browser host policy (DESIGN_BROWSER_HOST §4 contract 8). DOM wheel units describe
// units, not devices: pixel wheels pan, including mice reporting pixels.
const wheelQuietMillis = 180;
const wheelPinchPixels = 200; // matches the camera's logarithmic sensitivity of 2
const pinchSensitivity = 2;
import {createTouchPointer} from './touch.js';

export function installBrowserGestures(win, emit, feedback) {
  let wheelActive = false, wheelTimer, wheelAt, pair, multi = false;
  const pointer = createTouchPointer(win, feedback);
  const listeners = [];
  const listen = (type, handler) => {
    win.addEventListener(type, handler, {capture:true, passive:false});
    listeners.push([type, handler]);
  };
  const pinch = (at, delta = 0, began = false, ended = false, cancelled = false) =>
    emit({kind:'pinch', atX:at.x, atY:at.y, delta, began, ended, cancelled});
  const endWheel = (cancelled = false) => {
    win.clearTimeout(wheelTimer);
    if (wheelActive) pinch(wheelAt, 0, false, !cancelled, cancelled);
    wheelActive = false;
  };
  const canvasEvent = event => event.target?.tagName === 'CANVAS';
  const consume = event => { event.preventDefault(); event.stopPropagation(); };

  listen('wheel', event => {
    if (!canvasEvent(event)) return;
    // Full-window tools read Ebiten.Wheel directly; the battle collector
    // ignores its parallel copy. Keep propagation while preventing page zoom.
    event.preventDefault();
    if (win.nanolatheBrowserGestureEnabled === false) return;
    const at = {x:event.clientX, y:event.clientY};
    if (event.ctrlKey) {
      // Chromium exposes trackpad pinch as Ctrl-wheel and supplies no lift
      // event. Retire a burst after a quiet interval, or when focus is lost.
      const pixels = event.deltaMode === 1 ? event.deltaY * 16 :
        event.deltaMode === 2 ? event.deltaY * win.innerHeight : event.deltaY;
      wheelAt = at;
      pinch(at, -pixels / wheelPinchPixels, !wheelActive);
      wheelActive = true;
      win.clearTimeout(wheelTimer);
      wheelTimer = win.setTimeout(() => endWheel(), wheelQuietMillis);
    } else {
      endWheel();
      emit({kind:'wheel', x:-event.deltaX, y:-event.deltaY,
        pixels:event.deltaMode === 0, atX:at.x, atY:at.y});
    }
  });

  const touches = event => {
    if (!canvasEvent(event)) return;
    if (event.type === 'touchstart') event.target.focus();
    // Touch never reaches Ebitengine's own touch state, which the engine
    // does not read. One finger is the mouse pointer (touch.js) on every
    // screen; two fingers are camera gestures where the battle admits them.
    consume(event);
    endWheel();
    const points = Array.from(event.touches).sort((a,b) => a.identifier-b.identifier);
    const cancelled = event.type === 'touchcancel';
    if (points.length >= 2 || cancelled) { multi = multi || points.length >= 2; pointer.cancel(); }
    if (!multi) {
      const changed = event.changedTouches[0];
      if (event.type === 'touchstart' && points.length === 1) pointer.begin(event.target, points[0]);
      else if (event.type === 'touchmove' && points.length === 1) pointer.move(points[0]);
      else if (event.type === 'touchend' && changed) pointer.end(changed);
      return;
    }
    if (!points.length) multi = false;
    if (win.nanolatheBrowserGestureEnabled === false) { pair = undefined; return; }
    if (points.length !== 2 || cancelled) {
      if (pair) pinch(pair, 0, false, !cancelled, cancelled);
      pair = undefined;
      return;
    }
    const [a,b] = points;
    const next = {x:(a.clientX+b.clientX)/2, y:(a.clientY+b.clientY)/2,
      distance:Math.hypot(b.clientX-a.clientX, b.clientY-a.clientY),
      ids:[a.identifier,b.identifier]};
    if (!pair || pair.ids.some((id,i) => id !== next.ids[i])) {
      if (pair) pinch(pair, 0, false, false, true);
      pinch(next, 0, true);
    } else {
      emit({kind:'pan', x:next.x-pair.x, y:next.y-pair.y, atX:next.x, atY:next.y});
      if (pair.distance > 0 && next.distance > 0) {
        pinch(next, Math.log(next.distance/pair.distance) / pinchSensitivity);
      }
    }
    pair = next;
  };
  for (const type of ['touchstart','touchmove','touchend','touchcancel']) listen(type, touches);
  const cancel = () => {
    endWheel(true);
    pointer.cancel(); multi = false;
    if (pair) pinch(pair, 0, false, false, true);
    pair = undefined;
  };
  listen('blur', cancel);
  win.nanolatheBrowserCancelGestures = cancel;
  // Touch never moves Ebitengine's mouse cursor. Keep the gesture midpoint
  // through idle polls, then hand position straight back to mouse input.
  for (const type of ['mousemove','mousedown','mouseup']) listen(type, event => {
    if (win.nanolatheBrowserGestureEnabled !== false) {
      emit({kind:'pointer', atX:event.clientX, atY:event.clientY});
    }
  });
  return () => {
    cancel();
    delete win.nanolatheBrowserCancelGestures;
    for (const [type, handler] of listeners) win.removeEventListener(type, handler, true);
  };
}
