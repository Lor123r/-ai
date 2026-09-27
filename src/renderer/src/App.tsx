import { useCallback, useEffect, useState } from 'react'
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
