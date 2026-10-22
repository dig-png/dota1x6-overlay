'use strict';

// Рендерит build/icon.png (512x512) для electron-builder.
// Запуск: npx electron scripts/make-icon.js

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 512,
    height: 512,
    useContentSize: true,
    frame: false,
    transparent: true,
    show: false,
    resizable: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  win.setPosition(-32000, -32000);
  await win.loadFile(path.join(__dirname, 'icon.html'));
  win.showInactive();
  await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)');
  await new Promise((resolve) => setTimeout(resolve, 400));

  const image = await win.webContents.capturePage();
  const size = image.getSize();
  const png = size.width === 512 && size.height === 512 ? image : image.resize({ width: 512, height: 512 });

  const outDir = path.join(__dirname, '..', 'build');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'icon.png'), png.toPNG());

  console.log(`icon.png saved (${size.width}x${size.height} -> 512x512)`);
  app.quit();
});
