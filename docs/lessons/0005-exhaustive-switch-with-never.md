# 0005 用 `never` 收口穷举，漏一种就编译失败

## 现象

`src/renderer/src/reader/highlightPalette.ts` 里，配色到色值的映射用了 `switch`，
`default` 分支把值赋给 `never` 类型：

```ts
default: {
  const unhandled: never = color
  return String(unhandled)
}
```

`HIGHLIGHT_COLOR_LABELS` 则用 `Record<HighlightColor, string>`。

## 根因

枚举加值是很常见的改动，而**忘记同步所有映射点**同样常见。

普通写法下，漏掉一种配色不会报错——新配色会静默地画成默认颜色（比如黄色），
用户看到的是"我选了蓝色，显示成黄色"，而开发者完全不知道。

## 结论

**凡是"枚举的每一种都必须处理"的映射，用类型系统收口，让遗漏变成编译错误。**

两种收口方式：
- `switch` 的 `default` 分支赋给 `never`——新增枚举值时该行编译失败
- `Record<EnumType, T>`——漏一种键就编译失败

判定方式：**新增一个枚举值，如果代码能编译通过，说明收口没做到位。**

这条的价值在于：它把"记得同步"从人的责任心转移到了编译器。
AI 改代码时最容易漏的就是这种"另一处也要改"，而编译错误是它一定会看到的。

## 反例

不要用 `default` 返回兜底值：

```ts
// 错：新配色静默变成黄色
switch (color) {
  case 'yellow': return '#f2c744'
  case 'green': return '#4aa96c'
  default: return '#f2c744'
}

// 对：漏一种就编译失败
switch (color) {
  case 'yellow': return '#f2c744'
  case 'green': return '#4aa96c'
  default: {
    const unhandled: never = color
    return String(unhandled)
  }
}
```

也不要用 `Partial<Record<...>>` 或 `Record<string, T>`——那等于放弃了收口。
