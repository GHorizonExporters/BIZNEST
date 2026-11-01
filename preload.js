const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('api',(n,a)=>ipcRenderer.invoke('api',n,a).then(r=>{if(r.error)throw new Error(r.error);return r.data}));
