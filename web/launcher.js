import {demoManifest, loadDemo, importedContent, officialDemoManifest} from './content.js';
import {BrowserHost} from './host.js';
import {BrowserStorage} from './storage.js';
import {collectEntry} from './folder.js';

const $ = id => document.getElementById(id);
let content = null, manifest = null, storage = null, storageEpoch = 0, loading = null, launching = false, launchEpoch = 0;
let measurement = null, profiling = false, pendingMeasureTick = null, activeConfig = null, performanceRuns = [];
let storedURLs = [], heapURL, measurementsURL;
const failedWrites = new Map();
// Touch devices get the full-viewport landscape player (mobile host policy).
// ?touch=1 or ?touch=0 overrides the detection.
const touchParam = new URLSearchParams(location.search).get('touch');
const mobile = touchParam ? touchParam === '1' : matchMedia('(pointer: coarse)').matches;
document.body.classList.toggle('mobile', mobile);
const setStatus = text => { $('status').textContent = text; };
const appendLog = text => { $('log').textContent = ($('log').textContent + text + '\n').slice(-40000); };
const host = new BrowserHost($('game'), (type, payload) => {
  if (type === 'status') setStatus(payload);
  if (type === 'log') appendLog(payload);
  if (type === 'storage') refreshStorage();
  if (type === 'persistence') persistence(payload);
  if (type === 'sample') sample(payload);
  if (type === 'profile') profileReady(payload);
  if (type === 'stopped') { retireView(); measurement = null; profiling = false; pendingMeasureTick = null; diagnostics(false); setStatus(payload); }
});
const modulePromise = () => host.compiledModule();
// Begin the Wasm download and compilation at the first sign of intent, so the
// demo click finds the module already compiling.
for (const type of ['pointerover', 'focusin', 'dragenter']) $('welcome').addEventListener(type, () => modulePromise().catch(() => {}), {once: true});
function diagnostics(ready) {
  $('measure').disabled = !ready || profiling || Boolean(measurement);
  $('heap').disabled = !ready || profiling || Boolean(measurement);
}
function selectContent(next) {
  storage?.close(); content = next; failedWrites.clear(); $('storage-error').hidden = true;
  // Preserve existing prototype retail saves. Demo data has a separate namespace.
  storage = new BrowserStorage(next.kind === 'retail' ? 'nanolathe-browser-poc' : 'nanolathe-browser-demo-v1');
  activeConfig = null; measurement = null; pendingMeasureTick = null;
  $('content-name').textContent = next.name;
  const demo = next.kind === 'demo';
  // The collector shares the one browser thread, so the demo's small scenes
  // keep the desktop GC pacing; retail imports default to the lower preset.
  $('memory').value = demo ? 'desktop' : 'lower';
  for (const option of $('entry').options) option.disabled = demo ? ['skirmish','stress'].includes(option.value) : option.value === 'demo';
  $('entry').value = demo ? 'demo' : 'menus'; entryChanged();
  refreshStorage();
}
function entryChanged() {
  $('maplabel').hidden = !['skirmish','stress'].includes($('entry').value);
  if ($('entry').value === 'stress') $('map').value = 'town & country';
}
$('entry').onchange = entryChanged;
async function start() {
  if (!content) return;
  const epoch = ++launchEpoch;
  launching = true; $('start').disabled = true;
  try {
    measurement = null; profiling = false; diagnostics(false); $('metrics').textContent = '';
    pendingMeasureTick = $('entry').value === 'stress' && $('auto-measure').checked ? 750 : null;
    activeConfig = {entry:$('entry').value, map:['skirmish','stress'].includes($('entry').value) ? $('map').value : null,
      seed:['skirmish','stress'].includes($('entry').value) ? 7 : null, memory:$('memory').value, content:content.kind};
    // Begin fetching/compiling before the iframe asks for the module.
    const module = modulePromise(); module.catch(() => {});
    setStatus('Preparing ' + content.name + '…');
    await host.start({...activeConfig, renderer:$('renderer').value, name:content.name,
      storage:storage.name, files:content.files, module, display:mobile ? phoneDisplay() : null});
    if (epoch !== launchEpoch) return;
    $('welcome').hidden = true; $('controls').hidden = false; $('game-view').hidden = false;
    document.body.classList.toggle('playing', mobile); document.body.classList.remove('menu-open');
  } catch (error) { if (epoch === launchEpoch && error.name !== 'AbortError') { setStatus(error.message); appendLog(error.message); } }
  finally { if (epoch === launchEpoch) { launching = false; $('start').disabled = false; } }
}
// The battle HUD needs 480 logical rows; the width follows the phone's
// landscape shape so the letterbox disappears.
function phoneDisplay() {
  const long = Math.max(innerWidth, innerHeight), short = Math.min(innerWidth, innerHeight);
  return {width:Math.max(640, Math.min(1280, Math.round(480 * long / short / 2) * 2)), height:480};
}
function retireView() {
  document.body.classList.remove('playing', 'menu-open');
  if (document.fullscreenElement === $('game-view')) document.exitFullscreen().catch(() => {});
  $('game-view').hidden = true;
}
function back() {
  launchEpoch++; launching = false; $('start').disabled = false;
  loading?.abort(); loading = null; host.stop(); diagnostics(false);
  measurement = null; profiling = false; pendingMeasureTick = null;
  $('welcome').hidden = false; $('controls').hidden = true; retireView();
  $('demo').disabled = !manifest; $('demo').textContent = 'Try the demo';
  $('measure').textContent = 'Measure 20 seconds'; setStatus('Choose the demo or your game folder.');
}
$('start').onclick = () => { document.body.classList.remove('menu-open'); start(); };
$('touch-menu').onclick = () => document.body.classList.toggle('menu-open');
// Touching the game moves focus into its frame, which closes the menu.
addEventListener('blur', () => document.body.classList.remove('menu-open'));
if (!document.fullscreenEnabled) $('fullscreen').hidden = true; // iPhone Safari
// On-screen keys reach the engine as ordinary key events on its canvas.
function gameKey(type, key, code, keyCode) {
  const frame = $('game').contentWindow, canvas = frame?.document.querySelector('canvas');
  canvas?.dispatchEvent(new frame.KeyboardEvent(type, {key, code, keyCode, which:keyCode, bubbles:true, cancelable:true,
    shiftKey:$('touch-shift').getAttribute('aria-pressed') === 'true'}));
  if (frame?.document.activeElement?.id !== 'touch-text') canvas?.focus();
}
const tapKey = (key, code, keyCode) => () => { gameKey('keydown', key, code, keyCode); setTimeout(() => gameKey('keyup', key, code, keyCode), 90); };
$('touch-options').onclick = tapKey('F2', 'F2', 113);
$('touch-map').onclick = tapKey('F9', 'F9', 120); // Modern: fit the whole map, again to return
// The phone keyboard types through a hidden input inside the game page, so
// the game keeps its focus. Its edits become key events; one space stays in
// it so Backspace always produces an edit.
const keyCode = ch => /^[a-z]$/i.test(ch) ? 'Key' + ch.toUpperCase() : /^[0-9]$/.test(ch) ? 'Digit' + ch : ch === ' ' ? 'Space' : '';
const typeKey = (key, code) => { gameKey('keydown', key, code, 0); gameKey('keyup', key, code, 0); };
function textInput() {
  const doc = $('game').contentDocument;
  let input = doc?.getElementById('touch-text');
  if (!doc || input) return input;
  input = Object.assign(doc.createElement('input'), {id:'touch-text', value:' ', autocomplete:'off', spellcheck:false});
  input.setAttribute('autocapitalize', 'off'); input.setAttribute('autocorrect', 'off'); input.setAttribute('enterkeyhint', 'done');
  // 16px avoids iOS zooming the page on focus.
  input.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;border:0;padding:0;font-size:16px';
  input.addEventListener('input', event => {
    if (event.inputType?.startsWith('delete')) typeKey('Backspace', 'Backspace');
    else for (const ch of event.data ?? input.value.slice(1)) typeKey(ch, keyCode(ch));
    input.value = ' ';
  });
  input.addEventListener('keydown', event => {
    if (!['Enter', 'Escape', 'Tab'].includes(event.key)) return;
    event.preventDefault(); typeKey(event.key, event.key);
    if (event.key !== 'Tab') input.blur();
  });
  input.addEventListener('blur', () => doc.querySelector('canvas')?.focus());
  doc.body.append(input);
  return input;
}
$('touch-keys').onclick = () => {
  const input = textInput();
  if (!input) return;
  if (input.ownerDocument.activeElement === input) { input.blur(); return; }
  input.value = ' '; input.focus();
};
$('touch-shift').onclick = () => {
  const on = $('touch-shift').getAttribute('aria-pressed') !== 'true';
  $('touch-shift').setAttribute('aria-pressed', String(on));
  gameKey(on ? 'keydown' : 'keyup', 'Shift', 'ShiftLeft', 16);
};
$('stop').onclick = back;
$('fullscreen').onclick = () => $('game-view').requestFullscreen().catch(error => setStatus(error.message));
$('leave-fullscreen').onclick = () => document.exitFullscreen().catch(error => setStatus(error.message));
document.addEventListener('fullscreenchange', () => {
  // Keep durable-write failures visible inside the fullscreen game.
  if (document.fullscreenElement === $('game-view')) $('game-view').append($('storage-error'));
  else $('status').after($('storage-error'));
});
$('demo').onclick = async () => {
  if (!manifest || loading || launching) return;
  const controller = new AbortController(); loading = controller; $('demo').disabled = true;
  $('controls').hidden = false; $('start').disabled = true;
  try {
    modulePromise().catch(() => {});
    const next = await loadDemo(manifest, controller.signal, (done, total) => { if (loading === controller && !controller.signal.aborted) setStatus(
      'Preparing demo: ' + (done/1024**2).toFixed(1) + ' / ' + (total/1024**2).toFixed(1) + ' MiB'); });
    controller.signal.throwIfAborted(); selectContent(next); await start();
  } catch (error) { if (loading === controller && error.name !== 'AbortError') { setStatus(error.message); appendLog(error.message); } }
  finally {
    if (loading === controller) { loading = null; $('demo').disabled = false; $('start').disabled = false; }
  }
};
async function accept(files) {
  loading?.abort(); loading = null;
  let epoch = launchEpoch;
  try {
    const next = importedContent(files);
    epoch = ++launchEpoch; launching = false;
    await host.stop();
    if (epoch !== launchEpoch) return;
    selectContent(next); await start();
  } catch (error) { if (epoch === launchEpoch) setStatus(error.message); }
}
$('folder').onchange = event => {
  const files = Array.from(event.target.files, file => [file.webkitRelativePath || file.name, file]);
  event.target.value = ''; // Selecting the same folder again must still dispatch.
  if (files.length) accept(files);
};
$('drop').ondragover = event => { event.preventDefault(); $('drop').classList.add('over'); };
$('drop').ondragleave = () => $('drop').classList.remove('over');
$('drop').ondrop = async event => {
  event.preventDefault(); $('drop').classList.remove('over'); setStatus('Reading folder names…');
  const epoch = ++launchEpoch; launching = false;
  loading?.abort(); loading = null;
  try {
    const entries = Array.from(event.dataTransfer.items, item => item.webkitGetAsEntry?.()).filter(Boolean);
    const files = [];
    for (const entry of entries) files.push(...await collectEntry(entry));
    if (epoch === launchEpoch) await accept(files);
  } catch (error) { if (epoch === launchEpoch) setStatus(error.message); }
};
function sample(data) {
  if (pendingMeasureTick !== null && data.tick >= pendingMeasureTick) {
    pendingMeasureTick = null; measurement = {started:performance.now(), samples:[]}; $('measure').textContent = 'Measuring…';
  }
  diagnostics(true);
  if (!measurement && !profiling) setStatus('Running ' + content.name + '. Click the game to focus it.');
  $('metrics').textContent = data.renderer + ' | ' + data.width + '×' + data.height +
    ' | ' + data.fps.toFixed(1) + ' FPS | ' + data.tps.toFixed(1) + ' ticks/s | ' + data.units +
    ' units | tick ' + data.tick + ' | Go heap ' + data.heap_mib.toFixed(0) + ' MiB / Wasm ' +
    data.wasm_mib.toFixed(0) + ' MiB | draw ' + data.draw_ms.toFixed(1) + ' ms | sim ' + data.sim_ms.toFixed(1) + ' ms';
  if (!measurement) return;
  measurement.samples.push(data);
  if (performance.now() - measurement.started < 20000) return;
  const samples = measurement.samples, avg = key => samples.reduce((n,s) => n+s[key], 0)/samples.length;
  const result = {...activeConfig, renderer:data.renderer, resolution:[data.width,data.height],
    seconds:(performance.now()-measurement.started)/1000, samples:samples.length,
    avg_fps:avg('fps'), avg_tps:avg('tps'), avg_draw_ms:avg('draw_ms'), avg_sim_ms:avg('sim_ms'),
    peak_heap_mib:Math.max(...samples.map(s => s.heap_mib)), peak_wasm_mib:Math.max(...samples.map(s => s.wasm_mib)),
    units:[samples[0].units,data.units], ticks:[samples[0].tick,data.tick], samples_detail:samples};
  performanceRuns.push(result); appendLog(JSON.stringify(result)); measurement = null;
  $('measure').textContent = 'Measure 20 seconds'; diagnostics(true);
}
$('measure').onclick = () => {
  pendingMeasureTick = null; measurement = {started:performance.now(), samples:[]};
  $('measure').textContent = 'Measuring…'; diagnostics(true);
};
$('export').onclick = () => {
  if (measurementsURL) URL.revokeObjectURL(measurementsURL);
  measurementsURL = URL.createObjectURL(new Blob([JSON.stringify(performanceRuns,null,2)], {type:'application/json'}));
  $('measure-download').href = measurementsURL; $('measure-download').download = 'nanolathe-browser-performance.json'; $('measure-download').hidden = false;
};
$('heap').onclick = () => { profiling = true; diagnostics(true); setStatus('Recording heap profile…'); host.profile(); };
function profileReady({bytes,error}) {
  profiling = false; diagnostics(true);
  if (error) { setStatus('Heap profile failed: ' + error); return; }
  if (heapURL) URL.revokeObjectURL(heapURL);
  heapURL = URL.createObjectURL(new Blob([bytes], {type:'text/plain'}));
  $('heapdownload').href = heapURL; $('heapdownload').download = 'nanolathe-browser-heap.txt';
  $('heaptext').textContent = new TextDecoder().decode(bytes); $('profile').hidden = false;
  setStatus('Heap profile ready. Click the game to resume.');
}
function persistence({paths, error}) {
  for (const path of paths) {
    if (error) failedWrites.set(path, error); else failedWrites.delete(path);
  }
  $('storage-error').hidden = !failedWrites.size;
  $('storage-error').textContent = 'Browser storage failed for ' +
    [...failedWrites].map(([path, code]) => path.split('/').pop() + ' (' + code + ')').join(', ') +
    '. Your latest changes have not been stored. Try saving again before restarting; the previous browser save may be older.';
  if (error) appendLog('nanolathe: browser storage commit failed: logical path ' + paths.join(', ') +
    ', providers searched [IndexedDB], expected committed browser files (' + error + ')');
}
async function refreshStorage() {
  const epoch = ++storageEpoch, source = storage;
  if (!source) return;
  try {
    const records = (await source.records()).filter(r => !r.dir && !r.path.split('/').pop().startsWith('.'));
    if (epoch !== storageEpoch) return;
    storedURLs.forEach(url => URL.revokeObjectURL(url)); storedURLs = []; $('stored').replaceChildren();
    const info = document.createElement('p');
    info.textContent = content.name + ': ' + records.filter(r => /\.sav$/i.test(r.path)).length +
      ' saved games. Stored in this browser at this address.';
    $('stored').append(info);
    for (const record of records) {
      const link = document.createElement('a'), name = record.path.split('/').pop();
      link.textContent = 'Download ' + name; link.download = name;
      link.href = URL.createObjectURL(new Blob([record.bytes])); storedURLs.push(link.href); $('stored').append(link, ' · ');
    }
  } catch (error) { if (epoch === storageEpoch) $('stored').textContent = 'Local storage unavailable: ' + error.message; }
}
try {
  manifest = await demoManifest(new URL('demo/manifest.json', location.href)).catch(() => null) ||
    await demoManifest(officialDemoManifest, undefined, [location.origin, new URL(officialDemoManifest).origin]);
  $('demo').disabled = !manifest;
  $('demo').textContent = manifest ? 'Try the demo' : 'Demo unavailable in this build';
  $('demo-info').textContent = manifest ? 'Three campaign missions · ' +
    (manifest.files.reduce((n,f) => n+f.size,0)/1024**2).toFixed(1) + ' MiB, cached for your next visit' : 'You can still play using your own folder.';
  setStatus('Choose the demo or your game folder.');
} catch (error) { $('demo').textContent = 'Demo unavailable'; $('demo-info').textContent = error.message; setStatus('Choose your game folder to play.'); }
