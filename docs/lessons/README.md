# 经验库

这里存放**踩过的坑**与**验证过的做法**，供人和 AI 共同学习。

与 [AGENTS.md](../../AGENTS.md) 的分工：

| | AGENTS.md | docs/lessons/ |
| --- | --- | --- |
| 内容 | 必须遵守的**规则** | 为什么这么定的**经验** |
| 形态 | 短，每次对话都注入 | 一条一文件，按需读取 |
| 变更 | 少 | 持续追加 |

规则会被执行，经验会被参考。**不要把长篇论证塞进 AGENTS.md**，那会挤占 AI 的上下文；
也不要指望经验库能约束行为，它只是参考。

## 为什么一条一文件

单文件经验库会随条目增长变成巨型文档，AI 无法一次装载，只能靠 grep 找标题——
本仓库的 `README.md` 已经长到 139.8 KB，就是这个问题的实例。
一条一文件让 AI 能按需只读相关的那几条。

## 写作规范

文件名：`NNNN-kebab-case.md`，四位序号，从 `0001` 起，**只增不改号**。

每条必须包含这四节，缺一不可（由 [lessons.test.ts](../../tests/unit/repo/lessons.test.ts) 守卫）：

```markdown
# NNNN 一句话结论

## 现象
具体发生了什么。带文件名、带报错原文、带数字。

## 根因
为什么会这样。要能解释"为什么当时没发现"。

## 结论
可判定的做法。**必须能被检查**——要么编译期能红，要么测试能红，
要么能写成一条 grep 规则。写不出可判定结论的，说明还没想清楚。

## 反例
明确不该做什么。AI 最容易犯的错不是"不知道该做什么"，
而是"不知道不该做什么"。
```

### 通用原则 + 本项目实例

每条经验都按这个结构写：**结论是通用的，现象与根因是本项目的**。
这样既能复制到其他仓库，又保留了"当初为什么这么定"的上下文。

## 索引

| 编号 | 结论 | 主题 |
| --- | --- | --- |
| [0001](./0001-required-param-over-default.md) | 需要区分环境的参数设为必填，让遗漏变成编译错误 | 类型 |
| [0002](./0002-fail-loudly-over-fake-success.md) | 宁可明确失败，也不要让界面显示"已保存"而磁盘为空 | 错误处理 |
| [0003](./0003-load-bearing-order.md) | 顺序有依赖的步骤要在代码里标注"承重" | 可维护性 |
| [0004](./0004-pure-function-for-untestable-env.md) | 环境测不到的逻辑抽成纯函数 | 测试 |
| [0005](./0005-exhaustive-switch-with-never.md) | 用 `never` 收口穷举，漏一种就编译失败 | 类型 |
| [0006](./0006-comment-why-not-what.md) | 注释写"为什么"和"换序会坏"，不写"是什么" | 可维护性 |
| [0007](./0007-document-own-limitations.md) | 文档自陈局限，防止 AI 把已知取舍当 bug 修 | 文档 |
| [0008](./0008-single-gate-command.md) | 单一门禁命令，降低执行偏差 | 流程 |
| [0009](./0009-split-large-docs.md) | 文档过大要拆分，文档结构本身就是接口 | 文档 |
| [0010](./0010-defensive-path-checks.md) | 路径校验要双重：边界 + 归属 | 安全 |
| [0011](./0011-decidable-trigger-for-proactive-work.md) | 想让 AI 主动做的事，必须给出可对照的触发条件 | 流程 |
| [0012](./0012-trust-boundary-survives-host-swap.md) | 换宿主不等于渲染层的数据变可信，校验跟着数据来源走 | 安全 |
| [0013](./0013-localhost-not-ip-literal.md) | 探测本地服务用 localhost，不要用 127.0.0.1 | 环境 |
| [0014](./0014-android-toolchain-without-studio.md) | 装安卓工具链用 cmdline-tools，不需要 Android Studio | 环境 |
| [0015](./0015-github-unreachable-use-mirrors.md) | 本机 GitHub 不通，下载要走镜像站 | 环境 |
| [0016](./0016-percentage-height-in-android-webview.md) | 高度要由 flex 给，`height: 100%` 在安卓 WebView 里解析成 auto | 环境 |
| [0017](./0017-iframe-content-needs-its-own-listeners.md) | 正文在 iframe 里，父文档的监听收不到它的事件 | 前端 |
| [0018](./0018-document-level-gestures-swallow-ui-clicks.md) | 绑在 document 上的手势监听会吞掉自己 UI 的点击 | 前端 |

## 相关文档

- [AGENTS.md 写作指南](../agents-md-guide.md) —— 怎么给新项目写 `AGENTS.md`、按规模分档、常见错误
- [新项目开工清单](../templates/README.md) —— 开新项目时复制哪些文件、按什么顺序做

