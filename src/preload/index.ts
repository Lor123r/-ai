import { contextBridge } from 'electron'

const api = {
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron
  }
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
