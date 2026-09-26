# 0015 外网可达性取决于加速器，是变量不是常量

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

## 根因

**这台机器的外网可达性取决于加速器是否开启，是个变量，不是常量。**

| | 加速器关闭 | 加速器开启 |
| --- | --- | --- |
| release 附件下载（几十 MB） | 静默挂起 | 通 |
| `git push` | 未复测 | 通 |
| `gh` 调 API | 未复测 | 通 |

所以"GitHub 不通"和"大文件链路有问题"**两个说法都是错的**——
它们都是拿一个时间点的观测去推一个稳定的结论。

这个失败模式特别难查，因为：

1. `Invoke-WebRequest` 是**先缓冲再写文件**，所以下载卡住时磁盘上什么都看不到，
   看起来像「命令没执行」而不是「下载卡住了」
2. 官方 API 返回 307 是**正常行为**，`-Method Head` 探测会显示 200，
   让人以为源是通的——真正不通的是重定向之后的目标
3. 失败是**静默挂起**而不是报错，没有超时提示

**误判的代价**：把"当前网络状态"读成"这台机器的固有属性"之后，
会顺手放弃 `git push`、`gh`、`gh pr create` 这些其实完全可用的能力，绕远路。

## 结论

**先探测当前网络状态，再决定要不要绕。不要假设状态是稳定的。**

| 用途 | 加速器关闭时 | 加速器开启时 |
| --- | --- | --- |
| `git push` / `git fetch` | 未复测，先试一次 | 直接推 |
| `gh` 调 API | 未复测，先试一次 | 直接调 |
| release 附件、二进制包（几十 MB 以上） | 走镜像 | 可直连 |

判定大文件下载的关键：**`curl -I` 看有没有 307/302 重定向，然后单独探测重定向目标。**
只看第一跳的状态码会得出错误结论。

**探测成本远低于绕路成本**：`git push` 试一次只要几秒，失败就换镜像；
而"以为不通所以不试"会让人绕远路甚至放弃功能。

可用的镜像（加速器关闭时实测 200）：
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
#     —— 加速器开启时 git push 和 gh 一直是通的
```

也不要反过来，以为「`gh` 能用」就说明「release 附件也能下」——
两者走的链路不同，要分别探测。

**更不要把一个时间点的观测写成永久结论。** 这条经验自己就翻车过两次：
第一次把"下载失败"写成"GitHub 不通"，第二次把"加速器开着"误读成
"git 链路和大文件链路不同"。两次都是同一个错误。

不要用 `Invoke-WebRequest` 下载大文件——卡住时没有任何反馈：

```powershell
# 错：静默挂起，磁盘上什么都不出现，无法判断是卡住还是没跑
Invoke-WebRequest $url -OutFile $dest

# 对：curl 流式写盘，进度可见，能跟随重定向
curl.exe -L --fail --ssl-no-revoke --max-time 900 -o $dest $url
```

也不要在下载失败后盲目加大超时——地址不通的话等多久都没用，
只会把「立刻能看出的问题」拖成「十分钟后的超时」。
