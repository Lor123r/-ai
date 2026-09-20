# 0004 环境测不到的逻辑抽成纯函数

## 现象

`src/renderer/src/reader/textPagination.ts` 是 TXT 分页的算术部分，
被刻意从组件里抽出来做成纯函数。

原因：分页依赖 `scrollWidth` / `clientWidth` 测量，而**在 jsdom 里这两个值恒为 0**。
分页算术留在组件里，测试就只剩"文本渲染出来了"可断言——
真正会出错的除法、取整、边界夹取，一条都测不到。

## 根因

测试环境与真实环境的能力差异，会让一部分逻辑**在测试里根本无法触发**。

这类逻辑的典型特征是：依赖布局测量、依赖真实时钟、依赖文件系统、
依赖网络时序。它们在测试里要么返回 0，要么返回固定值，
于是"测试通过"变成了"这段代码在测试里没被真正执行过"。

## 结论

**凡是测试环境测不到的逻辑，抽成纯函数，把环境依赖变成参数。**

`textPagination.ts` 的做法：所有函数接收 `clientWidth` / `pageMargin` 作为参数，
内部只做算术。测试直接传具体数字，覆盖除零、越界、取整等所有分支。

判定方式：**如果一段逻辑的测试只能断言"它跑起来了"而不能断言"它算对了"，
就说明它需要抽离。** 抽离后测试应该能传入任意输入并断言精确输出。

顺带的好处：纯函数没有副作用，重构时不用担心调用顺序。

## 反例

不要把测量和算术混在组件里：

```ts
// 错：jsdom 里 clientWidth 恒为 0，算术分支测不到
function Reader() {
  const total = Math.round((el.scrollWidth + gap) / (el.clientWidth + gap * 2))
  ...
}

// 对：算术抽成纯函数，测量留在组件
// textPagination.ts
export function totalPagesFromScroll(contentWidth: number, step: number, gap: number): number
```

也不要为了"能测"去 mock `clientWidth`——mock 出来的值不反映真实布局，
测的是 mock 而不是逻辑。
