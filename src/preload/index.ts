import { contextBridge, ipcRenderer } from 'electron'
import type { AppBridge } from '@shared/ipc'
import {
  ANNOTATION_CHANNELS,
  ANNOTATION_TRANSFER_CHANNELS,
  BOOK_CHANNELS,
  LIBRARY_CHANNELS,
  RUNTIME_CHANNELS,
  SETTINGS_CHANNELS,
  UPDATE_CHANNELS
} from '@shared/ipc'

const api: AppBridge = {
  // 应用版本只有主进程知道（`app` 在 preload 里是 undefined，直接读会抛错并带走整个
  // contextBridge），所以这里走一次 IPC。`process.versions.*` 在 preload 里可用，
  // 但为了「一次调用拿全」还是并到主进程一起返回。
  versions: ipcRenderer.invoke(RUNTIME_CHANNELS.versions),
  update: {
    check: () => ipcRenderer.invoke(UPDATE_CHANNELS.check)
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
  annotations: {
    listByBook: (bookId) => ipcRenderer.invoke(ANNOTATION_CHANNELS.list, bookId),
    save: (annotation) => ipcRenderer.invoke(ANNOTATION_CHANNELS.save, annotation),
    remove: (bookId, annotationId) => ipcRenderer.invoke(ANNOTATION_CHANNELS.remove, bookId, annotationId)
  },
  annotationTransfer: {
    exportBook: (bookId) => ipcRenderer.invoke(ANNOTATION_TRANSFER_CHANNELS.exportBook, bookId),
    importInto: (bookId) => ipcRenderer.invoke(ANNOTATION_TRANSFER_CHANNELS.importInto, bookId)
  },
  library: {
    pickAndImport: () => ipcRenderer.invoke(LIBRARY_CHANNELS.import)
  },
  cover: {
    read: (bookId) => ipcRenderer.invoke(LIBRARY_CHANNELS.readCover, bookId)
  },
  content: {
    read: (bookId) => ipcRenderer.invoke(LIBRARY_CHANNELS.readContent, bookId)
  },
  settings: {
    load: () => ipcRenderer.invoke(SETTINGS_CHANNELS.load),
    save: (settings) => ipcRenderer.invoke(SETTINGS_CHANNELS.save, settings)
  }
}

contextBridge.exposeInMainWorld('api', api)
