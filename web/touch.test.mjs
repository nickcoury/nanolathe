import test from 'node:test';
import assert from 'node:assert/strict';
import {createTouchPointer, longPressMillis, clickHoldMillis, parkMillis} from './touch.js';

function fixture() {
  let now = 0, id = 0;
  const timers = new Map(), mouse = [], feedback = [];
  class MouseEvent { constructor(type, init) { Object.assign(this, init, {type}); } }
  const win = {
    MouseEvent,
    setTimeout(fn, delay) { timers.set(++id, {fn, at:now + delay}); return id; },
    clearTimeout(timer) { timers.delete(timer); },
  };
  const target = {dispatchEvent(event) { mouse.push([event.type, event.button, event.clientX, event.clientY]); }};
  const pointer = createTouchPointer(win, event => feedback.push(event.kind));
  // Advance virtual time, letting queued promise steps settle between timers.
  const advance = async millis => {
    const until = now + millis;
    for (;;) {
      await new Promise(resolve => setImmediate(resolve));
      const next = [...timers].sort((a,b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > until) break;
      timers.delete(next[0]); now = next[1].at; next[1].fn();
    }
    now = until; await new Promise(resolve => setImmediate(resolve));
  };
  const point = (x, y, identifier = 1) => ({identifier, clientX:x, clientY:y});
  return {pointer, target, mouse, feedback, advance, point};
}
const buttons = mouse => mouse.filter(([type]) => type !== 'mousemove');

test('a tap is a left click held across a frame, then the pointer parks off canvas', async () => {
  const f = fixture();
  f.pointer.begin(f.target, f.point(100, 50));
  f.pointer.move(f.point(104, 53)); // within slop
  f.pointer.end(f.point(104, 53));
  await f.advance(clickHoldMillis - 1);
  assert.deepEqual(buttons(f.mouse), [['mousedown', 0, 100, 50]]);
  await f.advance(1);
  assert.deepEqual(buttons(f.mouse), [['mousedown', 0, 100, 50], ['mouseup', 0, 100, 50]]);
  await f.advance(parkMillis);
  const [type, , x, y] = f.mouse.at(-1);
  assert.equal(type, 'mousemove'); assert.ok(x < -1000 && y < -1000);
  assert.deepEqual(f.feedback, ['down', 'up']);
});

test('moving past the slop is a left drag from the touch origin', async () => {
  const f = fixture();
  f.pointer.begin(f.target, f.point(100, 100));
  f.pointer.move(f.point(130, 140));
  f.pointer.move(f.point(160, 170));
  await f.advance(longPressMillis * 2); // a drag never becomes a hold
  f.pointer.end(f.point(160, 170));
  await f.advance(clickHoldMillis);
  assert.deepEqual(f.mouse.slice(0, 4), [['mousemove', 0, 100, 100], ['mousedown', 0, 100, 100],
    ['mousemove', 0, 130, 140], ['mousemove', 0, 160, 170]]);
  assert.deepEqual(buttons(f.mouse), [['mousedown', 0, 100, 100], ['mouseup', 0, 160, 170]]);
});

test('a still hold is the right button, which can then drag', async () => {
  const f = fixture();
  f.pointer.begin(f.target, f.point(40, 40));
  await f.advance(longPressMillis);
  assert.deepEqual(buttons(f.mouse), [['mousedown', 2, 40, 40]]);
  f.pointer.move(f.point(60, 45));
  f.pointer.end(f.point(60, 45));
  await f.advance(clickHoldMillis);
  assert.deepEqual(buttons(f.mouse), [['mousedown', 2, 40, 40], ['mouseup', 2, 60, 45]]);
  assert.deepEqual(f.feedback, ['down', 'hold', 'up']);
});

test('a second finger before any press sends nothing', async () => {
  const f = fixture();
  f.pointer.begin(f.target, f.point(10, 10));
  f.pointer.cancel();
  await f.advance(longPressMillis + parkMillis);
  assert.deepEqual(buttons(f.mouse), []);
});

test('a second finger during a drag releases where the finger is', async () => {
  const f = fixture();
  f.pointer.begin(f.target, f.point(10, 10));
  f.pointer.move(f.point(50, 50));
  f.pointer.cancel();
  await f.advance(clickHoldMillis);
  assert.deepEqual(buttons(f.mouse), [['mousedown', 0, 10, 10], ['mouseup', 0, 50, 50]]);
});

test('a quick double tap keeps both clicks in order at the same point', async () => {
  const f = fixture();
  for (let i = 0; i < 2; i++) { f.pointer.begin(f.target, f.point(70, 80, i)); f.pointer.end(f.point(70, 80, i)); }
  await f.advance(clickHoldMillis * 2);
  assert.deepEqual(buttons(f.mouse), [['mousedown', 0, 70, 80], ['mouseup', 0, 70, 80],
    ['mousedown', 0, 70, 80], ['mouseup', 0, 70, 80]]);
});
