# 电纸书阅读器（MVP）

一个面向 Windows 桌面的 EPUB 阅读器，用 **Electron + React + TypeScript** 构建。
本文件是项目的总入口：既说明「怎么跑」，也说明「为什么这么写」以及「每一步是怎么走到这里的」。

---

## 目录

- [1. 项目定位与当前状态](#1-项目定位与当前状态)
- [2. 快速开始](#2-快速开始)
- [3. MVP 功能范围](#3-mvp-功能范围)
- [4. 技术选型与理由](#4-技术选型与理由)
- [5. 架构总览](#5-架构总览)
- [6. 核心数据模型](#6-核心数据模型)
- [7. 关键流程](#7-关键流程)
- [8. IPC 契约](#8-ipc-契约)
- [9. 存储布局与容错策略](#9-存储布局与容错策略)
- [10. epub.js 集成要点](#10-epubjs-集成要点)
- [11. 测试体系](#11-测试体系)
- [12. 开发规范](#12-开发规范)
- [13. 迭代历程](#13-迭代历程)
- [14. 已知限制与后续规划](#14-已知限制与后续规划)

---

## 1. 项目定位与当前状态

**定位**：能真正坐下来读完一本书的最小可用版本。不是阅读器的功能演示，而是「导入 → 书架 → 打开 → 读完 → 下次接着读」这条主链路走得通、且数据不会丢。

**当前状态**：MVP 的十个阶段全部完成，验证门禁全绿。

| 指标 | 数值 |
| --- | --- |
| 提交数 | 27 |
| 单元/组件测试 | 58 个文件 / **672** 个用例，全通过 |
| 端到端测试 | **13** 条 Playwright + Electron 用例，全通过 |
| 类型检查 | `tsc --noEmit` 双工程（node + web）零错误 |
| 一条命令验证 | `npm run verify` |

---

## 2. 快速开始

### 环境要求

- Windows（当前唯一验证过的平台）
- Node.js ≥ 20（开发时使用 v24.21.0 LTS，npm 11.19.0）
- 网络可达 npm registry；安装 Electron 二进制建议走镜像（见下）

### 安装

```powershell
# 国内网络建议走镜像
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
npm install --registry=https://registry.npmmirror.com
```

`postinstall` 会执行 `install-electron` 下载 Electron 二进制。

### 命令

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 启动开发模式（主进程 + 渲染进程热更新） |
| `npm run build` | 构建到 `out/`（main / preload / renderer 三份产物） |
| `npm start` | 预览构建产物 |
| `npm run typecheck` | 类型检查（等于 `typecheck:node` + `typecheck:web`） |
| `npm run test` | 跑全部单元/组件测试（watch 模式用 `npm run test:watch`） |
| `npm run test:e2e` | 先 `build` 再跑 Playwright 端到端测试 |
| `npm run verify` | **交付门禁**：`typecheck` → `test` → `test:e2e` |

> 交付前一律以 `npm run verify` 为准。它失败就等于这次改动没做完。

---

## 3. MVP 功能范围

### 已实现

| 能力 | 说明 |
| --- | --- |
| 导入 EPUB | 系统文件选择框（支持多选），复制进应用书库，解析书名/作者/封面 |
| 内容去重 | 以文件内容 sha256 作为书籍 id，同一本书重复导入只会被跳过 |
| 书架 | 封面网格、书名、作者、进度条、删除（连带清掉这本书的书签与划线）；排序为「最近阅读 → 导入时间倒序 → id」 |
| 分页阅读 | 应用内渲染 EPUB，上一页/下一页翻页 |
| 阅读进度 | 记录 CFI + 全书百分比 + 章节序号，重开应用后回到上次位置 |
| 目录 | 解析 EPUB 2 NCX 与 EPUB 3 nav，抽屉列出层级并支持点击跳转 |
| 阅读设置 | 字号 / 行高 / 页边距 / 主题（白天·护眼·夜间）/ 字体（宋体·黑体），改动落盘并在重启后保持 |
| 书签与划线 | 头部一键加/删书签；选中正文弹出浮条划线或删除划线，黄色底色；注解抽屉列出全书书签与划线并支持逐条删除 |
| 容错 | 书库/注解文件损坏时备份并从空数据启动；设置损坏时静默回落默认值 |

### 明确不做（留给后续版本）

TXT 正文渲染（格式识别已支持，渲染未做）、划线的颜色切换界面、注解的导出导入、全文搜索、批注、多标签页、云同步、打包分发。

---

## 4. 技术选型与理由

| 选择 | 理由 |
| --- | --- |
| **Electron** 而非 Tauri | Tauri 依赖 WebView2，各机器版本不一；Electron 自带 Chromium，`epub.js` 的 iframe 渲染行为稳定可预期。更关键的是它是本项目两条硬规范的支撑点——见下。 |
| **Playwright `_electron`** | 官方支持启动真实 Electron 进程并驱动其中的页面，含 iframe 与主进程 `evaluate`。这让「每次改动都必须配测试」这条规范能落到**端到端**层面，而不只是单测。 |
| **electron-vite** | 一份配置管 main / preload / renderer 三份产物，且 renderer 直接复用 Vite 生态（含 `@vitejs/plugin-react`），单测配置可与构建配置共用别名。 |
| **vitest** | 与 Vite 同源，别名、transform 直接复用；`jsdom` 环境足以覆盖 React 组件与纯逻辑。 |
| **fast-xml-parser** | 解析 OPF / container.xml。刻意把 `parseTagValue`、`parseAttributeValue` 全关掉——EPUB 里的日期、版本号常带前导零，自动转数字会丢信息。 |
| **jszip** | 读取 EPUB（本质是 zip）内的 OPF 与封面图，同样被测试 fixture 复用来**现场生成**测试用电子书。 |
| **epub.js** | 成熟的分页渲染方案，自动处理 CSS 分栏、iframe 隔离与 CFI 定位。 |

### 版本约束（重要）

- `electron-vite@5` 只支持 `vite ^5 || ^6 || ^7`，所以 **vite 必须锁在 ^7**。
- epub.js 不带官方类型，项目用 [epubjs.d.ts](src/renderer/src/reader/epubjs.d.ts) 只声明默认导出，真实形状由 [createEpubBook.ts](src/renderer/src/reader/createEpubBook.ts) 统一描述，避免同一份接口在两处各写一遍后慢慢走样。

---

## 5. 架构总览

### 三层进程隔离

```mermaid
flowchart TB
    subgraph Main["主进程 (src/main)"]
        IDX[index.ts<br/>窗口与生命周期]
        IPC["ipc/*.ts<br/>协议层：校验入参"]
        STO["storage/*.ts<br/>library.json / settings.json"]
        IMP["import/fileBookStore.ts<br/>书籍与封面落盘"]
    end

    subgraph Preload["preload (src/preload)"]
        BR["contextBridge 暴露 window.api"]
    end

    subgraph Renderer["渲染进程 (src/renderer)"]
        UI["shelf/* · reader/*<br/>React 组件"]
        DATA["data/*<br/>Provider + 工厂"]
    end

    subgraph Core["core (src/core) — 纯逻辑，无 fs / 无 DOM"]
        DOM["domain/*<br/>模型 · 归一化 · 复活"]
        EPUBC["epub/*<br/>解析 OPF（只吃字节）"]
        SVC["services/*<br/>用例编排"]
        ADPT["adapters/*<br/>内存 / JSON 实现"]
        PORTS["ports/*<br/>接口定义"]
    end

    UI --> DATA
    DATA --> BR
    BR -->|ipcRenderer.invoke| IPC
    IDX --> IPC
    IPC --> STO
    IPC --> SVC
    IMP -.实现.-> PORTS
    STO -.实现.-> PORTS
    ADPT -.实现.-> PORTS
    SVC --> DOM
    SVC --> EPUBC
    DOM --> PORTS
```

**核心规则：`core` 不许碰 `fs`、不许碰 DOM、不许碰 React。**
这条规则的价值在测试里立刻兑现：[importBooks.ts](src/core/services/importBooks.ts) 这一个用例编排函数，只靠「假的 FileStore + 假的 Repository」就把导入、去重、坏文件清理、书名兜底全测完了，一行真实文件 IO 都不需要。

### 目录结构

```
.claude/agents/         # 项目级子 Agent 定义（格式由 tests/unit/repo 守卫）
src/
  core/                 # 纯逻辑层：可在 Node 与浏览器两种环境下测试
    domain/             #   Book / ReadingLocator / ReaderSettings / TocEntry / Annotation + 归一化与复活
    epub/               #   OPF、container.xml 解析（输入是字节，不碰文件系统）
    ports/              #   接口定义：BookRepository / AnnotationRepository / FileStore / TextStore / ...
    adapters/           #   内存实现与 JSON 实现、快照序列化
    services/           #   用例编排：importBooks
  main/                 # 主进程：窗口、IPC 协议层、落盘实现
    ipc/                #   入参校验 + 调用仓库
    storage/            #   TextStore 的文件实现、书库/设置/注解的打开与恢复
    import/             #   FileBookStore：书籍与封面复制、路径越界防护
  preload/              # contextBridge：把 IPC 封装成 window.api
  shared/ipc.ts         # 频道名常量 + AppBridge 接口（主/渲染共用的唯一真相）
  renderer/src/         # React 界面
    data/               #   Provider + 工厂函数（决定用 IPC 还是内存实现）
    hooks/useBooks.ts   #   书架数据流
    shelf/              #   书架与封面
    reader/             #   阅读器、目录、设置、注解抽屉与浮条、epub.js 适配、注解 id 生成
    styles/global.css   #   主题变量与全部样式
tests/
  unit/                 # 与 src 同构分层的单元测试
  support/epubFixture.ts# 现场生成 EPUB 的测试夹具
e2e/app.spec.ts         # Playwright + Electron 端到端用例
```

### 别名与双 tsconfig

| 别名 | 指向 |
| --- | --- |
| `@core` | `src/core` |
| `@shared` | `src/shared` |
| `@preload` | `src/preload` |
| `@renderer` | `src/renderer/src` |

类型检查拆成两个工程，**这不是形式主义**：

- [tsconfig.node.json](tsconfig.node.json)：`lib: ["ES2023"]`、`types: ["node"]`、**没有 DOM**。覆盖 main / preload / core / shared / e2e / `tests/unit/main`。
  没有 DOM 意味着 core 层里写 `document` 或 `window` 会**直接编译失败**——架构规则由编译器看管，而不是靠自觉。
- [tsconfig.web.json](tsconfig.web.json)：`lib: ["ES2023","DOM","DOM.Iterable"]` + `jsx: react-jsx`。覆盖 renderer / core / shared / `tests/unit/**`，并 `exclude` 掉 `tests/unit/main`。

两个工程都开 `strict`、`noUnusedLocals`、`noUnusedParameters`、`noImplicitOverride`。

---

## 6. 核心数据模型

### Book —— [src/core/domain/book.ts](src/core/domain/book.ts)

```ts
interface Book {
  id: string            // 文件内容 sha256，天然去重
  title: string         // 空值归一为「未命名书籍」
  author: string | null
  format: 'epub' | 'txt'
  filePath: string      // 书库内的绝对路径
  fileSize: number
  coverPath: string | null
  addedAt: number
  lastOpenedAt: number | null
}
```

- `normalizeBookTitle` 会剥掉控制字符、合并空白、截断到 200 字。
- `compareBooksForShelf` 定义唯一排序：`lastOpenedAt` 降序 → `addedAt` 降序 → `id` 升序。
  **内存实现与 JSON 实现共用它**，因此换实现不会悄悄改变书架顺序。
- `reviveBook` 处理一切外部来源的数据（磁盘存档、IPC 参数）：缺 `id`/`filePath`/`format` 就返回 `null` 让调用方丢弃**这一条**，而不是让整个书库读不出来。

### ReadingLocator —— [src/core/domain/progress.ts](src/core/domain/progress.ts)

```ts
interface ReadingLocator {
  cfi: string | null        // EPUB 定位串
  percent: number           // 全书进度 0~1
  chapterIndex: number | null
  updatedAt: number
}
```

进度估算刻意**不用** epub.js 的 `locations.generate()` —— 那一步要预先扫过整本书，对 MVP 代价太高。改用「章节序号 + 章节内页码」：

```ts
percent = (chapterIndex + pageFraction) / spineCount
```

其中 `pageFraction` 把「第几页/共几页」映射到 `[0,1]`，且首尾页刚好落在章节两端（否则最后一页永远凑不满 100%）。只有 EPUB 章节数拿不到时才退化为单章。

`isSameLocation` 用于过滤滚动过程中产生的大量重复位置，避免每次都写库。

### ReaderSettings —— [src/core/domain/settings.ts](src/core/domain/settings.ts)

```ts
DEFAULT_READER_SETTINGS = { fontSize: 18, lineHeight: 1.7, pageMargin: 32, theme: 'day', fontFamily: 'serif' }
READER_LIMITS = { fontSize: 12~36, lineHeight: 1.2~2.4, pageMargin: 0~96 }
```

`normalizeReaderSettings` 把任何来源的值收敛为合法配置：**越界值夹到边界，非法值回落默认**。所以 `update()` 的入参可以直接来自任何 UI 控件，不必到处写防御代码。

`reviveReaderSettings` 与 `reviveBook` / `reviveLocator` 有个关键差异：**它从不返回 `null`**。因为配置没有「必需字段」，一份残缺配置也能逐字段收敛，调用方不必处理空值分支。

### TocEntry —— [src/core/domain/toc.ts](src/core/domain/toc.ts)

```ts
interface TocEntry { id: string; label: string; href: string; depth: number }
TOC_LIMITS = { maxEntries: 500, maxDepth: 4 }
```

- `flattenToc` 把 epub.js 的目录树摊平成带 `depth` 的列表（层级只用来做缩进，树不必再往下传）。
  上限是必须的：畸形 EPUB 能造出几万个目录项。
  没有 `href` 的项无法跳转，**但它的子项仍然有效**，所以跳过自身而不是整枝丢弃。
- `resolveTocTarget` 解决一个真实存在的路径错位：目录里的 `href` 相对**导航文档**，spine 里的 `href` 相对 **OPF**，两者目录不同就对不上号。策略是「先按原样匹配 → 再退回文件名唯一命中 → 都不行就原样返回交给 epub.js 报错」。

### Annotation —— [src/core/domain/annotation.ts](src/core/domain/annotation.ts)

书签与划线共用一个模型：两者都是「书里的一处位置 + 用户附加的信息」，生命周期、存储、列表渲染完全一致，差异只有「有没有选区文本与颜色」。

```ts
interface AnnotationBase { id; bookId; cfi; chapterHref; percent; note; createdAt; updatedAt }
BookmarkAnnotation  = AnnotationBase & { kind: 'bookmark' }
HighlightAnnotation = AnnotationBase & { kind: 'highlight'; excerpt; color }
Annotation = BookmarkAnnotation | HighlightAnnotation
```

- **判别联合，而不是「单结构 + 可选字段」**：书签没有 `excerpt` / `color`，用 `kind` 收窄之后 TS 才拦得住「渲染书签时访问 `color`」这类错误。
- **`cfi` 只以字符串进出 core**，书签是单点（`epubcfi(/6/4!/4/2/2/1:0)`），划线是 range 形式（`epubcfi(/6/4!/4/2,/1:0,/1:10)`）。core 里**不出现 DOM `Range` / `Selection`**：渲染层拿到选区后立刻转成 CFI 字符串再交进来。
- **刻意不校验 CFI 语法**，只做 trim + 非空 + 上限。CFI 的文本断言（`[pre,post]`）里可以合法出现逗号，「含逗号就是 range」这类判据会误杀合法值；语法权威是 epub.js。
- **但长度必须限死（`MAX_CFI_LENGTH = 512`），且超长整条拒绝、不许 `slice`**：截断出来的 CFI 语法无效，会造出一个永远定位不到的注解，比直接丢弃更糟。`normalizeCfi` 从 `progress.ts` 复用，注解自己的上限只加在这一侧——改 `progress.ts` 会波及已存进度。
- **`chapterHref` 比 `toc.ts` 的 `cleanHref` 更严**：它是「存下来下次直接回显」的字段，带 scheme 的绝对 URL（`javascript:` / `data:` / `http:`）一律丢弃。跳转优先用 `cfi`，`href` 只做展示兜底。
- **`id` 由渲染层生成，主进程只校验**：调用方注入 `crypto.randomUUID()`，core 不生成随机 id（对齐 `now: number = Date.now()` 的可注入约定，单测也不必打桩随机源）。渲染层为了做乐观更新不等 IPC 往返，所以这条 id 到主进程时已经在信任边界之外。**但 core 不强制 UUID 形状**，只限死「长度 ≤ 128 + 字符集 `[A-Za-z0-9_-]`」：把 id 钉成 UUID 就等于堵死渲染层在 `randomUUID` 不可用时的回落方案，而真正要防的控制字符、空白、路径分隔符与引号，白名单已经全覆盖。`bookId` 同样限长，`MAX_ANNOTATIONS_PER_BOOK = 1000` 拦住无界增长。回落方案不是纸上预案：[annotationId.ts](src/renderer/src/reader/annotationId.ts) 已经把它落成代码，三档依次降级——`crypto.randomUUID()` → `crypto.getRandomValues()`（`randomUUID` 是安全上下文限定接口，`getRandomValues` 不是，所以这一档正好接得上）→ `Math.random()`。三档都必须随机，**不能退到递增计数器**：同一个 `(bookId, id)` 在存档里是覆盖语义，计数器在「重装 / 换设备 / 清空存档」之后一定会从同一个起点重新走一遍，两条注解会悄悄合成一条。E2E 实测（第 11 章）确认生产环境走的是第一档。
- **`reviveAnnotation` 走的是同一套校验，不是另一套**：与 `reviveBook` / `reviveLocator` 同款，`id` / `bookId` / `kind` / `cfi` 任一非法就返回 `null`，让调用方只丢弃这一条，而不是让整本书的注解都读不出来。id 会被重放，所以复活时长度与字符集要**重新**校验，不能只判非空。

---

## 7. 关键流程

### 7.1 应用启动

```mermaid
sequenceDiagram
    participant M as 主进程
    participant S as storage
    participant W as 窗口
    M->>M: 读 EBOOK_READER_USER_DATA（可覆盖数据目录）
    M->>S: openLibrary(library.json)
    S-->>M: { repository, recoveredFiles }
    M->>S: openSettings(settings.json)
    M->>M: registerBooksIpc / registerSettingsIpc / registerLibraryIpc
    M->>W: createWindow()
```

`EBOOK_READER_USER_DATA` 这个环境变量是 E2E 测试的基础设施：让每个用例跑在自己的临时数据目录里，既互不干扰，也不会污染用户真实书库。

### 7.2 导入 EPUB

```mermaid
flowchart LR
    A["用户点「导入书籍」"] --> B["主进程 dialog.showOpenDialog<br/>（渲染进程无法指定路径）"]
    B --> C["importBooks()"]
    C --> D{"扩展名支持?"}
    D -- 否 --> E[failed: 暂不支持该文件格式]
    D -- 是 --> F["FileBookStore.import()<br/>复制进 books/，算 sha256"]
    F --> G{"已在书架?"}
    G -- 是 --> H[skipped]
    G -- 否 --> I["readEpub() 抽元数据"]
    I -- 解析失败 --> J["删除复制进来的坏文件<br/>failed: 无法解析 EPUB"]
    I -- 成功 --> K["writeCover() + repository.save()"]
    K --> L[added]
```

设计要点：

1. **路径只由主进程产生。** 渲染进程只能说「我要导入」，不能说「读 C:\某处」。即使页面被篡改，也读不到任意本地文件。
2. **单个文件失败不影响其余文件。** 报告里 `added` / `skipped` / `failed` 三个计数分别呈现。
3. **坏文件要清理。** 复制进来才发现解析不了的文件会被删掉，否则书库目录里会堆垃圾。
4. **书名兜底**：用源文件名去掉扩展名，比「未命名书籍」有用得多。

### 7.3 打开一本书并恢复进度

```mermaid
sequenceDiagram
    participant R as ReaderView
    participant Repo as BookRepository
    participant CR as BookContentReader
    participant E as epub.js

    R->>Repo: getLocator(bookId)
    R->>CR: read(bookId)
    CR-->>R: Uint8Array
    R->>R: 先 setPercent(saved.percent) 摆出进度条
    R->>E: createEpubBook(bytes)
    R->>E: renderTo(viewport, {flow:'paginated'})
    R->>E: on('relocated', ...)
    R->>E: await book.ready
    R->>R: readToc(book)
    R->>E: display(saved?.cfi)
    R->>Repo: markOpened(bookId, now)
```

两个刻意的取舍：

- **等设置读完再排版。** `settings` 为 `null` 时不进入初始化分支。否则会先用默认页边距渲染一次、读到设置后再重排，视觉上明显闪一下。
- **`markOpened` 失败不拦阅读。** 打开时间只影响书架排序，写失败用 `.catch(() => undefined)` 吞掉。

### 7.4 进度与设置的节流落盘

翻页和连点「增大字号」都会产生密集的状态变化，每次都写盘既浪费又没必要。
[throttledWriter.ts](src/renderer/src/reader/throttledWriter.ts) 是**泛型的**节流器，进度与设置都是它的薄封装：

```
push(value):
  与上次已写入的值等价        → 忽略
  与待写值等价                → 忽略
  已有定时器在等              → 直接顶替待写值（不重复排期）
  距上次写入 ≥ minIntervalMs  → 立即写
  否则                        → 排一个 (minIntervalMs - elapsed) 后的定时器

dispose():
  停表 → 把待写值补上 → await 整条写链 → 之后不再接受新值
```

- **写操作串成一条链**（`chain = chain.then(...)`），慢的写不会让后写插队。
- 进度间隔 `500ms`，设置间隔 `250ms`（设置变更远不如翻页频繁）。
- 测试必须注入固定时钟（`now: () => 0`），否则节流窗口内的合并行为无法稳定断言。

### 7.5 打开目录并跳转

`readToc(book)` 只能在 `await book.ready` **之后**调用——那时 epub.js 才把导航解析完。它把 `book.navigation.toc` 交给 `flattenToc` 摊平，再用 `resolveTocTarget` 把每个 `href` 对齐到 spine。

点击条目后调 `rendition.display(entry.href)` 并关闭抽屉。

### 7.6 阅读设置生效

```mermaid
flowchart TB
    A["SettingsPanel 触发 onChange(patch)"] --> B["normalizeReaderSettings 收敛"]
    B --> C["setSettings 更新 React 状态"]
    B --> D["writer.push 节流落盘"]
    C --> E["ReaderView 的 effect"]
    E --> F["applyReaderSettings(rendition.themes, settings)"]
    F --> G["themes.override(..., !important)"]
    G --> H["epub.js 记进 _overrides，<br/>并逐个 contents.css()"]
    H --> I["新加载的章节自动重放"]
    C --> J["pageMargin 变化 → viewport.padding + rendition.resize()"]
```

三个关键决策：

1. **页边距交给外层 `.reader__viewport` 的 padding，而不是正文样式。** 因为 epub.js 的分栏排版会给自己设 `body { padding-left/right }`，在那边改会和它的分栏计算打架。容器变窄后还必须显式调 `rendition.resize()`，否则排版停在旧宽度。
2. **所有 override 带 `!important`。** 书内 CSS 常常自带 `font-size` 与颜色，不加优先级盖不住。
3. **主题同时改两处**：`.reader[data-theme]` 上的 CSS 变量（阅读器外壳）与正文的 `color` / `background-color`（书内）。只改一处会出现「外壳黑了但正文还是白的」。

### 7.7 书签与划线

```mermaid
flowchart TB
    A["正文里选中一段文字"] --> B["epub.js 250ms 防抖后<br/>emit('selected', cfiRange, contents)"]
    B --> C["normalizeExcerpt 取摘录"]
    C --> D{"摘录非空<br/>且算得出浮条位置？"}
    D -->|否| E["不弹浮条"]
    D -->|是| F["SelectionToolbar 定位到选区上方"]
    F --> G["点『划线』"]
    G --> H["createAnnotationId() 立刻拿到 id<br/>（不等 IPC 往返）"]
    H --> I["乐观更新：新数组进 state，界面立刻出现"]
    I --> J["commitNew 里 await repo.save(...)"]
    J -->|成功| K["annotations.json 落盘"]
    J -->|失败| L["整份旧数组回滚<br/>syncer 差分把 mark 摘掉并显示失败文案"]
    I --> M["activeSyncer.sync(只挑 highlight)"]
    M --> N["与上一轮图层做差分<br/>只推新增的 add / 消失的 remove"]
```

五个关键决策：

1. **id 由渲染层生成，主进程只校验。** 渲染层为了做乐观更新不等 IPC 往返（见第 6 章 `id` 那条），主进程那边这枚 id 已经在信任边界之外，所以 `annotations:save` 会重新校验一遍长度与字符集。
2. **图层同步是差分的，不是每次全清全画。** 每次 `annotations` 变化都 `reset()` 一遍会让整本书的 mark 闪一下，而且 epub.js 的 `annotations.add` 在同一 cfi 上重复添加时会覆盖内部引用、留下孤儿 mark（见第 10 章）。所以 [annotationHighlight.ts](src/renderer/src/reader/annotationHighlight.ts) 记着上一轮的 `Map<id, { cfi, color }>`，只推差分；`reset()` 只允许出现在销毁 rendition 的那段 cleanup 里。
3. **书签是 toggle，划线是 add / remove 两个明确动作。** 书签没有正文标记，只靠位置判断「当前这页有没有书签」；划线则是「选中后再点删除」——选中一段已有划线时浮条上的主按钮会变成「删除划线」，对应 `annotations.remove(cfi, 'highlight')`。删除要点两下（选中 + 点按钮），这是刻意的：MVP 没有做「点 mark 直接删」的命中测试。
4. **翻页会收起浮条。** `relocated` 时清空选区状态，否则浮条会挂在一个已经不存在的选区上。浮条用 `position: absolute` 落在 `.reader__viewport` 内，位置不是直接拿选区坐标——选区坐标在 **iframe 内部**，必须先补上 iframe 元素相对容器的偏移。算完还有三种收口：上方放不下就翻到选区下方；左右夹在容器内；上下都放不下就落回容器顶部（分栏排版里这是常态，见 [SelectionToolbar.tsx](src/renderer/src/reader/SelectionToolbar.tsx) 的 `fallback`）。
5. **注解抽屉同时承担「跳回原文」和「删除」。** 没有它的话划线划下去就没有任何删除入口，书签的 toggle 也只能在同一页上生效，而且注解列表本身不可见。抽屉里的条目用摘录当按钮文案（没有摘录的划线、所有书签就退化成「百分比 + 类型」），保证不会出现空白按钮。

`AnnotationDrawer` 还有一条容易写错的分支：**「读不到存档」和「这本书还没有注解」是两种不同的空态**，前者显示 `ANNOTATIONS_UNAVAILABLE_MESSAGE` 且不显示空态文案，也不能让界面宣称「这本书还没有注解」——那同样是假话（磁盘上可能正躺着一份读不出来的存档）。

失败路径是这一章最值得看的部分：`useBookAnnotations` 的 `commitNew` 把「构造 + 写本地列表 + 落盘」整段包在同一个 try/catch 里（core 的工厂是 throw 语义，`save` 本身也会 reject，两者落到同一句失败文案上），`catch` 里**只做回滚**——不写状态、不发第二条 IPC、不重复上报。因为 `annotations:save` 的失败已经在主进程侧明确化了（见第 9 章的 `UnavailableAnnotationRepository`），渲染层再补一刀只会造出第二条失败路径。回滚时恢复的是**整份旧数组**，不是「把刚加的那条删掉」：`save` 内部是整份替换语义，两次操作并发时 pop 掉的可能是另一条，所以回滚也只能是整份替换。正文上的 mark 不需要在 `catch` 里手动清——`annotations` 一变，同步 effect 的差分自然把它摘掉。

---

## 8. IPC 契约

频道的字符串**只在** [src/shared/ipc.ts](src/shared/ipc.ts) 里定义一次，主进程与 preload 都从这里引用，避免两边各写一份字符串写错。

| 分组 | 频道 | 入参 | 返回 |
| --- | --- | --- | --- |
| `books` | `books:list` | — | `Book[]` |
| | `books:get` | `id` | `Book \| null` |
| | `books:save` | `Book` | `void` |
| | `books:remove` | `id` | `void` |
| | `books:get-locator` | `bookId` | `ReadingLocator \| null` |
| | `books:save-locator` | `bookId`, `ReadingLocator` | `void` |
| | `books:mark-opened` | `id`, `openedAt` | `void` |
| `library` | `library:import` | — | `BookImportSummary \| null`（取消为 `null`） |
| | `library:read-cover` | `bookId` | `BookCover \| null` |
| | `library:read-content` | `bookId` | `Uint8Array \| null` |
| `settings` | `settings:load` | — | `ReaderSettings` |
| | `settings:save` | `ReaderSettings` | `void` |
| `annotations` | `annotations:list` | `bookId` | `Annotation[]` |
| | `annotations:save` | `Annotation` | `void` |
| | `annotations:remove` | `bookId`, `annotationId` | `void` |

**协议层的职责是校验，不是转发。** 所有 handler 先跑一遍 `reviveBook` / `reviveLocator` / `reviveAnnotation` / 类型检查，非法数据直接抛错，绝不写进用户书库。

`AppBridge.annotations` 刻意用 `Pick<AnnotationRepository, 'listByBook' | 'save' | 'remove'>` 而不是另写一份声明，端口改了这里会跟着编译报错。摘掉的两个方法各有理由：

- `load()`：主进程在启动时就预读过存档，渲染层再读一次只会覆盖主进程的降级决定。
- `removeByBook()`：删书必须先删书、后删注解，这个顺序只有主进程知道；暴露给渲染层等于给「书还在、划线没了」开了个口子。渲染层的适配器（`createAnnotationRepository`）调用它会直接 reject。

新增频道时必须三处同步（[src/shared/ipc.ts](src/shared/ipc.ts)、`src/main/ipc/*Ipc.ts`、[src/preload/index.ts](src/preload/index.ts)）。

窗口配置：`contextIsolation: true`、`nodeIntegration: false`。渲染进程只能看到 `window.api` 这一个受控接口。

### 渲染进程如何选择实现

`data/create*.ts` 里的工厂函数统一用同一个模式：

```ts
const bridge = typeof window === 'undefined' ? undefined : window.api
return bridge?.books ?? new InMemoryBookRepository()
```

**有 IPC 桥就持久化，没有就退化成内存实现。** 这样纯浏览器预览与单元测试都能把 UI 完整跑通。

---

## 9. 存储布局与容错策略

```
<userData>/
  library.json                        # 书库：书籍数组 + 进度表
  settings.json                       # 阅读设置
  annotations.json                    # 注解存档：书签与划线数组
  books/<sha256>.<ext>                # 书籍副本，文件名即内容摘要
  covers/<bookId>.<ext>               # 抽取出的封面
```

**注解为什么不进 `library.json`**：`library.json` 是「每本书一个进度值」的表，而注解是集合。混在一起会让每次翻页保存进度都得重写全部划线，而且一份坏掉的划线会连带把书库一起判为损坏。代价是注解与书库是两把独立的锁、跨文件没有事务，所以「删书 + 删注解」必须在主进程同一个 handler 里顺序完成。这两条存档的恢复流程**刻意各写一份**，不复用：[annotations.ts](src/main/storage/annotations.ts) 的备份路径只从传入的 `filePath` 派生，**不硬编码文件名**；且它只认 `AnnotationCorruptError`，遇到 `LibraryCorruptError` 或 IO 失败一律原样抛出，绝不会把书库的损坏当成注解损坏去备份。这条隔离由 [annotationStorageIsolation.test.ts](tests/unit/repo/annotationStorageIsolation.test.ts) 双向钉住（`annotations.ts` 不含 `/library/i`，`library.ts` 不含 `/annotation/i`）。

仓储层另有一条写盘约定：`remove` 删一个不存在的 id、`removeByBook` 一条都没删到，都**不落盘**。删除是幂等的，重试不该把存档文件的修改时间反复刷新，也不该因为删掉一本没有注解的书就凭空造出一个空存档文件；`save` 是 upsert，命中同一条就是真的改内容，照常写。

「删书 + 删注解」落地后还多了一条降级约定：**注解没清干净不算删书失败**。书库条目已经删掉、磁盘也改了，这时候再把 `removeByBook` 的失败抛回渲染层，只会让界面宣称「删除失败」，而用户重试也删不掉一本已经不存在的书。所以主进程只 `console.warn` 一次，把这份孤儿注解留在存档里——它对应的书已经不在书库，界面永远读不到它。风险留在主进程日志里，比骗用户去重试一件已经完成的事要小。

数据目录由 `app.getPath('userData')` 决定，可用环境变量 `EBOOK_READER_USER_DATA` 覆盖。

### 写盘：先临时文件再改名

[FileTextStore](src/main/storage/fileTextStore.ts) 与 [FileBookStore](src/main/import/fileBookStore.ts) 都采用 `写 .tmp → rename` 的原子替换。中途被强杀也不会留下半个 JSON 把书库彻底读坏。

### 读盘：两套不同档次的容错

| 文件 | 损坏时的行为 | 理由 |
| --- | --- | --- |
| `library.json` | **备份**为 `library.json.corrupt-<时间戳>`，以空书库启动并 `console.warn` | 书库是用户数据，不能删；同时应用必须永远能起来 |
| `settings.json` | 静默回落默认配置，**不留备份** | 配置读不出来不值得中断启动，也不值得留垃圾文件 |
| `annotations.json` | **备份**为 `annotations.json.corrupt-<时间戳>`，以空存档启动 | 划线是用户自己敲出来的内容，属于用户数据，不能删 |

`library.json` 与 `annotations.json` 的解析都是**宽容**的：整份文件不是合法 JSON / 根节点不是对象才算「损坏」（分别抛 `LibraryCorruptError` 与 `AnnotationCorruptError`）；单条记录坏了只丢弃那一条并计入 `dropped`。没有对应书籍的进度被当作垃圾数据丢弃，避免无限增长；注解存档独立成档，没有 `books` 数组，也就没有「孤儿记录」那一档。

**`dropped` 是三种原因的合并计数**，两边同义：[ParsedLibrary](src/core/adapters/librarySnapshot.ts:38) 把「书籍字段非法」「孤儿进度」「进度字段非法」加在一起，[ParsedAnnotations](src/core/adapters/annotationSnapshot.ts:71) 把「注解字段非法」「同一 `(bookId, id)` 重复」「超出上限被裁」加在一起。其中「孤儿进度」与「超限裁剪」**不是数据损坏**，而是有意的回收，所以这个数偏大并不等于存档有问题。它现在只有测试在读（两个仓储的 `ensureLoaded` 都直接丢弃），界面真要区分「数据坏了」和「正常回收」，得先把这个数拆成明细。

注解的恢复流程与书库的**刻意不共用**，且比它多一道守卫：备份用的 `rename` 失败时（Windows 上文件被占用是常态）**跳过那次重读**。磁盘上躺着的仍是那个坏文件，再读一次必然二次抛错，而 `openAnnotations` 里没有 `catch` 兜住它。书库那边的恢复流程正是踩在这个点上：一旦 `rename` 抛错，`openLibrary` 会把 `LibraryCorruptError` 二次抛出去——它注释里那句「备份失败不应阻止应用启动」并没有做到。[library.ts](src/main/storage/library.ts) 刻意不动这个逻辑（改了要重新论证一遍书库的恢复语义），这个洞改由下面的启动层兜住，并由 [startup.test.ts](tests/unit/main/startup.test.ts) 直接钉住「`openLibrary` 会抛、启动层仍然给得出可用书库」。`recoveredFiles` 的语义两边保持一致：只表示「这次是救回来的启动」，不表示备份真的成功。

### 启动期：读不出存档也能起来

[openStorageForStartup](src/main/storage/startup.ts) 把上面两道容错包在一起，**任何情况下都返回可用对象，从不抛错**。它在启动链上的位置见 [src/main/index.ts](src/main/index.ts)。

| 情形 | 行为 | 落盘吗 |
| --- | --- | --- |
| 正常 / 文件不存在 | 用 JSON 仓储（懒加载） | 落盘 |
| 存档**损坏** | 由 `openLibrary` / `openAnnotations` 备份改名后以空存档启动 | 落盘（写的是新文件） |
| 存档**打不开**（路径被目录占住、权限不足、被占用） | 书库回落内存实现；注解回落 `UnavailableAnnotationRepository`（四个数据方法一律失败）。各自记一条 `console.warn` | **不落盘** |

第三档为什么不能是「拿同一套 JSON 仓储再试一次」：那个仓储刚在 `openAnnotations` / `openLibrary` 里连 `load()` 都没走通，`loaded` 永远停在 `false`，接下来的每一次读写都会重新抛同一个异常——等于整场会话的功能全废。这一条只解决了「不抛错」，没有解决「用户以为存下来了」。

于是注解这一半改用 [UnavailableAnnotationRepository](src/main/storage/unavailableAnnotationRepository.ts)：**四个数据方法一律 reject**，`load()` 是唯一保持 resolve 的方法（它在桥接实现里本来就是空操作，且在启动链上没有调用方，不该给启动链引入一个可能被忽略的 rejection）。原因是内存实现留下了一条真正危险的路径：它的 `save` 会 resolve 并在内存里留下副本，于是渲染层的乐观更新一路走通、界面如实显示「已保存」，而磁盘上什么都没有——用户关掉应用就丢掉了整个会话的标注，全程没有任何提示。这是唯一一条「界面说存了、磁盘没有」的真实路径，**渲染层权限内没有任何办法察觉到它**，只能由主进程在源头把写入变成明确失败。

读也一起失败是有意为之：`listByBook` 返回空数组会让界面宣称「这本书还没有注解」，那同样是假话（磁盘上可能正躺着一份读不出来的存档），还会把用户引向「重新标一遍」，可重新标一样会失败。四方法装死之后，整个功能一致地表现为「本次会话用不了」，渲染层只要走它本来就有的失败与回滚路径即可。

书库那一半**暂且保留内存实现**：这是同一类问题（`InMemoryBookRepository.save` 同样会 resolve），但它的影响面是书架列表而不是阅读界面，留给后续单独处理，免得一次改动同时动两套界面行为。

两种回落都保证磁盘上那份文件一个字节都不会动（[startup.test.ts](tests/unit/main/startup.test.ts) 逐字节钉住了这一点）。

两个存档**各自独立降级**：注解读不出来不影响书库落盘，反之亦然。降级不是静默的，每条都会在控制台留下能区分「书库」和「注解」的警告。

启动链最后还有一道 `catch`：走到那里说明已经不是存档问题（注册 IPC、建窗口失败），此刻没有可降级的余地，于是弹一个看得懂的 `showErrorBox` 再退出，而不是留下一个没有窗口、用户也杀不掉的进程。

### 路径越界防护

`FileBookStore` 所有按路径操作的接口都先过 `resolveInside`：解析后的绝对路径必须以书库目录为前缀，否则一律拒绝。即使书库存档被手工篡改成 `filePath: C:\Windows\...`，也读不出书库以外的文件。

### 文件大小限制

单本书上限 512 MB（`MAX_BOOK_FILE_SIZE`），防止误选超大文件把内存打满。空文件也会被拒绝。

---

## 10. epub.js 集成要点

这些是读源码 + 实测确认的行为，改动阅读器前值得先看一遍：

| 事实 | 影响 |
| --- | --- |
| `book.navigation` 是**同步属性**（`Navigation` 实例），`book.loading.navigation` 才是 Promise | 必须 `await book.ready` 之后再读目录 |
| `navigation.toc` 元素形状为 `{ id, href, label, subitems, parent }`，NCX 与 EPUB 3 nav 产出同形；无导航时是 `[]` | `flattenToc` 只需处理一种形状 |
| `book.destroy()` 会把 `navigation` 置为 `undefined` | 卸载顺序要先 `rendition.destroy()` 再 `book.destroy()` |
| `rendition.display(href)` 支持带 `#fragment` 的 href，但**只跳到该章开头** | MVP 不做段内精确定位 |
| `themes.override(name, value, priority)` 写进 `_overrides`，并对当前每个 `contents.css()`；`overrides()` 注册在 `rendition.hooks.content` | 所以**新章节会自动重放**，翻章后设置依然生效 |
| `contents.css()` 设在 `document.body` 的 **inline style** | E2E 可以直接从 iframe 的 `body[style]` 里读 `font-size` 来验证设置真的生效了 |
| `layout.format()` → `contents.columns()` 会给 body 设 `padding-left/right` | 所以页边距交给外层容器，不与之争抢 |
| `rendition.resize(width?, height?)` 存在，但容器尺寸变化**需要显式调用** | 页边距改变后必须调 `resize()` |
| `spine.get(target)` 会 `split('#')[0]` 再查表，`append()` 同时注册 decodeURI / encodeURI / 原样三种键 | 目录 href 的匹配要照顾编码差异 |
| `unpack` 会把 manifest 的 `properties` 追加进 spine item 的 properties 数组 | nav 项不在 spine 里，因此永不进 spineItems |
| `findNavPath` 用选择器 `item[properties~='nav']` | manifest 的 `properties` 必须是空白分隔的词列表 |
| `book.destroy()` / `ePub()` 对输入 ArrayBuffer 有引用计数 | 传入前先复制成独立的 ArrayBuffer |
| 选区走 iframe 文档上的 `selectionchange`，且 `onSelectionChange` 里有 **250ms 防抖** | 选中后浮条不会立刻出现，E2E 必须留出等待时间；`range.collapsed` 为真时干脆不发事件 |
| `rendition.on('selected', (cfiRange, contents) => ...)` 的第二个参数是**真的 `Contents`**（`rendition.js` 从 `EVENTS.CONTENTS.SELECTED` 转发而来） | 取摘录与算浮条位置都靠它，不必自己去翻 `rendition.getContents()` |
| `annotations.add(type, cfiRange, data, cb, className, styles)` 是六参数，`remove(cfiRange, type)` 的内部哈希是 `encodeURI(cfiRange + type)` | 同一个 cfi 重复 `add` 会把 `_annotations` 里的引用覆盖掉，却留下一枚再也清不掉的孤儿 mark |
| 划线的 SVG 分组由 `marks-pane` 渲染，挂在**宿主文档**的阅读区里（不在 iframe 内），`ref` 属性默认是 `epubjs-hl` | E2E 可以直接在主 frame 上数 `[ref^="epubjs-hl"]`，不必进 iframe |
| `annotations` 用 `rendition.hooks.render` / `hooks.unloaded` 注册 `inject` / `clear` | 新章节渲染时会自动重放已有标注，重启后只需把存档重新 `add` 一遍 |

**ArrayBuffer 的坑**（启动阅读器时最容易踩）：`Uint8Array.buffer` 的类型包含 `SharedArrayBuffer`，不能直接传给 `ePub()`。`createEpubBook` 会先做一份独立副本：

```ts
const copy = new Uint8Array(bytes.byteLength)
copy.set(bytes)
return ePub(copy.buffer)
```

---

## 11. 测试体系

### 为什么这样分层

`core` 层不碰 `fs`、不碰 DOM，所以**绝大部分业务逻辑可以用极快的纯函数测试覆盖**，只有真正涉及文件系统、IPC、渲染的部分才需要更重的测试手段。

| 层 | 手段 |
| --- | --- |
| `core` 领域与解析 | 纯函数单测，喂内存数据 |
| `core` 适配器 | **契约测试**：`bookRepositoryContract.ts` 一份用例，内存实现与 JSON 实现共用；注解仓储另有一份针对「并发写 + 懒加载 + 上限」的单测 |
| `main` 协议与落盘 | 假 `ipcMain` + 临时目录（`mkdtemp`）真实读写 |
| 渲染进程组件 | Testing Library + jsdom，通过 Provider 注入假桥 |
| 整机行为 | Playwright + 真实 Electron 进程 |

### 单元测试地图（58 文件 / 672 用例）

| 分组 | 文件数 | 用例数 | 关注点 |
| --- | --- | --- | --- |
| `core/domain` | 7 | 142 | 归一化、复活、排序、进度换算、目录摊平与目标解析、书签划线的收敛与拒绝 |
| `core/epub` | 3 | 44 | OPF / container 解析、封面抽取、路径越界拒绝 |
| `core/adapters` | 8 | 129 | 契约测试、JSON 快照分片容错、串行化、注解存档的宽容解析与并发写、`dropped` 的合并语义 |
| `core/services` | 1 | 13 | 导入编排：去重、坏文件清理、书名兜底 |
| `main` | 10 | 122 | IPC 入参校验、书库与注解的恢复流程、启动期兜底降级（含「写入即失败」的注解仓储）、删书时「先删书、后删注解」的顺序与清理失败的降级、文件落盘与越界防护、设置存储 |
| `renderer/data` | 5 | 14 | 有无 IPC 桥时的实现选择、注解适配器的 `removeByBook` 拒绝 |
| `renderer/reader` | 14 | 157 | 节流器、外观应用、目录读取、设置 hook、`ReaderView` 交互、注解 id 的三档降级、划线图层差分、注解数据 hook、选区浮条与注解抽屉 |
| `renderer/shelf` | 5 | 31 | 书架渲染、导入结果文案、封面占位、删除 |
| 其他 | 2 | 7 | `App` 路由切换、`runtime` 版本标签 |
| `tests/support` | 1 | 3 | fixture 确定性：zip 时间戳固定、同输入同字节 |
| `tests/unit/repo` | 2 | 10 | `.claude/agents` 子 Agent 定义：命名、frontmatter 完整、在 `AGENTS.md` 里被引用、无命令执行能力；注解与书库存储层的源码级隔离 |

`tests/unit/reader/ReaderView.test.tsx`（42 例）是最重的一个文件：用一个 `fakeEpub` 把 epub.js 的全部对外行为替换掉，从而在不启动 Electron 的情况下断言「目录抽屉开关」「设置变化后 override 被调用」「pageMargin 变化后 resize 被调用」「书签 toggle」「划线走 `selected` → 注入图层」「翻页收起浮条」这类交互。

### 测试夹具：现场生成 EPUB

[tests/support/epubFixture.ts](tests/support/epubFixture.ts) 用 JSZip **当场拼**一个最小可用 EPUB，而不是提交一个二进制 fixture。好处：

- 改了结构，断言立刻跟着变；
- 能轻易造出各种残缺版本：缺 `container.xml`、缺书名、封面路径越界、是 zip 但不是 EPUB；
- 支持通过 `navItems` 生成 EPUB 3 导航文档（`nav.xhtml` + `properties="nav"`，OPF 版本切到 `3.0`），用来造嵌套目录。

它还必须**字节确定**：生成前把所有 zip 条目的时间戳统一盖成 `FIXTURE_DATE`。JSZip 默认给每个条目盖当前时间，而 zip 的 DOS 时间戳只有 2 秒精度，同一份 fixture 生成两次就会得到不同字节，一切按内容哈希判等的断言都会随机失败。注意 `zip.file` 的 `date` 选项只作用于显式添加的文件，JSZip 隐式补出的目录条目（`META-INF/`、`OEBPS/`）仍取当前时间，所以固定动作统一放在生成那一步，并由单测钉住。

### 端到端测试（13 条）

| # | 用例 | 验证的核心契约 |
| --- | --- | --- |
| 1 | 应用启动后展示书架空态 | 冷启动不崩、空态文案 |
| 2 | 通过 IPC 保存的书籍会落盘并在重启后重新出现 | `books:save` → `library.json` → 重启可读 |
| 3 | 通过 IPC 保存的注解会落盘，重启后仍然读得到 | `annotations:save` / `remove` → `annotations.json` → 重启可读；非法 id 被主进程挡在信任边界外 |
| 4 | 导入 EPUB 后书籍进入书架并落盘，重启后依然在 | 完整导入链路 + 持久化 |
| 5 | 点开书架上的书会进入阅读器，翻页后能返回书架 | 渲染 + 翻页 + 返回 |
| 6 | 阅读进度会落盘，重开应用后从上次位置继续 | CFI 往返 + 节流落盘 |
| 7 | 重复导入同一本书会被跳过而不是复制第二份 | 内容级去重 |
| 8 | 目录会列出章节，点击条目后正文跳到对应章节 | 嵌套目录渲染 + 跳转确实换章 |
| 9 | 阅读设置会落盘，重开应用后依然生效 | 设置作用到书内样式 + 节流落盘 + 重启恢复 |
| 10 | 渲染进程的 WebCrypto 满足注解 id 生成的降级假设 | `file://` 主框架是安全上下文、`randomUUID` 与 `getRandomValues` 都在、产出的 id 落在 core 白名单内 |
| 11 | 在正文里划线会落盘，重启后重新画回正文 | iframe 选区 → CFI → 摘录 → 乐观更新 → `annotations.json`；重启后 `ref="epubjs-hl"` 的 mark 被重新注入 |
| 12 | 删掉已有的划线后，重启也不会再画回来 | `annotations:remove` 真的落盘，且列表、正文标记、存档三处一起消失 |
| 13 | 删书会连这本书的注解一起清掉，再导入同一个文件不会复活 | `books:remove` 在主进程里按「先删书、后删注解」收尾；`annotations.json` 里这本书的条目与正文标记一起消失 |

E2E 基础设施的三个要点：

1. **每个用例用独立的临时数据目录**（`mkdtemp` + `EBOOK_READER_USER_DATA`），互不干扰且不污染真实书库。
2. **原生文件选择框无法自动化**，所以在主进程里替换 `dialog.showOpenDialog` 的返回值。
3. **正文在 iframe 里**，且转场期间新旧两章会同时存在，所以收集正文时要遍历全部非主 frame 并 join；断言字号则读 `body` 的内联 `style`。

第 10 条是**探针**用例，不是功能验证：`crypto.randomUUID()` 是安全上下文限定接口，而 jsdom 里的 `crypto` 是 Node 泄进全局的 webcrypto，两者不是一回事，单测证明不了生产环境真的能拿到第一档。这条用例在真实渲染进程里读 `isSecureContext` 与两个接口的存在性，并顺手验证 200 个 id 互不重复、且每一个都落在 core 的白名单内——也就是「渲染层产出 → 主进程校验」这条唯一契约。当前实测结论：生产用 `file://` 加载页面，Chromium 把 `file://` 视为可信来源，所以 `isSecureContext === true`、`randomUUID` 可用，第一档就是真实生产路径；第二、三档只是防线。

第 11、12 条是这两条注解用例最值钱的地方：**它们是唯一能证明「界面 → IPC → 磁盘 → 重启 → 界面」整条链真的通了的测试**。单测里 epub.js 被 `fakeEpub` 整个换掉，也就顺带把「选区事件到底由谁发、CFI 长什么样、mark 到底挂在哪个文档」全部假设掉了；而这三件事恰好都是靠读源码才确认下来的（见第 10 章）。两条用例各有一次 `page.reload()`，重启后的断言不再依赖任何内存状态。

划线用例里有几个刻意的写法值得注意：选区是在 **iframe 内部**用 `Range` 建的（正文在 iframe 里，主 frame 上没有可选的文字）；建完**不派发 `selectionchange`**，靠 Chromium 自己的默认行为触发（epub.js 监听的就是这个事件），但如果换非 Chromium 内核就要显式补上；E2E 侧必须留出等待，因为 epub.js 的选区回调带 250ms 防抖。数标记时选择器落在 `.reader__viewport [ref^="epubjs-hl"]`——**mark 在宿主文档里，不在 iframe 里**，写进 iframe 里数会一直是 0。

第 13 条走的是另一条容易漏掉的路径。`bookId` 是文件内容的 `sha256`，所以「删掉一本、再导入同一个文件」会拿到**同一个 id**；用例正是拿这一点当探针——主进程如果只删了书库条目而漏掉注解，旧书签与划线会在重新导入后原样回到界面上。它同时钉住了顺序：反序（先删注解、再删书）在删书失败时会留下「书还在、书签与划线全没了」的真数据丢失，而正序最坏也只是留下一份孤儿注解。

### 关于 `npm run verify`

```
verify = typecheck && test && test:e2e
test:e2e = build && playwright test
```

注意 `test:e2e` **先构建再测**：E2E 跑的是 `out/` 里的产物，不是源码。所以只改源码不重新构建，E2E 会测到旧版本——这也是把 `build` 写进脚本的原因。

---

## 12. 开发规范

[AGENTS.md](AGENTS.md) 里立了两条硬性规范，本项目的每一次改动都遵守：

> 1. 每次改动完成后都必须创建一个对应的 Git commit，以便后续追踪和回滚。
> 2. 每次改动后都必须编写和更新相关测试，并在交付前确保所有的测试和验证全部通过。

落成可执行的约定就是：

- **一次改动 = 一个 commit**，不攒大批改动一起提交。粒度上按「可独立回滚的最小完整单元」拆。
- **交付前必须 `npm run verify` 全绿**，不接受「单测过了就行」。
- 提交信息用中文 conventional commits（`feat:` / `fix:` / `test:` / `docs:` / `chore:`），并在末尾附 `Co-authored-by` trailer。

### 用 `.claude/agents` 约束 Agent

[AGENTS.md](AGENTS.md) 是入口，[.claude/agents/](.claude/agents) 是把它拆成可执行动作的子 Agent 定义：

| 定义 | 用途 |
| --- | --- |
| [verify-runner.md](.claude/agents/verify-runner.md) | 拟出验证命令与判定标准，交人类执行（只读，不跑命令） |
| [layering-guard.md](.claude/agents/layering-guard.md) | 审查改动是否破坏分层与安全边界（只读） |
| [test-author.md](.claude/agents/test-author.md) | 按本仓库约定补测试、修测试确定性（只写文件，不跑命令） |
| [commit-crafter.md](.claude/agents/commit-crafter.md) | 起草提交信息与提交命令，交人类执行（只读，不提交） |

**这四个定义都没有命令执行权限。** 它们只产出文件与「给人类执行的命令清单」，跑命令、验证绿灯、真正提交三件事一律由人类或主 Agent 完成。

这不是洁癖，是踩出来的：具名子 Agent 拿不到 shell，而定义里写着 `tools: ... Bash` 时，流程中的「跑 `npm run verify`」「`git commit`」看起来是步骤，实际根本无法执行——它只会产出一份「测试全绿」的汇报，而那个绿是编出来的。**最危险的幻觉不是做错，是声称做过。** 所以现在的定义里明确写了「你没有执行命令的权限，必须输出命令给人类审核」，并且用测试钉住。

写这些定义时还踩到一个反直觉的点：**`import.meta.url` 在 vitest 里只有测试回调内联读到的那次是本文件路径**，在模块作用域或辅助函数里读到的是错值，而且不报错。所以守护测试用 `process.cwd()` 定位仓库根。

这些定义的格式由 [tests/unit/repo/agentDefinitions.test.ts](tests/unit/repo/agentDefinitions.test.ts) 守卫：文件名必须是 kebab-case、`name` 必须与文件名一致、必须有 `description`、每个定义都要在 `AGENTS.md` 里被引用、`tools:` 里不含任何命令执行能力、正文必须声明自己没有命令执行权限。**格式错的子 Agent 定义不会被任何工具报出来，只会静默不生效**，所以必须用测试钉住。

### Windows / PowerShell 环境注意

- 本项目在 Windows 上开发，PowerShell 为 **5.1**（不支持 `&&`、`||`、`??`、`?.`）。命令串联请用 `;` 配合 `if ($?) { ... }`。
- 若 Node.js 未进默认 PATH，需在命令前追加：`$env:Path = "D:\tools\node;" + $env:Path`。
- **提交信息不要用 `Out-File -Encoding utf8` 生成**——它会写入 BOM，让 subject 变成 `\ufefffeat: ...`。改用编辑器/文件写入工具创建，再 `git commit -F <file>`。

---

## 13. 迭代历程

按阶段推进，每个阶段都是一个可独立验证的完整单元。

| # | 提交 | 阶段 | 内容 |
| --- | --- | --- | --- |
| 1 | `f226e76` | 规范 | 添加 `AGENTS.md`，确立两条硬性规范 |
| 2 | `2653a7f` | 规范 | 添加 `.gitignore` |
| 3 | `3d537d1` | 阶段一 | 搭建 Electron + React + TypeScript 工作台：electron-vite 三份产物配置、双 tsconfig、Vitest + Playwright 闭环 |
| 4 | `a68f6ec` | 阶段二 | core 纯逻辑层与书架数据流：Book / ReadingLocator 模型、仓库端口、内存实现、`useBooks`、书架 UI |
| 5 | `acbc1db` | 阶段三·上 | 书库持久化与 IPC 桥：`library.json` 快照、损坏恢复、`books:*` 频道、preload 桥、Provider 注入 |
| 6 | `e62d5e8` | 阶段三·下 | EPUB 导入与元数据抽取：zip 解析、OPF/container 解析、`FileBookStore`、导入编排与去重 |
| 7 | `5324004` | 阶段四 | 书架封面显示：封面抽取落盘、`books:read-cover`、data URL 渲染与占位块 |
| 8 | `7fdcd74` | 阶段五 | EPUB 渲染与翻页：`createEpubBook` 适配层、`ReaderView`、`books:read-content` |
| 9 | `4a88152` | 阶段六 | CFI 阅读进度持久化：进度换算、节流落盘器、恢复位置、书架进度条 |
| 10 | `a3924ca` | 阶段七·上 | 阅读设置落盘与跨进程 IPC 桥接：设置模型、JSON 仓库、`settings:*` 频道 |
| 11 | `50420f0` | 阶段七·下 | 目录跳转与阅读设置面板：目录领域模型、抽屉、设置面板、外观应用 |
| 12 | `cad1c7e` | 收尾 | 修正测试文件里的类型标注问题 |
| 13 | `a38bf99` | 收尾 | 补 `settings.ts` 落盘的单测 |
| 14 | `93c0ac5` | 收尾 | 覆盖目录跳转与阅读设置落盘的 E2E，fixture 支持 EPUB 3 导航 |
| 15 | `758309c` | 收尾 | 固定 fixture 的 zip 时间戳，修掉重复导入用例的偶发失败 |
| 16 | `9b5229b` | 文档 | 补项目总文档 `README.md` |
| 17 | `961b881` | 规范 | 添加 `.claude/agents` 子 Agent 定义纳入 Git，用单测守卫格式并在 `AGENTS.md` 里引用 |
| 18 | `338c2bf` | 功能 | 书签与划线的领域模型：判别联合、CFI 长度上限、href 拒绝 scheme |
| 19 | `09df618` | 规范 | 收窄子 Agent 能力边界：删掉 `tools:` 里的执行能力、声明无命令权限、用单测钉住 |
| 20 | `206253d` | 功能 | 书签与划线的存档层：`AnnotationCorruptError`、`annotations.json` 快照、JSON 仓储、独立于书库的恢复流程 |
| 21 | `f996cfe` | 文档 | 回填迭代历程第 20 行的提交号 |
| 22 | `8fe071f` | 功能 | 注解 id 的三档降级与 E2E 探针；`remove` 对齐「零改动零写盘」 |
| 23 | `07eeab4` | 文档 | 写明 `dropped` 是三种原因的合并计数，并用单测钉住 |
| 24 | `cb4e85f` | 功能 | 接通注解 IPC 与启动兜底：`annotations:*` 频道、`AnnotationRepository` 适配器与 Provider、启动期降级到内存实现、R4 窗口起不来一并堵住 |
| 25 | `605e804` | 修复 | 注解的启动降级改为「写入即失败」：新增 `UnavailableAnnotationRepository`，不再回落到会 resolve 的内存实现 |
| 26 | `b7a5c74` | 功能 | 阅读界面接线书签与划线：选区浮条、注解列表抽屉、划线图层差分同步、注解数据 hook，并补齐两条端到端用例 |
| 27 | `8ff8278` | 功能 | 删书时一并清掉该书的注解：主进程 handler 按「先删书、后删注解」收尾、清理失败降级为告警，并补齐单测与端到端用例 |

### 过程中沉淀下来的经验

- **架构规则要交给编译器执行。** 「core 层不许用 DOM」如果只写在文档里，迟早会被违反；把 node 工程的 `lib` 去掉 DOM，违规代码就直接编译不过。
- **去重键选内容摘要而不是路径。** 用户从不同目录导入同一本书是很常见的，`sha256` 让这种情况天然免于产生副本。
- **容错要分档次。** 用户数据（书库）值得备份 + 恢复流程；配置数据（设置）静默回落就好。用同一套逻辑处理两者，只会带来不必要的复杂度。
- **性能优化要选对代价。** 果断放弃 `locations.generate()`，用「章节 + 页码」近似进度——对 MVP 而言精度足够，代价低一个数量级。
- **节流逻辑抽成泛型。** 进度和设置的节流语义完全一样，抽成 `createThrottledWriter<T>` 后两者都只是几行封装，测试也只需写一份。
- **测试夹具用生成而非存储。** 二进制 fixture 改不动也看不懂，现场生成让「造一个畸形的 EPUB」变成一件顺手的事。
- **生成的夹具必须字节确定。** 「现场生成」的代价是要自己保证确定性：时间戳、随机数、遍历顺序里任何一个不确定，按内容哈希判等的断言就会随机失败，而且只在跨过时间边界时复现——这类 flaky 比真 bug 更难查。

---

## 14. 已知限制与后续规划

### 当前限制

- 只渲染 EPUB；TXT 虽然能识别格式与导入，但正文渲染未实现。
- 目录跳转只到章首（`display(href)` 的行为），不做段内精确定位。
- 进度按「章节 + 页码」估算，与按字符数统计的真实进度略有偏差（已读阈值取 99.5%）。
- 单窗口，无标签页。
- 未做打包分发（`electron-builder` 等）。
- 封面以 data URL 内联，大封面会略微增加内存占用（换来的是不必手工释放 object URL）。
- 划线的进度百分比沿用「最近一次 `relocated` 的位置」做近似，不是划线本身在书里的位置。同章内翻页不影响，跨章标出来再回头翻页时会略有偏差。
- **删书不回收磁盘文件**。删掉一本书会清掉书库条目、阅读进度与它的注解，但 `books/` 下的 epub 与 `covers/` 下的封面仍然留在磁盘上——`FileStore` 端口至今只有一个 `remove(filePath)`，够不到封面。`bookId` 是文件内容的 `sha256`，这些残留文件不会再被书库引用到，只是白占空间。回收是下一轮的活。

### 后续方向

1. **TXT 渲染通道** —— 与 EPUB 并列的第二种阅读后端，复用现有的进度与设置体系。
2. **书签与划线的细节打磨** —— 主链路已经通了：领域模型（[annotation.ts](src/core/domain/annotation.ts)，见第 6 章）、存档层（[annotations.ts](src/main/storage/annotations.ts)，见第 9 章）、`annotations:*` IPC 与渲染层适配器，以及界面（[ReaderView.tsx](src/renderer/src/reader/ReaderView.tsx) 的接线 + [SelectionToolbar.tsx](src/renderer/src/reader/SelectionToolbar.tsx) / [AnnotationDrawer.tsx](src/renderer/src/reader/AnnotationDrawer.tsx)）。剩下的都是体验层：划线的颜色切换 UI（core 已支持四种颜色，界面固定用默认黄）、注解的导出导入、书签在正文里的视觉标记、跨分栏重排后的位置修正。刻意**不复用 `ReadingLocator`，也不把注解塞进 `library.json`**：locator 是每本书一个的单值，注解是集合，混在一起会让每次翻页都重写全部划线。代价是注解与书库是两把独立的锁、跨文件没有事务，所以「删书 + 删注解」必须在主进程同一个 handler 里顺序完成。
3. **删除时的磁盘文件回收** —— 删书现在只清数据、不动文件：`books/` 下的 epub 与 `covers/` 下的封面会留下来。要回收得先给 `FileStore` 补一个删封面的 API，再让主进程的删书 handler 按「先删数据、后删文件」的顺序收尾——反序的话删数据失败就会留下「书还在、文件没了」的坏记录，而正序最坏只是留下几个没人引用的文件。
4. **全文搜索** —— 需要预建索引，是第一个真正需要 `locations.generate()` 级别代价的功能。
5. **书库组织** —— 排序/筛选、分组、标签。
6. **打包分发** —— 代码签名、自动更新、便携模式（`EBOOK_READER_USER_DATA` 已经为便携模式留好了口子）。
