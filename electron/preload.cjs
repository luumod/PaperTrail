const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('paperTimeline', {
  invoke: (command, args) => ipcRenderer.invoke(command, args ?? {}),
})
