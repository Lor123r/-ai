# 0017 正文在 iframe 里，父文档的监听收不到它的事件

## 现象

给阅读器加翻页手势：在容器上绑 `pointerdown` / `pointerup`，点屏幕左右两侧翻页。
桌面 Electron 里点正文**毫无反应**，点正文以外的留白区域却正常翻页。

同一份代码，`e2e-web` 里用 `page.mouse.click()` 点正文也测不出问题 ——
Playwright 的点击会落到 iframe 上，但事件确实没冒泡到父文档。

## 根因

**EPUB 正文由 epub.js 渲染进一个 `<iframe>`，iframe 有自己独立的 `document`。
事件不会跨文档冒泡。**

父文档上绑的监听只能收到落在父文档自身元素上的事件。正文占满了可视区，
于是「点正文」这条最主要的交互路径整个失效，而留白区域恰好是父文档自己的元素，
所以看起来像「时灵时不灵」。

更麻烦的是 **epub.js 每次翻页都会重建 iframe**。就算在初始化时拿到了
`rendition.getContents()[0].document`，翻一页之后那个 document 就作废了，
监听绑在一个已经不在 DOM 里的文档上。

## 结论

**手势监听要同时绑父文档和 iframe 的 document，并且每次 iframe 重建后重新绑。**

epub.js 在每次渲染完成时发 `rendered` 事件，参数是 `(section, view)`，
iframe 的 document 在 `view.contents.document`：

```ts
rendition.on('rendered', (_section, view) => {
  setInnerDocument(view?.contents?.document ?? null)
})
```

把 `innerDocument` 作为依赖传给手势 hook，hook 内部对两个 document 各绑一份：

```ts
useEffect(() => {
  const targets = [document, innerDocument].filter(Boolean)
  for (const target of targets) {
    target.addEventListener('pointerdown', handlePointerDown)
    target.addEventListener('pointerup', handlePointerUp)
  }
  return () => {
    for (const target of targets) {
      target.removeEventListener('pointerdown', handlePointerDown)
      target.removeEventListener('pointerup', handlePointerUp)
    }
  }
}, [innerDocument, enabled])
```

**测试要断言「监听绑到了 iframe 的 document 上」，不要断言「点了会翻页」。**
后者在桌面 Chromium 里可能因为别的原因碰巧通过，前者直接钉住这个结构事实：

```ts
const inner = iframe.contentDocument!
inner.dispatchEvent(new PointerEvent('pointerdown', { clientX: 10, clientY: 100 }))
inner.dispatchEvent(new PointerEvent('pointerup', { clientX: 10, clientY: 100 }))
expect(onMove).toHaveBeenCalledWith('prev')
```

## 反例

不要以为「父文档上的监听能覆盖整个可视区」：

```ts
// 错：正文在 iframe 里，这段代码对正文上的点击完全无效
document.addEventListener('pointerdown', handlePointerDown)
```

也不要在初始化时抓一次 iframe 的 document 就长期持有：

```ts
// 错：epub.js 翻页会重建 iframe，这个 document 翻一页就作废了
const inner = rendition.getContents()[0].document
inner.addEventListener('pointerdown', handlePointerDown)
```

同类风险：任何把第三方内容渲染进 iframe 的场景（PDF 预览、富文本编辑器、
沙箱化的第三方页面），父文档的事件监听都到不了里面。
