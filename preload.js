const { contextBridge, ipcRenderer } = require('electron');

// 注意：键名不能与 renderer.js 顶层的 const/let 同名——contextBridge 暴露的是
// 不可配置的全局属性，重名会让页面脚本抛 "Identifier has already been declared"
// 并整体拒绝执行。
contextBridge.exposeInMainWorld('stickyApi', {
  loadData: () => ipcRenderer.invoke('data:load'),
  viewImage: (payload) => ipcRenderer.send('img:view', payload),
  saveData: (data) => ipcRenderer.invoke('data:save', data),
  flushData: (data) => ipcRenderer.sendSync('data:save-sync', data),
  closeWindow: () => ipcRenderer.send('win:close'),
  setAlwaysOnTop: (flag) => ipcRenderer.send('win:set-always-on-top', flag),
  resizeStart: () => ipcRenderer.send('win:resize-start'),
  resizeMove: () => ipcRenderer.send('win:resize-move'),
  resizeEnd: () => ipcRenderer.send('win:resize-end'),
  dockHover: () => ipcRenderer.send('win:dock-hover'),
  dockLeave: () => ipcRenderer.send('win:dock-leave'),
  onDockState: (cb) => ipcRenderer.on('win:dock-state', (_e, state) => cb(state))
});
