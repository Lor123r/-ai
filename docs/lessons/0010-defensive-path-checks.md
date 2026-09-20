# 0010 路径校验要双重：边界 + 归属

## 现象

`src/main/import/fileBookStore.ts` 有两道校验：

1. `requireInside(root, target)` —— 路径必须在书库根目录内
2. `requireOwned()` —— 文件名的 basename 必须以 `<safeFileStem(bookId)>.` 开头

第二道看起来多余：既然已经在根目录内了，还能有什么问题？

## 根因

`library.json` 是**可被篡改的输入**。

如果只校验边界，一份被改过的 `library.json` 可以让书 A 的 `filePath` 指向书 B 的文件。
路径完全合法（就在根目录内），边界校验通过，但**归属是错的**——
用户打开书 A，看到的是书 B 的内容；删除书 A，删掉的是书 B 的文件。

边界校验回答的是"这个路径能不能碰"，归属校验回答的是"这个路径该不该碰"。
两个问题不同，需要两道校验。

## 结论

**凡是路径来自可篡改的持久化数据，都要同时校验边界与归属。**

判定方式：**问自己"如果这个路径被改成另一个合法路径，会怎样"。**
如果答案是"会读到/删掉别人的数据"，就缺一道归属校验。

配套的防御手法（本仓库实际采用的）：
- `rm` **故意不传 `recursive`、故意不先 `stat` 判类型**——被篡改的路径指向目录时
  会以 `ERR_FS_EISDIR` 失败，而不是删掉一棵子树。**把失败设计成安全默认值。**
- 写文件一律 `${target}.tmp` + `rename`，保证原子性
- 损坏的存档**改名备份而非删除**

## 反例

不要只做边界校验就认为安全了：

```ts
// 错：篡改 library.json 就能读到别人的文件
const target = join(root, book.filePath)
requireInside(root, target)
return readFile(target)

// 对：再加一道归属校验
const target = join(root, book.filePath)
requireInside(root, target)
if (!basename(target).startsWith(`${safeFileStem(bookId)}.`)) throw new Error('归属不符')
return readFile(target)
```

也不要用"路径里不含 `..`"这种字符串检查代替规范化后的边界校验——
符号链接、大小写、UNC 路径都能绕过它。
