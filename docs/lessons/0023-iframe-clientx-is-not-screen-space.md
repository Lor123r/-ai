# 0023 iframe 里的 clientX 不在屏幕坐标系里

## 现象

EPUB 正文里点屏幕左侧，翻的是**下一页**；点右侧也是下一页。中间区唤出工具栏
正常。于是「不能向前翻页」，只能靠底栏的按钮往回翻。

桌面端（Electron）一切正常，只有真机复现。

## 根因

epub.js 的 `flow: 'paginated'` 把**整章**排成一条很宽的横条，靠横向滚动一次
露一栏，由外层 `.reader__viewport` 的 `overflow: hidden` 裁掉其余部分。

真机实测的布局：

```
innerW=360
container l=0 w=360
iframe    l=-560 w=7400
```

于是同一个 `clientX` 有**两套坐标系**：

| 事件来源 | `clientX` 相对谁 |
| --- | --- |
| 外层文档（正文两侧的留白） | 屏幕，0–360 |
| iframe 内部（正文文字） | iframe 自己那条 7400px 视口，还带滚动偏移 |

点击分区的算法是 `ratio = (clientX - rect.left) / rect.width`，`rect` 取的是
360px 宽的正文列。拿 iframe 的 `clientX`（≈740）当分子：

```
ratio ≈ 740 / 360 ≈ 2.05  ≥  1 - 0.4
```

**恒成立**，所以点正文任何位置都判成「下一页」。点留白时用的是外层坐标，
算得对，于是「点留白能唤出工具栏、点文字只会往后翻」——两个症状同一个根因。

滑动也中招：`dx` 是按下与抬起的 `clientX` 相减，两端坐标系不同时差值毫无意义。

## 结论

**跨 iframe 的手势判定，先把两边的坐标换算到同一个坐标系再算。**

判据：`event.view === innerDocument.defaultView` 说明事件来自 iframe 内部，
此时给 `clientX` 加上 iframe 元素的 `getBoundingClientRect().left`。

```ts
function iframeOffsetFor(event: PointerEvent): number {
  if (!innerDocument || innerDocument === document) return 0
  if (event.view !== innerDocument.defaultView) return 0
  const frame = viewport?.querySelector('iframe') ?? container.querySelector('iframe')
  return frame ? frame.getBoundingClientRect().left : 0
}
```

点击分区与滑动 `dx` **都要**过这一层，只修一处会留下另一半。

## 反例

**「桌面端正常」不能推出「真机正常」。** 桌面窗口宽 1087px，正文列 900px，
iframe 的 `left` 偏移很小，`ratio` 落在合理区间，bug 被掩盖。真机 360px 宽、
iframe 偏移 -560px，才把它放大到必然触发。

**第一次的修法是错的。** 当时只把分母从「整窗宽」换成「正文列宽」
（见 [0022](./0022-hit-zone-must-use-the-visible-box.md)），分子没动 ——
分母换对了，分子还在另一个坐标系里，`ratio` 照样恒大于 1。改完在桌面测「好了」，
真机上依旧不能向前翻页。

**别靠推理定位，去量。** 这个 bug 的关键数字（`iframe l=-560 w=7400`）在源码里
看不出来，是 epub.js 运行时算出来的。在真机上把 `clientX`、`rect`、
`iframe.getBoundingClientRect()` 打到屏幕上，一眼就定了案。
