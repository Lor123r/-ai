# AGENTS.md

## 注意事项

1. 每次改动完成后都必须创建一个对应的 Git commit，以便后续追踪和回滚。
2. 每次改动后都必须编写和更新相关测试，并在交付前确保所有的测试和验证全部通过。

## 验证门禁

交付前必须跑通：

```
npm run verify
```

它等于 `npm run typecheck && npm run test && npm run test:e2e`。
**不接受"单测过了就行"** —— typecheck 与 E2E 同样是门禁的一部分，任何一项红都算没做完。

环境前提：Node.js 装在 `D:\tools\node`，不在默认 PATH，命令前要 `$env:Path = "D:\tools\node;" + $env:Path`。
本机是 Windows PowerShell 5.1，不支持 `&&`、`||`、`??`、`?.`，用 `;` 串联。

## 架构红线

- 依赖方向只能向内：`renderer / main → core → 无`。
  `src/core` 不得依赖 Electron、React、DOM 或 Node 内置模块；需要外部能力时通过 `src/core/ports/` 注入。
- 渲染进程只能拿到 `bookId`，不能拿到文件路径；文件选择框一律由主进程弹出。
- `FileBookStore` 的所有路径操作必须经过 `requireInside(root, target)` 校验。
- 新增 IPC 频道必须同时改 `src/shared/ipc.ts`、`src/main/ipc/*Ipc.ts`、`src/preload/index.ts` 三处。
- 存储写文件必须原子（`${target}.tmp` + `rename`）；书库损坏要备份改名而不是删除，设置损坏直接回落默认值。

更多细节见 [README.md](./README.md)。

## 经验库

[docs/lessons/](./docs/lessons/README.md) 存放踩过的坑与验证过的做法，供人和 AI 共同学习。

与本文的分工：**本文是必须遵守的规则，经验库是为什么这么定的经验。**
规则会被执行，经验会被参考。改动前先扫一眼索引，看看有没有相关的既有结论。

每条经验按「现象 / 根因 / 结论 / 反例」四节写，格式由
[tests/unit/repo/lessons.test.ts](./tests/unit/repo/lessons.test.ts) 守卫。
踩到新坑时追加一条，编号只增不改。

### 什么时候必须追加一条

先过**收益闸门**，两个问题都要答：

1. **不写下来，下一个人会不会重新踩？**
2. **踩了之后，要花多久才能查出来？**

判定：

| 会不会重踩 | 查出来要多久 | 结论 |
| --- | --- | --- |
| 会 | 久（要翻源码 / 反复试） | **写** |
| 会 | 一眼就看出来 | 可选，倾向不写 |
| 不会 | —— | **不要写** |

「不会重踩」的典型：个人风格偏好、编译器/类型系统已经拦住的、
门禁一跑就报出来的。这些写下来省不下任何验证成本，只占地方。

**经验的价值是省下的验证成本，不是「它是对的」。**
一条正确但用不上的经验是负资产——它挤掉了真正有用的条目。

满足下面任意一条时，通常说明收益闸门会通过，可以写：

1. 你修掉了一个 bug，而**第一次尝试的修法是错的**（改完没通过，换了另一种才通过）。
2. 你发现某处代码/文档的写法**与直觉相反**，且不写下来下一个人还会踩。
3. 你因为**缺少某条信息**而做错了事（比如不知道某个约定、误读了某个字段）。
4. 门禁红了，而红的原因**不是本次改动引入的**（环境、依赖、平台差异）。

这四条是**线索，不是许可**。命中任意一条仍要过收益闸门；
反过来，没命中但确实会让人重踩且难查的，也该写。

写之前先扫一遍索引：已有条目能覆盖的，**改那一条**（在「现象」里补新证据），
不要新开一条。只有结论本身变了才新开号，并在新条目里指回旧号。
几条弱条目讲的是同一件事时，**合并成一条**，旧号在索引的「已合并的条目」里登记去向。

本文自身的写法（怎么给新项目写 `AGENTS.md`、按规模分档、常见错误）见
[docs/agents-md-guide.md](./docs/agents-md-guide.md)。

开新项目时，[docs/templates/](./docs/templates/README.md) 里有可直接复制的
`AGENTS.md` 骨架、经验库规范与格式守卫测试。

## 子 Agent 定义

`.claude/agents/` 下是本项目的子 Agent 定义，用来把上面的规范落到具体动作上：

| 定义 | 用途 |
| --- | --- |
| [verify-runner.md](./.claude/agents/verify-runner.md) | 拟出验证命令与判定标准，交人类执行（只读，不跑命令） |
| [layering-guard.md](./.claude/agents/layering-guard.md) | 审查改动是否破坏分层与安全边界（只读） |
| [test-author.md](./.claude/agents/test-author.md) | 按本仓库约定补测试、修测试确定性（只写文件，不跑命令） |
| [commit-crafter.md](./.claude/agents/commit-crafter.md) | 起草提交信息与提交命令，交人类执行（只读，不提交） |
| [lessons-curator.md](./.claude/agents/lessons-curator.md) | 判断本次改动是否值得沉淀成经验，值得就起草条目（只读，不落盘） |

这些定义的格式由 [tests/unit/repo/agentDefinitions.test.ts](./tests/unit/repo/agentDefinitions.test.ts) 守卫：
文件名必须是 kebab-case、`name` 必须与文件名一致、必须有 `description`，并且每个定义都要在本文件里被引用。

**这些子 Agent 都没有命令执行权限。** 它们只产出文件与「给人类执行的命令清单」，
跑命令、验证绿灯、真正提交这三件事一律由人类（或主 Agent 代跑）完成。
凡是把 `Bash` 之类执行能力写进 `tools:` 的定义都会被判红。
