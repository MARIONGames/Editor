/**
 * Kinora for Windows (and macOS/Linux): an Electron shell around the web app.
 *
 * The built app (dist-desktop/) is served from a private `app://kinora/` origin, so
 * projects saved in IndexedDB persist between launches and module scripts, workers
 * and WebCodecs behave exactly as on the web. The page gets no Node access.
 */
'use strict';

const { app, BrowserWindow, Menu, net, protocol, session, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SCHEME = 'app';
const ORIGIN = `${SCHEME}://kinora`;
const ROOT = path.join(__dirname, '..', 'dist-desktop');

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true } },
]);

// One window per user: opening Kinora again focuses the running copy.
if (!app.requestSingleInstanceLock()) app.quit();

/** Serves files from dist-desktop/ (never outside it). */
async function serve(request) {
  const { pathname } = new URL(request.url);
  const rel = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT + path.sep)) return new Response('Not found', { status: 404 });
  try {
    return await net.fetch(pathToFileURL(file).toString());
  } catch {
    return new Response('Not found', { status: 404 });
  }
}

/** Exports open a Save dialog in the folder that suits the file. */
function suggestFolder(filename) {
  const ext = path.extname(filename).toLowerCase();
  if (['.mp4', '.webm', '.mov'].includes(ext)) return app.getPath('videos');
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)) return app.getPath('pictures');
  return app.getPath('documents');
}

function isExternal(url) {
  return /^(https?|mailto):/i.test(url);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 860,
    minHeight: 560,
    title: 'Kinora',
    backgroundColor: '#0e0f13',
    icon: path.join(ROOT, 'icon-512.png'),
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });
  win.once('ready-to-show', () => win.show());

  // Links to other sites open in the normal browser; the app window never navigates away.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternal(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith(`${ORIGIN}/`)) return;
    event.preventDefault();
    if (isExternal(url)) void shell.openExternal(url);
  });

  // Developer tools: F12 or Ctrl+Shift+I (handy when reporting a problem).
  win.webContents.on('before-input-event', (event, input) => {
    const devtools = input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i');
    if (input.type === 'keyDown' && devtools) {
      win.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  void win.loadURL(`${ORIGIN}/index.html`);
  return win;
}

/**
 * CI smoke test: KINORA_SMOKE_TEST=<report.json> boots the packaged app, checks that the
 * home screen renders and the browser features Kinora relies on exist, writes a report
 * and exits (code 0 = all good).
 */
async function smokeTest(win, reportPath) {
  const fs = require('node:fs');
  const probe = `(async () => {
    const deadline = Date.now() + 45000;
    while (!document.querySelector('.goal') && Date.now() < deadline) await new Promise((r) => setTimeout(r, 250));
    const enc = async (codec) => {
      try { return (await VideoEncoder.isConfigSupported({ codec, width: 1280, height: 720, bitrate: 4e6 })).supported === true; }
      catch { return false; }
    };
    return {
      homeScreen: !!document.querySelector('.goal'),
      title: document.title,
      origin: location.origin,
      webgl2: !!document.createElement('canvas').getContext('webgl2'),
      indexedDB: typeof indexedDB !== 'undefined',
      webCodecs: typeof VideoEncoder !== 'undefined',
      h264: await enc('avc1.42001f'),
      vp9: await enc('vp09.00.10.08'),
      userAgent: navigator.userAgent,
    };
  })()`;
  let report;
  try {
    report = await win.webContents.executeJavaScript(probe, true);
  } catch (err) {
    report = { error: String(err) };
  }
  const ok = !!(report.homeScreen && report.webgl2 && report.indexedDB && report.webCodecs);
  fs.writeFileSync(reportPath, JSON.stringify({ ok, ...report }, null, 2));
  app.exit(ok ? 0 : 1);
}

app.on('second-instance', () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.whenReady().then(() => {
  protocol.handle(SCHEME, serve);

  const ses = session.defaultSession;
  // Kinora needs no camera, microphone, location or notifications.
  const allowed = new Set(['clipboard-sanitized-write', 'fullscreen', 'persistent-storage']);
  ses.setPermissionRequestHandler((_wc, permission, callback) => callback(allowed.has(permission)));
  ses.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));
  ses.on('will-download', (_event, item) => {
    item.setSaveDialogOptions({
      title: 'Save your file',
      defaultPath: path.join(suggestFolder(item.getFilename()), item.getFilename()),
    });
  });

  // Windows/Linux: no menu bar (the app has its own UI and shortcuts). macOS keeps the
  // standard menu so copy/paste and quitting work as Mac users expect.
  if (process.platform === 'darwin') Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]));
  else Menu.setApplicationMenu(null);

  const win = createWindow();
  const smokeReport = process.env.KINORA_SMOKE_TEST;
  if (smokeReport) win.webContents.once('did-finish-load', () => void smokeTest(win, smokeReport));
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
