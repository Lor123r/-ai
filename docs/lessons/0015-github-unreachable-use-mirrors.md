# 0015 本机 GitHub 不通，下载要走镜像站

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

## 根因

**这台机器访问不了 GitHub，但其他站点正常。**

这个失败模式特别难查，因为：

1. `Invoke-WebRequest` 是**先缓冲再写文件**，所以下载卡住时磁盘上什么都看不到，
   看起来像「命令没执行」而不是「下载卡住了」
2. 官方 API 返回 307 是**正常行为**，`-Method Head` 探测会显示 200，
   让人以为源是通的——真正不通的是重定向之后的目标
3. 失败是**静默挂起**而不是报错，没有超时提示

之前 `npx playwright install chromium` 卡了 8 分钟无输出，是同一个原因：
Playwright 的浏览器包也托管在 GitHub 上。

## 结论

**在这台机器上下载东西，先确认最终地址不在 GitHub 上。**

判定方式：**`curl -I` 看有没有 307/302 重定向，然后单独探测重定向目标。**
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

不要用 `Invoke-WebRequest` 下载大文件——卡住时没有任何反馈：

```powershell
# 错：静默挂起，磁盘上什么都不出现，无法判断是卡住还是没跑
Invoke-WebRequest $url -OutFile $dest

# 对：curl 流式写盘，进度可见，能跟随重定向
curl.exe -L --fail --ssl-no-revoke --max-time 900 -o $dest $url
```

也不要在下载失败后盲目加大超时——地址不通的话等多久都没用，
只会把「立刻能看出的问题」拖成「十分钟后的超时」。
