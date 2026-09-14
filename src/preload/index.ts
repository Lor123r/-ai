import { contextBridge, ipcRenderer } from 'electron'
import type { AppBridge } from '@shared/ipc'
import { BOOK_CHANNELS, LIBRARY_CHANNELS } from '@shared/ipc'

const api: AppBridge = {
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron
  },
  books: {
    list: () => ipcRenderer.invoke(BOOK_CHANNELS.list),
    get: (id) => ipcRenderer.invoke(BOOK_CHANNELS.get, id),
    save: (book) => ipcRenderer.invoke(BOOK_CHANNELS.save, book),
    remove: (id) => ipcRenderer.invoke(BOOK_CHANNELS.remove, id),
    getLocator: (bookId) => ipcRenderer.invoke(BOOK_CHANNELS.getLocator, bookId),
    saveLocator: (bookId, locator) => ipcRenderer.invoke(BOOK_CHANNELS.saveLocator, bookId, locator),
    markOpened: (id, openedAt) => ipcRenderer.invoke(BOOK_CHANNELS.markOpened, id, openedAt)
  },
  library: {
    pickAndImport: () => ipcRenderer.invoke(LIBRARY_CHANNELS.import)
  },
  cover: {
    read: (bookId) => ipcRenderer.invoke(LIBRARY_CHANNELS.readCover, bookId)
  }
}

contextBridge.exposeInMainWorld('api', api)
