const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('dealfinder', {
  action: (command, values) => ipcRenderer.invoke('dealfinder:action', command, values),
  open: destination => ipcRenderer.invoke('dealfinder:open', destination),
  onProgress: callback => { ipcRenderer.on('dealfinder:progress', (_event, message) => callback(message)); },
  onSettings: callback => { ipcRenderer.on('dealfinder:settings', () => callback()); },
});
