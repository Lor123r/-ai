# 0013 探测本地服务用 localhost，不要用 127.0.0.1

## 现象

给浏览器宿主配 Playwright 时，`playwright.web.config.ts` 里写的是：

```ts
use: { baseURL: 'http://127.0.0.1:4173' },
webServer: {
  command: 'npm run preview:web -- --port 4173 --strictPort',
  url: 'http://127.0.0.1:4173'
}
```

`npm run build:web` 成功，但测试直接失败：

```
Error: Timed out waiting 120000ms from config.webServer.
```

手动起同一个命令，vite 打印 `Local: http://localhost:4173/`，看起来一切正常。
但 `Invoke-WebRequest http://127.0.0.1:4173` 报「无法连接到远程服务器」，
而 `http://localhost:4173` 返回 200。

`netstat -ano | Select-String ":4173"` 给出了答案：

```
TCP    [::1]:4173    [::]:0    LISTENING    18708
```

只监听了 IPv6 的 `[::1]`，IPv4 的 `127.0.0.1` 上根本没有监听。

## 根因

**`localhost` 和 `127.0.0.1` 不是同一个地址。**

`localhost` 是一个名字，解析成 `::1` 还是 `127.0.0.1` 取决于系统的解析顺序
（Windows 默认优先 IPv6）。vite preview 默认只绑 `localhost`，
在双栈机器上就落到了 `[::1]`。

于是「用 `127.0.0.1` 探测」和「服务实际绑在 `[::1]`」错开了。
报错信息是 `webServer` 超时，指向的是「服务没起来」，
而真实原因是「服务起来了，但探测的地址不对」——**报错指向的方向是错的**，
所以第一反应会去查构建、查端口占用，全都查不出问题。

## 结论

**探测本地服务一律用 `localhost`，不要用 IP 字面量。**

判定方式：**看到 `webServer` / 健康检查超时，先 `netstat` 看实际监听的是 `[::1]` 还是 `0.0.0.0`。**
如果监听地址和探测地址的协议族不一致，就是这个问题，跟服务本身无关。

需要固定 IPv4 时，正确做法是让服务端显式绑：`--host 127.0.0.1`，
而不是在客户端猜。两边必须对齐，不能一边写 `localhost` 一边写 `127.0.0.1`。

## 反例

不要因为「`127.0.0.1` 比 `localhost` 更明确、更快」就选它：

```ts
// 错：服务绑在 [::1]，探测 127.0.0.1 永远连不上
webServer: { url: 'http://127.0.0.1:4173' }

// 对：两边都用 localhost，让解析结果保持一致
webServer: { url: 'http://localhost:4173' }
```

也不要在超时后盲目加大 `timeout`——地址不对的话，等多久都连不上，
只会把「立刻能看出的配置错误」拖成「两分钟后的超时」。
