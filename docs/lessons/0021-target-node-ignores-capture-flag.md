# 0021 事件在目标节点上不区分捕获与冒泡，只按注册顺序跑

## 现象

给阅读器加「系统返回键回书架」时，App 和阅读器各挂了一个 `popstate` 监听：

- App 的监听挂在**冒泡**阶段，收到就 `setActiveEntry(null)`（回书架）
- 阅读器的监听挂在**捕获**阶段，收到就先关抽屉，并 `stopImmediatePropagation()`

按捕获先于冒泡的常识，阅读器应该先跑、拦住 App。实测**反了**：

```
HOOKLOG = ["hook mounted","APP popstate state=null","hook cleanup"]
```

App 先跑，把阅读器卸载了；阅读器的监听连一次都没触发（`hook cleanup` 是卸载时
的清理日志）。抽屉没关，书也没了。

更迷惑的是：在阅读器挂载**之后**再注册一个捕获监听，它**能**收到事件
（`LATE COUNT = 1`）。也就是说阅读器的监听确实挂在 `window` 上、确实是捕获阶段、
`window === window.top` 为真，但就是不触发。

## 根因

`popstate` 派发的目标是 `window` 本身。**事件在目标节点（target phase）上，
捕获标志被忽略，监听器一律按注册顺序触发。**

App 先挂载、先注册，于是永远先跑。阅读器后注册，永远后跑 —— 捕获标志在这里
一点用都没有。`stopImmediatePropagation()` 也救不了：等它跑的时候 App 已经执行完了。

「捕获先于冒泡」只在**祖先链**上成立（window → document → ... → target）。
当监听器和派发目标是同一个节点时，这条规则不适用。

**为什么当时没发现**：直觉上「捕获阶段」听起来就是「更早」，而 `addEventListener`
的第三个参数又确实写着 `true`，看起来已经做对了。真正的原因（目标节点不区分）
不在直觉覆盖范围内，只有实测日志能看出来。

## 结论

**同一个事件不要靠多个监听器的注册顺序来定优先级。** 改成单一入口 + 显式分发：

```ts
// 阅读器：登记「这次返回我要不要」
useBackNavigation({ onBack: () => (panel === 'none' ? false : (setPanel('none'), true)) })

// App：唯一的 popstate 监听，收到后先问阅读器
window.addEventListener('popstate', (event) => {
  if (isReaderState(event.state)) return
  if (handleBackPress()) {
    window.history.pushState(READER_STATE, '')  // 补回这一层
    return
  }
  setActiveEntry(null)
})
```

可判定的检查：**全仓库 `addEventListener('popstate'` 只应出现一次。**
出现第二次就说明又回到了「靠注册顺序定优先级」的老路。

适用范围：所有「多个监听器抢同一个事件」的场景，尤其是监听器和派发目标是
同一个节点（`window` / `document` / 单个元素自身）的时候。

## 反例

- **不要**用捕获/冒泡的先后去表达优先级。在目标节点上它不生效，在祖先链上
  它生效 —— 于是同一份代码换个挂载点行为就变，而且只在特定挂载点才出错。
- **不要**用 `stopImmediatePropagation()` 去「拦住」一个已经先跑完的监听器。
  它只能拦住**还没跑**的，拦不住已经跑过的。
- **不要**因为「加了 `true` 参数」就认为顺序问题已经解决。参数写对了，
  语义仍然可能不是你以为的那个。
- **不要**在没看到事件日志之前就断定「监听器没挂上」。本例中监听器挂得好好的，
  是**顺序**问题；如果当时去查「为什么没挂上」，会白查很久。
