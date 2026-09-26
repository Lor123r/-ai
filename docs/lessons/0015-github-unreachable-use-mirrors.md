# 0015 大文件下载会静默挂起，先探测最终地址再决定走不走镜像

## 现象

装 JDK 时用 Adoptium 的官方 API：

```
https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jdk/hotspot/normal/eclipse
```

`Invoke-WebRequest` 挂起 10 分钟以上，目标文件**根本没被创建**。
`curl -I` 才看出真相——它返回 307，重定向到：

```
https://github.com/adoptium/temurin21-binaries/releases/download/...
```

直接 `curl -I` 那个 GitHub 地址，**返回空**（不是 4xx/5xx，是完全没有响应）。

同一时间 `registry.npmmirror.com` 返回 200，`dl.google.com` 返回 200。

之前 `npx playwright install chromium` 卡了 8 分钟无输出，是同一个原因：
Playwright 的浏览器包也托管在 GitHub 上。

**但 GitHub 并不是整体不通。** 后来 `git push` 到
`https://github.com/Lor123r/-ai.git` 一次就成功，`gh` 也能正常调 API。
所以「GitHub 不通」这个说法是错的，见下面「根因」。

## 根因

**失败的是「大文件下载」这条路径，不是 GitHub 这个域名。**

`git push` 走的是 git 自己的 HTTP 传输，数据量小、有分块与重试；
`gh` 走的是 API，响应是几十 KB 的 JSON。两者都正常。

而 release 附件动辄几十上百 MB，走的是另一条链路，会**静默挂起**——
没有 4xx/5xx，没有超时提示，就是一直不返回。

这个失败模式特别难查，因为：

1. `Invoke-WebRequest` 是**先缓冲再写文件**，所以下载卡住时磁盘上什么都看不到，
   看起来像「命令没执行」而不是「下载卡住了」
2. 官方 API 返回 307 是**正常行为**，`-Method Head` 探测会显示 200，
   让人以为源是通的——真正不通的是重定向之后的目标
3. 失败是**静默挂起**而不是报错，没有超时提示

**把「大文件下载慢/挂起」误判成「GitHub 不通」的代价**：会顺手放弃
`git push`、`gh`、`gh pr create` 这些其实完全可用的能力，绕远路。

## 结论

**先按用途分类，再决定要不要绕。**

| 用途 | 走不走镜像 | 判定方式 |
| --- | --- | --- |
| `git push` / `git fetch` | 不用 | 直接推，成功就是成功 |
| `gh` 调 API | 不用 | 直接调 |
| release 附件、二进制包（几十 MB 以上） | 要 | `curl -I` 看有没有 307/302，再单独探测重定向目标 |

判定大文件下载的关键：**`curl -I` 看有没有 307/302 重定向，然后单独探测重定向目标。**
只看第一跳的状态码会得出错误结论。

可用的镜像（实测 200）：
- `mirrors.tuna.tsinghua.edu.cn` —— 有 Adoptium 全量镜像，路径结构与官方一致
- `registry.npmmirror.com` —— npm 包
- `dl.google.com` —— 安卓 SDK，直连可用

配套的两个操作细节：
- 用 `curl.exe -L --ssl-no-revoke` 而不是 `Invoke-WebRequest`。
  `-L` 跟随重定向，`--ssl-no-revoke` 绕过本机 CRL 服务器不可达导致的
  `CRYPT_E_REVOCATION_OFFLINE`；`curl` 还会流式写盘，能实时看到进度。
- 装 Electron 二进制时用 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`。

## 反例

不要把「某个下载挂了」推广成「GitHub 不通」，从而放弃可用的能力：

```powershell
# 错：因为一次 release 附件下载失败，就认为推送也要绕路
#     —— git push 和 gh 其实一直是通的
```

也不要反过来，以为「`gh` 能用」就说明「release 附件也能下」——
两者走的链路不同，要分别探测。

不要用 `Invoke-WebRequest` 下载大文件——卡住时没有任何反馈：

```powershell
# 错：静默挂起，磁盘上什么都不出现，无法判断是卡住还是没跑
Invoke-WebRequest $url -OutFile $dest

# 对：curl 流式写盘，进度可见，能跟随重定向
curl.exe -L --fail --ssl-no-revoke --max-time 900 -o $dest $url
```

也不要在下载失败后盲目加大超时——地址不通的话等多久都没用，
只会把「立刻能看出的问题」拖成「十分钟后的超时」。
