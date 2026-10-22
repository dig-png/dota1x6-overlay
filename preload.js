'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlay', {
  load: (input) => ipcRenderer.invoke('players:load', input),
  setPassthrough: (value) => ipcRenderer.invoke('overlay:setPassthrough', value),
  hide: () => ipcRenderer.invoke('overlay:hide'),
  close: () => ipcRenderer.invoke('overlay:close'),
  getState: () => ipcRenderer.invoke('overlay:getState'),
  getScale: () => ipcRenderer.invoke('overlay:getScale'),
  setScale: (value) => ipcRenderer.invoke('overlay:setScale', value),
  openExternal: (url) => ipcRenderer.invoke('overlay:openExternal', url),
  onState: (callback) => {
    ipcRenderer.on('overlay:state', (_event, state) => callback(state));
  },
});
