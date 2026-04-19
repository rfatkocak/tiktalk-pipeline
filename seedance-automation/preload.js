const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getVideos: () => ipcRenderer.invoke('get-videos'),
  addVideo: (data) => ipcRenderer.invoke('add-video', data),
  addVideosBulk: (items) => ipcRenderer.invoke('add-videos-bulk', items),
  updateVideo: (id, data) => ipcRenderer.invoke('update-video', id, data),
  deleteVideo: (id) => ipcRenderer.invoke('delete-video', id),
  deleteAllPending: () => ipcRenderer.invoke('delete-all-pending'),
  importExcel: () => ipcRenderer.invoke('import-excel'),
  importJson: () => ipcRenderer.invoke('import-json'),
  getDownloadDir: () => ipcRenderer.invoke('get-download-dir'),
  // Automation
  launchBrowser: () => ipcRenderer.invoke('launch-browser'),
  closeBrowser: () => ipcRenderer.invoke('close-browser'),
  generateVideo: (videoData) => ipcRenderer.invoke('generate-video', videoData),
  onProgress: (callback) => ipcRenderer.on('generation-progress', (_, data) => callback(data)),
});
