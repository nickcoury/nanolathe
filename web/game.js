import {BrowserFS} from './fs.js';
import {BrowserStorage} from './storage.js';
import {installBrowserGestures} from './gestures.js';
import {touchFeedback} from './touch.js';
import {installFrameGate} from './frames.js';
import {installBrowserClipboard} from './clipboard.js';

const run = new URLSearchParams(location.search).get('run');
const host = parent.nanolatheBrowserHost;
const config = host?.getLaunch(run);
const post = (type, payload) => parent.postMessage({channel:'nanolathe', run, type, payload}, location.origin);
// Phones start at their landscape shape. Only the display size is replaced;
// every other stored preference is kept, and nothing is written until the
// engine itself saves its settings.
function phoneSettings(install, display) {
  const path = '/settings/settings.json', node = install.nodes.get(path);
  let settings = {version:1};
  try { if (node?.bytes) settings = JSON.parse(new TextDecoder().decode(node.bytes)); } catch {}
  settings.display = {...settings.display, width:display.width, height:display.height};
  const next = install.add(path, new TextEncoder().encode(JSON.stringify(settings)));
  if (node) next.mtime = node.mtime;
  next.dirty = false;
}
if (config) {
  // Online play keeps a hidden page in step between the engine's frames.
  installFrameGate(window);
  const stopGestures = installBrowserGestures(window, event => window.nanolatheBrowserGesture?.(event),
    touchFeedback(document));
  const stopClipboard = installBrowserClipboard(window, text => window.nanolatheBrowserPaste?.(text));
  try {
    const storage = new BrowserStorage(config.storage, () => post('storage'));
    const install = new BrowserFS(config.files, storage, text => post('log', text), result => post('persistence', result));
    await install.restore();
    if (config.display) phoneSettings(install, config.display);
    window.fs = install.fs; window.process = install.process; window.path = install.path;
    const build = await config.module;
    await new Promise((resolve, reject) => {
      const script = document.createElement('script'); script.src = build.runtime;
      script.onload = resolve; script.onerror = () => reject(new Error('Could not load the matching Go browser runtime.'));
      document.head.append(script);
    });
    const go = new Go();
    go.env = {HOME:'/settings', TMPDIR:'/tmp', NANOLATHE_SETTINGS:'/settings/settings.json',
      GOGC:config.memory === 'lower' ? '50' : '100', NANOLATHE_BROWSER_MEMORY:config.memory};
    go.argv = ['nanolathe', '--root=/game', '--save-dir=/saves', '--mod=none', '--fullscreen=false',
      '--auto-remaster=false', '--renderer=' + config.renderer, '--fps=60'];
    if (config.entry === 'demo') go.argv.push('--mission=camps/Arm Campaign.tdf:MISSION0');
    if (config.entry === 'skirmish' || config.entry === 'stress') go.argv.push('--map=' + config.map, '--seed=7');
    if (config.entry === 'stress') go.env.NANOLATHE_BROWSER_SCENE = 'field:250';
    post('status', 'Restored browser files. Preparing WebAssembly…');
    const instance = await WebAssembly.instantiate(build.module, go.importObject);
    window.nanolatheBrowserSample = encoded => post('sample', {...JSON.parse(encoded),
      wasm_mib:instance.exports.mem.buffer.byteLength / 1024**2, cache_mib:install.cacheBytes / 1024**2});
    window.nanolatheBrowserHeapReady = (bytes, error) => post('profile', {bytes, error});
    window.addEventListener('message', event => {
      if (event.source === parent && event.origin === location.origin && event.data?.channel === 'nanolathe' &&
          event.data.run === run && event.data.type === 'heap-profile') window.browserHeapProfile?.();
    });
    post('status', 'Starting ' + config.name + '…');
    await go.run(instance);
    post('stopped', 'Engine exited. Restart to play again.');
  } catch (error) {
    post('log', error.stack || error.message);
    post('stopped', 'Startup failed: ' + error.message);
  } finally {
    stopGestures();
    stopClipboard();
  }
}
