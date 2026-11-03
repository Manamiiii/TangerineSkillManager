import { contextBridge, ipcRenderer } from 'electron';
import type { Bridge } from '../shared/types';
const bridge: Bridge = {
  request: (command, input) => ipcRenderer.invoke('skill-manager:request', command, input),
};
contextBridge.exposeInMainWorld('skillManager', Object.freeze(bridge));
