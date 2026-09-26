/**
 * 一个极小的 IndexedDB 封装，只覆盖本应用需要的「一个库、几个对象仓」。
 *
 * 为什么不直接用 localStorage：书籍正文是几 MB 的 EPUB 字节，localStorage 只能存
 * 字符串（要先 base64，体积再涨 33%），而且同步 API 会卡住主线程。IndexedDB 能直接
 * 存 ArrayBuffer，是浏览器里唯一合适的选择。
 *
 * 为什么不引 idb / Dexie：这里只需要 get / put / delete / getAll 四个动作，
 * 引一个库换来的便利抵不上多一份依赖 —— 而且这份代码要同时跑在安卓 WebView 里，
 * 依赖越少，WebView 版本差异带来的意外越少。
 */

const DB_NAME = 'ebook-reader'
const DB_VERSION = 1

/** 对象仓名。与 Electron 侧的目录结构一一对应，便于对照排查。 */
export const STORE = {
  /** 书籍元数据 + 阅读进度，对应主进程的 library.json。 */
  books: 'books',
  /** 注解，对应主进程的 annotations.json。 */
  annotations: 'annotations',
  /** 阅读设置，对应主进程的 settings.json。 */
  settings: 'settings',
  /** 书籍正文与封面字节，对应主进程的 books/ 与 covers/ 目录。 */
  blobs: 'blobs'
} as const

export type StoreName = (typeof STORE)[keyof typeof STORE]

let dbPromise: Promise<IDBDatabase> | null = null

/**
 * 打开数据库。连接缓存在模块级：IndexedDB 的 open 本身不便宜，
 * 每次读写都开一次会让翻页时的进度保存明显变慢。
 */
export function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      // 每个仓都用显式 keyPath，不用 out-of-line key：
      // 键是数据的一部分，读出来时不必再单独记一份「这个值对应哪个键」。
      if (!db.objectStoreNames.contains(STORE.books)) db.createObjectStore(STORE.books, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(STORE.annotations)) {
        db.createObjectStore(STORE.annotations, { keyPath: 'key' })
      }
      if (!db.objectStoreNames.contains(STORE.settings)) db.createObjectStore(STORE.settings, { keyPath: 'key' })
      if (!db.objectStoreNames.contains(STORE.blobs)) db.createObjectStore(STORE.blobs, { keyPath: 'key' })
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('无法打开本地数据库'))
    // 另一个标签页在跑旧版本时会阻塞升级，这里直接拒绝而不是无限等
    request.onblocked = () => reject(new Error('本地数据库被另一个页面占用，请关掉其它标签页后重试'))
  })

  // 打开失败时清掉缓存，否则后续每次调用都会拿到同一个失败的 Promise，永远恢复不了
  dbPromise.catch(() => {
    dbPromise = null
  })

  return dbPromise
}

/** 把一次 IDBRequest 包成 Promise。 */
function toPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('本地数据库操作失败'))
  })
}

/**
 * 在一个事务里跑一段逻辑。
 *
 * 事务的完成要单独等：`onsuccess` 只代表「请求发出去了」，此时事务可能还没提交。
 * 不等 `oncomplete` 就返回，调用方紧接着读同一个仓时可能读不到刚写的数据 ——
 * 这类 bug 只在慢设备上偶发，最难查。
 */
export async function withStore<T>(
  name: StoreName,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => Promise<T> | T
): Promise<T> {
  const db = await openDatabase()
  const transaction = db.transaction(name, mode)
  const result = await run(transaction.objectStore(name))

  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('本地数据库事务失败'))
    transaction.onabort = () => reject(transaction.error ?? new Error('本地数据库事务被中止'))
  })

  return result
}

export function get<T>(name: StoreName, key: IDBValidKey): Promise<T | undefined> {
  return withStore(name, 'readonly', (store) => toPromise<T | undefined>(store.get(key) as IDBRequest<T | undefined>))
}

export function getAll<T>(name: StoreName): Promise<T[]> {
  return withStore(name, 'readonly', (store) => toPromise<T[]>(store.getAll() as IDBRequest<T[]>))
}

export function put(name: StoreName, value: unknown): Promise<void> {
  return withStore(name, 'readwrite', async (store) => {
    await toPromise(store.put(value))
  })
}

export function putMany(name: StoreName, values: readonly unknown[]): Promise<void> {
  return withStore(name, 'readwrite', async (store) => {
    for (const value of values) await toPromise(store.put(value))
  })
}

export function remove(name: StoreName, key: IDBValidKey): Promise<void> {
  return withStore(name, 'readwrite', async (store) => {
    await toPromise(store.delete(key))
  })
}

export function clear(name: StoreName): Promise<void> {
  return withStore(name, 'readwrite', async (store) => {
    await toPromise(store.clear())
  })
}
