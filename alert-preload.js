const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('alertApi', {
  onAlertData: (cb) => ipcRenderer.on('alert:data', (_e, p) => cb(p)),
  alertAction: (action, id) => ipcRenderer.send('alert:action', { action, id })
});
