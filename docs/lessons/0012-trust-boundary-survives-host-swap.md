# 0012 换宿主不等于渲染层的数据变可信

## 现象

给电子书阅读器加浏览器宿主（`src/web/`）时，`createWebBridge` 最初是这样写的：

```ts
annotations: {
  listByBook: (bookId) => annotations.listByBook(bookId),
  save: (annotation) => annotations.save(annotation),
  remove: (bookId, annotationId) => annotations.remove(bookId, annotationId)
}
```

看起来完全合理——`AppBridge` 的签名就是这样，直接转发给仓储即可。

`e2e-web/browser.spec.ts` 里那条「非法 id 被挡下」的测试立刻红了：
`window.api.annotations.save({ id: 'a 1', ... })` 没有抛异常，非法数据落了盘。

对照主进程 `src/main/ipc/annotationsIpc.ts` 才发现，那边每个入口都做了校验：

```ts
ipcMain.handle(ANNOTATION_CHANNELS.save, (_event, raw: unknown) => {
  const annotation = reviveAnnotation(raw)
  if (!annotation) throw new Error('注解数据不合法')
  return annotations.save(annotation)
})
```

## 根因

**把「IPC 边界」和「信任边界」当成了同一件事。**

主进程的校验写在 `ipcMain.handle` 的回调里，位置紧挨着 IPC 注册代码，
很容易读成「这是 IPC 的序列化/反序列化处理」。实际上它防的是
**渲染层递来的数据不可信**——而这件事的成因是「渲染层可能被 XSS 或
被篡改的脚本控制」，跟数据走不走 IPC 没有关系。

浏览器宿主里没有 IPC，于是这层校验在「照搬接口签名」时被顺手丢掉了。
但页面里任何脚本都能调 `window.api`，信任边界一点没变。

## 结论

**校验要挂在「数据从不可信来源进入」的那一层，而不是挂在传输机制上。**

判定方式：**问自己「这个校验防的是传输格式，还是数据来源」。**
如果答案是「来源」，那么换掉传输机制（IPC → 直接函数调用）时它必须跟着走。

本仓库的落点：`reviveAnnotation` + `requireBookId` 这类校验属于**领域规则**，
两个宿主都要用。它们本来就住在 `src/core/domain/annotation.ts`，
所以正确做法是在 `createWebBridge` 里显式再调一次，而不是指望 IPC 层代劳。

配套的可判定检查：**每个宿主的 `AppBridge` 实现都要有同一条「非法输入被拒」的测试。**
`e2e/app.spec.ts` 和 `e2e-web/browser.spec.ts` 各有一条，缺一条就说明某个宿主漏了校验。

## 反例

不要因为「这是内部调用，不是网络请求」就省掉校验：

```ts
// 错：浏览器宿主里没有 IPC，就以为不需要校验
save: (annotation) => annotations.save(annotation)

// 对：领域校验跟着数据来源走，不跟着传输机制走
save: (raw) => {
  const annotation = reviveAnnotation(raw)
  if (!annotation) throw new Error('注解数据不合法')
  return annotations.save(annotation)
}
```

也不要反过来把校验只写在渲染层——渲染层正是那个不可信的来源。
