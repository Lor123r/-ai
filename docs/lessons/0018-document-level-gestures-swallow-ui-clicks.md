# 0018 绑在 document 上的手势监听会吞掉自己 UI 的点击

## 现象

翻页手势做完之后，Electron 的 6 条 E2E 挂了，报状态文字 `阅读中` 是 `hidden`。

排查发现：点底栏的「下一页」按钮，**页面确实翻了一页，但顶栏同时被收起来了**。
按钮看起来「失灵」—— 点一下界面就变一次样。

真机上表现更迷惑：点「目录」按钮，抽屉没开，顶栏先没了。

## 根因

手势监听绑在整个 `document` 上，**UI 自己的按钮点击也会流进来**。

点击「下一页」时事件序列是：

1. `pointerdown` 落在按钮上 → 记录起点
2. `pointerup` 落在按钮上 → 位移为 0、时长很短 → **判定为「点击」**
3. 按钮在屏幕中间 40% 区域 → 触发 `onToggleChrome()` → 顶栏收起
4. 按钮自己的 `click` 才执行 → 翻页

于是「点按钮」被同时解释成「点屏幕中间」，两个动作都发生了。

**这个 bug 在写代码时完全想不到**，因为直觉上「按钮的点击」和「屏幕的点击」
是两回事。只有把监听绑到 document 上，它们才变成同一件事。

## 结论

**document 级的手势监听必须显式排除交互元素。**

```ts
const INTERACTIVE_SELECTOR = [
  'button',
  'a',
  'input',
  'textarea',
  'select',
  'label',
  '[role="button"]',
  '[contenteditable="true"]',
  '.reader__drawer',
  '.reader__header',
  '.reader__controls',
  '.selection-toolbar'
].join(', ')

function isInteractive(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(INTERACTIVE_SELECTOR) !== null
}

function handlePointerDown(event: PointerEvent): void {
  if (isInteractive(event.target)) return
  // ...
}
```

用 `closest()` 而不是 `matches()`：点在按钮里的 `<span>` 上时，
`event.target` 是那个 span，只有向上找祖先才能命中按钮。

**测试要覆盖「点按钮不触发手势」这条**，否则下次重构很容易把守卫删掉：

```ts
const button = document.createElement('button')
document.body.append(button)
button.dispatchEvent(new PointerEvent('pointerdown', { clientX: 200, clientY: 300 }))
button.dispatchEvent(new PointerEvent('pointerup', { clientX: 200, clientY: 300 }))
expect(onToggleChrome).not.toHaveBeenCalled()
```

## 反例

不要只排除「按钮」这一个标签：

```ts
// 错：链接、输入框、抽屉里的点击仍然会被当成翻页手势
if (event.target instanceof HTMLButtonElement) return
```

也不要靠「按钮上 stopPropagation」来绕开：

```tsx
// 错：每个按钮都要记得加，漏一个就出 bug；而且第三方组件里的按钮加不了
<button onClick={next} onPointerDown={(e) => e.stopPropagation()}>下一页</button>
```

守卫要写在监听侧，一处生效，而不是散在每个被监听的元素上。

同类风险：任何绑在 `document` / `window` 上的全局手势（拖拽排序、长按菜单、
双击缩放、快捷键），都要先问一句「我自己 UI 上的点击会不会也流进来」。
