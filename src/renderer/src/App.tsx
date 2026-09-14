import { formatRuntimeLabel, getRuntimeVersions } from '@renderer/platform/runtime'

export default function App(): React.JSX.Element {
  const runtimeLabel = formatRuntimeLabel(getRuntimeVersions())

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-header__title">书架</h1>
        <span className="app-header__runtime">{runtimeLabel}</span>
      </header>
      <main className="app-body">
        <p className="empty-hint">书架还是空的，导入 EPUB 后就会出现在这里。</p>
      </main>
    </div>
  )
}
