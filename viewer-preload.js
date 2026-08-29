const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('viewerApi', {
  onImg: (cb) => ipcRenderer.on('viewer:img', (_e, payload) => cb(payload)),
  close: () => window.close()
});
