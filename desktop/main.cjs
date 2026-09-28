const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const { spawn } = require('node:child_process');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { HELP_LINKS, isSettingsLink, notionURL } = require('./links.cjs');

let window;
let busy = false;
let pendingLink = false;
let launcherURL;
const page = pathToFileURL(path.join(__dirname, 'renderer/index.html')).href;
const resources = app.isPackaged ? process.resourcesPath : __dirname;
const node = path.join(resources, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node');
const agent = app.isPackaged ? path.join(resources, 'agent') : path.resolve(__dirname, '../agent');

function receiveLink(value) {
  if (!isSettingsLink(value)) return;
  pendingLink = true;
  if (app.isReady()) showWindow();
}

// Register before ready so Finder/open-url launches are not lost.
app.on('open-url', (event, url) => { event.preventDefault(); receiveLink(url); });
const ownsLock = app.requestSingleInstanceLock();
if (!ownsLock) app.quit();
else {
  app.on('second-instance', (_event, argv) => {
    argv.forEach(receiveLink);
    showWindow();
  });
  process.argv.forEach(receiveLink);
  app.whenReady().then(async () => {
    const build = JSON.parse(await readFile(path.join(resources, 'runtime/build.json'), 'utf8'));
    launcherURL = build.launcherURL;
    if (build.platform !== process.platform || build.arch !== process.arch) throw new Error('This build has the wrong background runtime. Rebuild on the target OS and architecture.');
    if (app.isPackaged) app.setAsDefaultProtocolClient('dealfinder');
    installHandlers();
    showWindow();
  }).catch(error => { dialog.showErrorBox('DealFinder could not start', error.message); app.quit(); });
  app.on('activate', () => { if (app.isReady()) showWindow(); });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', event => { if (busy) { event.preventDefault(); window?.show(); } });
}

function showWindow() {
  if (!window) {
    window = new BrowserWindow({ width: 920, height: 780, minWidth: 680, minHeight: 640,
      title: 'DealFinder', backgroundColor: '#f6f5f1', autoHideMenuBar: true,
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    window.on('close', event => {
      if (busy) {
        event.preventDefault();
        window.webContents.send('dealfinder:progress', 'Please let the current operation finish before closing.');
      }
    });
    window.on('closed', () => { window = null; });
    window.webContents.once('did-finish-load', () => { if (pendingLink) { window.webContents.send('dealfinder:settings'); pendingLink = false; } });
    window.loadURL(page);
  }
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  if (pendingLink && !window.webContents.isLoading()) { window.webContents.send('dealfinder:settings'); pendingLink = false; }
}

function trusted(event) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== page)
    throw new Error('Untrusted app request.');
}

function worker(command, values) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.NODE_OPTIONS;
    delete env.NODE_PATH;
    delete env.DEALFINDER_LAUNCHER_URL;
    if (launcherURL) env.DEALFINDER_LAUNCHER_URL = launcherURL;
    const child = spawn(node, [path.join(agent, 'desktop-worker.mjs')], {
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env,
    });
    let buffer = '', result, failure;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        try {
          const event = JSON.parse(line);
          if (event.type === 'progress') window?.webContents.send('dealfinder:progress', event.message);
          if (event.type === 'result') result = event.result;
          if (event.type === 'error') failure = event.message;
        } catch { failure = 'The background helper returned an invalid response.'; }
      }
    });
    child.stderr.resume(); // Never relay native module diagnostics or submitted secrets.
    child.on('error', () => reject(new Error('The background helper could not start. Reinstall DealFinder.')));
    child.stdin.on('error', () => {});
    child.on('close', code => {
      if (failure || code !== 0 || result === undefined) reject(new Error(failure || 'The background helper stopped unexpectedly. Retry the operation.'));
      else resolve(result);
    });
    child.stdin.end(JSON.stringify({ command, values }));
  });
}

function installHandlers() {
  ipcMain.handle('dealfinder:action', async (event, command, values) => {
    trusted(event);
    try {
      if (!['status', 'setup', 'check', 'schedule', 'unschedule', 'settings'].includes(command)) throw new Error('Unknown app action.');
      if (busy) throw new Error('Another operation is running. Please wait.');
      if (command === 'setup' && Buffer.byteLength(JSON.stringify(values ?? {})) > 24_000) throw new Error('Setup request is too large.');
      if (command === 'schedule' || command === 'setup') {
        if (app.isPackaged && process.platform === 'darwin' &&
          (app.getAppPath().startsWith('/Volumes/') || app.getAppPath().includes('/AppTranslocation/')))
          throw new Error('Move DealFinder to Applications and reopen it before connecting or enabling background checks.');
      }
      busy = true;
      try { return { ok: true, value: await worker(command, values) }; }
      finally { busy = false; }
    } catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.handle('dealfinder:open', async (event, destination) => {
    trusted(event);
    try {
      let url = HELP_LINKS[destination];
      if (destination === 'workspace') url = notionURL((await worker('status')).config?.parentPage);
      if (typeof url !== 'string') throw new Error('Unknown link.');
      await shell.openExternal(url);
      return { ok: true };
    } catch (error) { return { ok: false, error: error.message }; }
  });
}
