'use strict';

const { app, BrowserWindow, globalShortcut, ipcMain, screen, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { loadPlayers } = require('./lib/api');

const HOTKEY_VISIBLE = 'F8';
const HOTKEY_PASSTHROUGH = 'F9';

// Масштаб интерфейса: 1.15 = +15% (важно для 1440p/2K мониторов).
const DEFAULT_UI_SCALE = 1.15;
const MIN_UI_SCALE = 0.8;
const MAX_UI_SCALE = 2;
const SETTINGS_VERSION = 2;

let win = null;
let interactive = true;
let uiScale = DEFAULT_UI_SCALE;

const settingsPath = () => path.join(app.getPath('userData'), 'window.json');

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) || {};
  } catch {
    return {};
  }
}

function writeSettings(patch) {
  try {
    fs.writeFileSync(settingsPath(), JSON.stringify({ ...readSettings(), ...patch, version: SETTINGS_VERSION }));
  } catch {
    /* не критично */
  }
}

function saveBounds() {
  if (!win || win.isDestroyed()) return;
  writeSettings({ bounds: win.getBounds() });
}

function applyUiScale() {
  if (!win || win.isDestroyed()) return;
  win.webContents.setZoomFactor(uiScale);
}

function createWindow() {
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  const settings = readSettings();
  const saved = settings.version === SETTINGS_VERSION ? settings.bounds : null;

  uiScale = clamp(Number(settings.scale) || DEFAULT_UI_SCALE, MIN_UI_SCALE, MAX_UI_SCALE);

  const width = saved?.width || Math.round(440 * uiScale);
  const height = saved?.height || Math.round(780 * uiScale);

  win = new BrowserWindow({
    width,
    height,
    x: saved?.x ?? workArea.width - width - 24,
    y: saved?.y ?? 72,
    minWidth: Math.round(340 * uiScale),
    minHeight: Math.round(260 * uiScale),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    show: false,
    title: 'Dota 1x6 Overlay',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  applyUiScale();
  win.webContents.on('did-finish-load', applyUiScale);

  win.once('ready-to-show', () => {
    applyUiScale();
    win.showInactive();
    applyPassthrough(false);
  });

  win.on('moved', saveBounds);
  win.on('resized', saveBounds);
  win.on('closed', () => {
    win = null;
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

function broadcastState() {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('overlay:state', {
    interactive,
    visible: win.isVisible(),
  });
}

/** interactive = false -> мышь проходит сквозь окно */
function applyPassthrough(passthrough) {
  if (!win || win.isDestroyed()) return;
  interactive = !passthrough;
  win.setIgnoreMouseEvents(passthrough, { forward: true });
  if (!passthrough) win.setAlwaysOnTop(true, 'screen-saver');
  broadcastState();
}

function toggleVisible() {
  if (!win || win.isDestroyed()) return;
  if (win.isVisible()) {
    win.hide();
  } else {
    win.showInactive();
    win.setAlwaysOnTop(true, 'screen-saver');
  }
  broadcastState();
}

function registerShortcuts() {
  const bindings = [
    [HOTKEY_VISIBLE, toggleVisible],
    [HOTKEY_PASSTHROUGH, () => applyPassthrough(interactive)],
    ['CommandOrControl+Shift+X', () => app.quit()],
  ];

  for (const [accelerator, handler] of bindings) {
    if (!globalShortcut.register(accelerator, handler)) {
      console.warn(`[overlay] не удалось занять хоткей ${accelerator}`);
    }
  }
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win || win.isDestroyed()) {
      createWindow();
      return;
    }
    win.showInactive();
    win.setAlwaysOnTop(true, 'screen-saver');
    broadcastState();
  });

  app.whenReady().then(() => {
    createWindow();
    registerShortcuts();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());

ipcMain.handle('players:load', async (_event, input) => {
  try {
    return { ok: true, ...(await loadPlayers(input)) };
  } catch (e) {
    return { ok: false, players: [], errors: [{ input: '', message: e?.message || 'Неизвестная ошибка' }] };
  }
});

ipcMain.handle('overlay:setPassthrough', (_event, value) => {
  applyPassthrough(Boolean(value));
  return { interactive };
});

ipcMain.handle('overlay:hide', () => {
  if (win && !win.isDestroyed()) win.hide();
  broadcastState();
  return true;
});

ipcMain.handle('overlay:close', () => {
  app.quit();
  return true;
});

ipcMain.handle('overlay:getState', () => ({ interactive, visible: Boolean(win?.isVisible()), scale: uiScale }));

ipcMain.handle('overlay:getScale', () => uiScale);

ipcMain.handle('overlay:setScale', (_event, next) => {
  uiScale = clamp(Number(next) || uiScale, MIN_UI_SCALE, MAX_UI_SCALE);
  applyUiScale();
  writeSettings({ scale: uiScale });
  return uiScale;
});

ipcMain.handle('overlay:openExternal', (_event, url) => {
  if (typeof url === 'string' && /^https:\/\//.test(url)) shell.openExternal(url);
  return true;
});
