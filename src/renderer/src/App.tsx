import { useCallback, useEffect, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { App as CapacitorApp } from '@capacitor/app'
import { AnnotationRepositoryProvider } from '@renderer/data/AnnotationRepositoryProvider'
import { AnnotationTransferProvider } from '@renderer/data/AnnotationTransferProvider'
import { BookContentReaderProvider } from '@renderer/data/BookContentReaderProvider'
import { BookImporterProvider } from '@renderer/data/BookImporterProvider'
import { BookRepositoryProvider } from '@renderer/data/BookRepositoryProvider'
import { CoverReaderProvider } from '@renderer/data/CoverReaderProvider'
import { SettingsRepositoryProvider } from '@renderer/data/SettingsRepositoryProvider'
import Bookshelf from '@renderer/shelf/Bookshelf'
import ReaderView from '@renderer/reader/ReaderView'
import { READER_STATE, isReaderState, handleBackPress } from '@renderer/reader/useBackNavigation'
import type { ShelfEntry } from '@renderer/hooks/useBooks'

export default function App(): React.JSX.Element {
  const [activeEntry, setActiveEntry] = useState<ShelfEntry | null>(null)

  /**
   * 打开一本书：进阅读器，并在 history 里压一层。
   *
   * 压栈是为了让系统返回键（安卓返回键 / 浏览器后退）能回书架 ——
   * 否则返回键会直接退出 App，用户只能靠唤起隐藏的顶栏才能回去。
   */
  const openBook = useCallback((entry: ShelfEntry) => {
    window.history.pushState(READER_STATE, '')
    setActiveEntry(entry)
  }, [])

  /**
   * 返回键 / 浏览器后退：先问阅读器，它不要才回书架。
   *
   * **这是全应用唯一的 `popstate` 监听。** 阅读器不再自己挂监听 ——
   * `popstate` 的目标是 `window`，在目标节点上捕获与冒泡不区分、只按注册顺序跑，
   * App 先注册就永远先跑，阅读器拦不住。改成这里统一分发，顺序问题就不存在了。
   */
  useEffect(() => {
    function handlePopState(event: PopStateEvent): void {
      // 退回到的还是阅读器那一层，说明用户没打算离开，不处理
      if (isReaderState(event.state)) return
      // 阅读器接管了（比如关掉了抽屉）。把这一层补回去，
      // 否则下一次返回键会直接退出 App，抽屉关掉后就回不到书架了。
      if (handleBackPress()) {
        window.history.pushState(READER_STATE, '')
        return
      }
      setActiveEntry(null)
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  /**
   * 安卓原生返回键。
   *
   * **`popstate` 在安卓宿主里靠不住。** Capacitor 的 `BridgeActivity` 收到返回键后
   * 先问 JS 有没有 `backButton` 监听，没有才交给 WebView 的 `goBack()`；而
   * `goBack()` 只在 WebView 自己还有历史时才触发 `popstate`。应用是单页，
   * 首屏之后 history 里只有我们 push 的那一层，一旦它被消费掉，返回键就直接
   * 退出 App —— 用户看到的是「返回键失灵」。
   *
   * 所以安卓上直接听原生事件，走同一个 `handleBackPress` 分发：
   * 阅读器要就给它，不要就回书架。浏览器宿主没有这个事件，`Capacitor.isNativePlatform()`
   * 为 false 时整段跳过，E2E 仍走 `popstate` 那条路。
   */
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return

    const listener = CapacitorApp.addListener('backButton', () => {
      // 阅读器接管了（比如关掉了抽屉），什么都不做
      if (handleBackPress()) return
      // 在阅读器里：回书架，并把 history 里那一层退掉
      if (isReaderState(window.history.state)) {
        window.history.back()
        return
      }
      // 已经在书架：交回系统，让 App 退出
      void CapacitorApp.exitApp()
    })

    return () => {
      void listener.then((handle) => handle.remove())
    }
  }, [])

  /**
   * 点顶栏的「返回书架」：退掉自己压的那一层，由 popstate 统一收尾。
   *
   * 不直接 setActiveEntry(null)：那样 history 里会留下一条永远回不去的记录，
   * 用户按返回键会先「回到阅读器」再「回书架」，看着像返回键失灵。
   */
  const closeReader = useCallback(() => {
    window.history.back()
  }, [])

  return (
    <BookRepositoryProvider>
      <BookImporterProvider>
        <CoverReaderProvider>
          <BookContentReaderProvider>
            <SettingsRepositoryProvider>
              <AnnotationRepositoryProvider>
                <AnnotationTransferProvider>
                  {activeEntry ? (
                    <ReaderView
                      bookId={activeEntry.book.id}
                      title={activeEntry.book.title}
                      format={activeEntry.book.format}
                      onClose={closeReader}
                    />
                  ) : (
                    <Bookshelf onOpen={openBook} />
                  )}
                </AnnotationTransferProvider>
              </AnnotationRepositoryProvider>
            </SettingsRepositoryProvider>
          </BookContentReaderProvider>
        </CoverReaderProvider>
      </BookImporterProvider>
    </BookRepositoryProvider>
  )
}
