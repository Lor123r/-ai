# 0016 百分比高度在安卓 WebView 里解析不出来

## 现象

电子书阅读器打包成 APK 装到荣耀 X40 上，书架正常，点开书之后**正文变成屏幕右侧一条竖排窄条**：
汉字从上往下堆成一列，左边留一大片空白，整页几乎没内容。

同一份代码在桌面 Electron 里正常，在 Edge 里把视口压到 360×800 也正常。

相关 CSS：

```css
.reader__body {
  position: relative;
  flex: 1;          /* 高度来自 flex-grow，属于「不确定高度」 */
  min-height: 0;
}

.reader__viewport {
  height: 100%;     /* ← 问题在这 */
  width: min(900px, 100%);
  overflow: hidden;
}
```

正文由 epub.js 用 `flow: 'paginated'` 渲染进 `.reader__viewport`。

## 根因

**`height: 100%` 的百分比要有一个「确定高度」的父级才能解析。**
`.reader__body` 的高度来自 `flex: 1`，是 flex 算法算出来的，不是显式高度。

- 桌面 Chromium：会把子元素的 `height: 100%` 解析成 flex 算出的那个高度。
- 安卓 WebView：按 `auto` 处理，于是 `.reader__viewport` 高度算成 **0**。

epub.js 拿到高度 0 之后，分页时算不出「一页能放多少字」，就把内容塞进一个极窄的列；
CJK 在极窄列里再触发竖排回退 —— 于是看到的就是那条竖排窄条。

**这个 bug 本地复现不了。** 我先写了 360×800 的 Playwright 用例，改 CSS 前后**都是绿的**，
因为桌面 Chromium 会替你把百分比解析掉。真机才暴露。

## 结论

**高度要由 flex 给，不要写 `height: 100%`。**

```css
.reader__body {
  display: flex;          /* 父级必须是 flex 容器 */
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.reader__viewport {
  flex: 1;                /* 高度由父级 flex 直接给出，不经过百分比解析 */
  min-height: 0;
  overflow: hidden;
}
```

`min-height: 0` 不能省：flex 项默认 `min-height: auto`，内容撑高时不会收缩。

配套还要**在容器尺寸变化时显式 `resize()`**。原来只在 `pageMargin` 变化时调，
而首帧渲染时容器往往还没拿到最终尺寸（安卓上系统栏、软键盘都会改变可用高度），
epub.js 一旦按错误尺寸分好页就会一直停在那里：

```ts
useEffect(() => {
  const viewport = viewportRef.current
  if (!viewport || typeof ResizeObserver === 'undefined') return
  const observer = new ResizeObserver(() => renditionRef.current?.resize())
  observer.observe(viewport)
  return () => observer.disconnect()
}, [settingsReady])
```

顺带覆盖了旋转屏幕与窗口缩放。

**测试要断言结构，不要断言外观。** 外观断言在桌面 Chromium 里守不住这个 bug：

```ts
// 守得住：谁把 flex: 1 改回 height: 100%，这条就红
expect(getComputedStyle(viewport).flexGrow).toBe('1')
expect(getComputedStyle(viewport).height).not.toBe('100%')
expect(getComputedStyle(body).display).toBe('flex')
```

## 反例

不要用「本地跑通了」当作「真机没问题」的证据 —— 宿主换掉之后，
**布局引擎的容错行为也会换**。桌面 Chromium 对不确定高度的百分比是宽容的，
安卓 WebView 不是。

```css
/* 错：父级高度不确定时，安卓 WebView 解析成 auto，epub.js 量到 0 */
.reader__viewport { height: 100%; }

/* 对：高度由 flex 给出 */
.reader__viewport { flex: 1; min-height: 0; }
```

也不要只写外观断言就以为守住了：

```ts
// 错：改不改 CSS 都是绿的，因为桌面会替你把百分比解析掉
expect(await frameWidth()).toBeGreaterThan(200)

// 对：直接断言「高度不依赖百分比解析」这个结构事实
expect(getComputedStyle(viewport).flexGrow).toBe('1')
```

同类风险：`height: 100%` 套在 `flex: 1` 的父级里、`min-height: 100%` 套在
`min-height: 0` 的父级里、以及任何「父级高度靠 flex 算」的百分比高度。
