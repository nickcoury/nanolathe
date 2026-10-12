// Single-finger touch as mouse input (mobile host policy). The engine reads
// only Ebitengine's mouse state, so one finger drives the ordinary pointer:
// a tap is a left click, a drag is a left drag (rubber band, sliders), and a
// press held still is a right button (deselect, cancel, minimap camera drag,
// subtract from a factory queue). Two-finger camera gestures stay in
// gestures.js; this module only sees gestures that never had a second finger.
export const tapSlopPixels = 10;
export const longPressMillis = 380;
// Ebitengine samples button state once per Update. A press and release in
// the same frame would never be seen, so a tap holds the button this long.
export const clickHoldMillis = 70;
// After a gesture the cursor leaves the canvas. A parked pointer must not sit
// on a screen edge (edge scrolling) or over a unit (hover).
export const parkMillis = 400;
const parked = -100000;

export function createTouchPointer(win, onFeedback = () => {}) {
  let touch = null, chain = Promise.resolve(), parkTimer, epoch = 0;
  const later = millis => new Promise(resolve => win.setTimeout(resolve, millis));
  const mouse = (target, type, button, x, y) => {
    const buttons = type === 'mouseup' ? 0 : button === 2 ? 2 : button === 0 && type !== 'mousemove' ? 1 : 0;
    target.dispatchEvent(new win.MouseEvent(type, {bubbles:true, cancelable:true, view:win,
      clientX:x, clientY:y, screenX:x, screenY:y, button, buttons}));
  };
  // Each gesture's mouse events run in order, after the previous gesture's.
  const queue = step => { chain = chain.then(step).catch(() => {}); return chain; };
  const park = target => {
    win.clearTimeout(parkTimer);
    const at = epoch;
    parkTimer = win.setTimeout(() => queue(() => { if (at === epoch) mouse(target, 'mousemove', 0, parked, parked); }), parkMillis);
  };
  const press = (button, at) => {
    const {target} = touch;
    touch.button = button;
    queue(() => { mouse(target, 'mousemove', 0, at.x, at.y); mouse(target, 'mousedown', button, at.x, at.y); });
  };
  const begin = (target, point) => {
    epoch++; win.clearTimeout(parkTimer);
    touch = {target, id:point.identifier, start:{x:point.clientX, y:point.clientY}, last:{x:point.clientX, y:point.clientY}, button:null};
    const current = touch;
    current.timer = win.setTimeout(() => {
      if (touch !== current || current.button !== null) return;
      press(2, current.last);
      onFeedback({kind:'hold', x:current.last.x, y:current.last.y});
    }, longPressMillis);
    onFeedback({kind:'down', x:point.clientX, y:point.clientY});
  };
  const move = point => {
    if (!touch || point.identifier !== touch.id) return;
    const at = {x:point.clientX, y:point.clientY};
    touch.last = at;
    if (touch.button === null) {
      if (Math.hypot(at.x - touch.start.x, at.y - touch.start.y) < tapSlopPixels) return;
      win.clearTimeout(touch.timer);
      press(0, touch.start);
      onFeedback({kind:'drag'});
    }
    const {target} = touch;
    queue(() => mouse(target, 'mousemove', 0, at.x, at.y));
  };
  const end = point => {
    if (!touch || (point && point.identifier !== touch.id)) return;
    const current = touch; touch = null;
    win.clearTimeout(current.timer);
    const {target} = current, at = point ? {x:point.clientX, y:point.clientY} : current.last;
    if (current.button === null) {
      if (!point) { onFeedback({kind:'up'}); return; } // cancelled before anything was pressed
      queue(async () => {
        mouse(target, 'mousemove', 0, current.start.x, current.start.y);
        mouse(target, 'mousedown', 0, current.start.x, current.start.y);
        await later(clickHoldMillis);
        mouse(target, 'mouseup', 0, current.start.x, current.start.y);
      });
    } else {
      const button = current.button;
      queue(async () => { await later(clickHoldMillis / 2); mouse(target, 'mouseup', button, at.x, at.y); });
    }
    onFeedback({kind:'up'});
    park(target);
  };
  // A second finger turns the touch into a camera gesture. A press that had
  // not yet been sent is dropped; one already sent is released where it is.
  const cancel = () => {
    if (!touch) return;
    if (touch.button === null) {
      win.clearTimeout(touch.timer); const target = touch.target; touch = null;
      onFeedback({kind:'up'}); park(target);
    } else end(null);
  };
  return {begin, move, end, cancel, get active() { return touch !== null; }};
}

// A ring under the finger shows a pending press; it turns amber once the
// hold has become the right button.
export function touchFeedback(doc) {
  const ring = doc.createElement('div');
  ring.style.cssText = 'position:fixed;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;' +
    'border:2px solid rgba(158,219,190,.85);pointer-events:none;display:none;z-index:10;transition:transform .3s';
  doc.body.append(ring);
  return event => {
    if (event.kind === 'down') {
      Object.assign(ring.style, {left:event.x + 'px', top:event.y + 'px', display:'block',
        borderColor:'rgba(158,219,190,.85)', background:'none', transform:'scale(1)'});
    } else if (event.kind === 'hold') {
      Object.assign(ring.style, {borderColor:'#f0b44c', background:'rgba(240,180,76,.25)', transform:'scale(1.3)'});
    } else ring.style.display = 'none';
  };
}
