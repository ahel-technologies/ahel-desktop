---
description: "每个基于 base 的 dsh --profile 表层共享的聊天核心：模型路由、持久会话、设置、凭证、审批与 MCP 资源，供用户组合或定制 profile。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-base

[English](README.md) | 中文

## 概述

每个基于 base 的 `dsh --profile` 表层都运行在 `dsh-base` 上，因此这些表层共享模型路由、持久会话历史、设置、已存储的凭证、审批提示与 MCP 资源。核心本身不添加任何本地 agent（智能体）工具：shell、文件、skill、subagent 与 web 工具来自 [`dsh-agent-tools`](../agent-tools/README.zh.md)，由 `headless`、`sdk` 与 `acp` profile 叠加。桌面应用运行的 `web` profile 只叠加浏览器层。你通常不直接操作本组合包；需要其他默认值时，请修改 profile patch 或添加后续组合包。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

你会自动获得聊天核心：随发行版交付的 `web`、`headless`、`sdk` 与 `acp` profile 都把它列在首位，自定义的基于 base 的 profile 也把它列为第一个组合包。随发行版交付的 `sdk-minimal` profile 则改用完整的独立配置树。

### 最小自定义 profile

核心本身不带入口。请把它与一个模式组合包搭配；当 agent 需要本地工具时，在两者之间列出 `@deepseek-ai/dsh-agent-tools`。下面的 profile `package.json` 与随发行版交付的 `headless` profile 一致：

```json
{
  "name": "my-profile",
  "private": true,
  "dsh": {
    "profile": {
      "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-agent-tools", "@deepseek-ai/dsh-headless"]
    }
  }
}
```

运行 `dsh --profile my-profile "your task"` 执行一次性任务。随发行版交付的 `web`、`headless`、`sdk` 与 `acp` profile 会在首次使用时为你创建。要添加更多组合包，运行 `dsh plugin --profile <name> add <package>`；内置组合包从 dsh 安装目录解析。profile 约定见 [app-boot 的 profile 章节](../../boot/app-boot/README.zh.md)。

### 你得到什么

基于本核心构建的每个 profile 都提供以下行为：

- **模型路由**：通过多提供方的 [pi-ai 适配器](../../llm/llm-pi-ai/README.zh.md)。在你于 **Settings → Models** 或 `llm-pi-ai:` 设置节中添加提供方之前，它不注册任何模型路由。核心不固定提供方：已保存的模型选择优先，否则由第一个已配置路由处理请求。
- **凭证**：按请求解析。继承的环境变量优先于受管的 `$DSH_HOME/.credentials.yaml`，项目与用户的 `.env` 文件作为后备。Models 页面只写入受管文件。
- **持久会话**：保存在 `$DSH_HOME/sessions` 下，带生成的标题、图片附件与会话投影。全文会话搜索处于关闭状态；精确读取、标题与谱系读取仍然可用。
- **设置与实时配置编辑**：当进程由 profile 支撑时，还提供插件管理器。
- **默认权限策略**：`workspace-write` 加审批提示，可由 `DSH_PERMISSION_MODE` 覆盖。沙箱化文件系统提供方是唯一的文件写入路径。
- **会话服务**：斜杠命令、`/feedback`、token 计量、工具调用超时、输出溢出（spill）、图片预算重试与重复工具提醒。

本 bundle 统一挂载 [MCP 资源](../../mcp/mcp-resources/README.zh.md)一次。只需为所需服务器配置 [MCP 客户端条目](../../mcp/mcp-client/README.zh.md)。其他提供方挂载的客户端在所属作用域中也属于已配置状态。调用方作用域中没有已配置服务器时，不会获得 MCP 工具或提示词文本。

### 更改默认值

要改变基于本核心构建的 profile 提供的内容——更严格的权限模式、内容搜索、更多工具——请编辑 profile 的 `cordis.patch.yml` 或添加后面的组合包。每个 patch 条目会替换目标的整个配置，因此请重述每个想保留的设置。保持沙箱化文件系统提供方作为唯一的文件写入路径：在其之上再添加普通文件系统提供方会导致 profile 加载失败。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本组合包是一份静态 patch 文档：一个应用到空 profile 根之上的 `insert` 列表。它不挂载任何服务、不发出任何事件、也不持有任何可变状态；每条插入行所属的包负责该行的行为与不变式。

### 组合机制

patch 会替换目标行的整个 `config`，而不是合并进它。后续组合包层与用户的 profile `cordis.patch.yml` 按 id 覆盖行，每行最后一次写入生效。按模式取值不同的行不属于这里：每个模式组合包重述自己的完整配置，让任何单一行最多只属于一个组合包层加用户层。完整行集合及其设计依据以行内注释写在 [`cordis.patch.yml`](cordis.patch.yml) 里；[生成的组合图](../../../apps/cli/composition.md)负责渲染它。

### 聊天核心与工具平面

本地工具平面与遥测行位于 [`dsh-agent-tools`](../agent-tools/README.zh.md)，这是 profile 列在本层之后的独立层。`web` profile 不列出它，因此桌面运行时不会加载其中任何包。它的工具行使用本核心提供的服务，例如沙箱策略与审批。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | 组合包的实体：聊天核心插件行，附以行内注释说明各行依据 |
| [`src/index.ts`](src/index.ts) | 包入口；不携带任何运行时 API |
| [`tests/base.spec.ts`](tests/base.spec.ts) | manifest（元数据清单）声明、未固定的默认模型，以及不含工具、遥测与 DeepSeek 服务行的检查 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当你想深入了解 profile、基于本核心构建的表层或确切组合时，阅读以下页面。

- [app-boot 的 profile 章节](../../boot/app-boot/README.zh.md)——profile 如何解析、分层与定制。
- [组合包索引](../README.zh.md)——基于本核心构建的表层。
- [dsh-agent-tools](../agent-tools/README.zh.md)——`headless`、`sdk` 与 `acp` profile 叠加的本地工具平面。
- [生成组合图](../../../apps/cli/composition.md)——随发行版交付的每个 profile 使用的确切插件集合。
- [Profile 组合包设计笔记](../../../.agents/notes/implemented/architecture/2026-08-05-profile-plugin-bundles.zh.md)——profile 与组合包的组合设计。

-----

<a id="model-experience"></a>
## 模型体验

通过每条插入行所属的包间接产生影响，由各包负责其行的模型可见行为。

#### KV Cache 影响

组合包本身不添加任何请求前缀；每条插入行所属的包负责各自的缓存影响。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制告诉你核心何时需要额外注意、覆盖应放在哪里。它们是当前包约束，不是通用对比或任务积压。

- **新 profile 没有模型**——在你配置提供方之前，pi-ai 适配器不注册任何路由，因此在你于 **Settings → Models** 或 `llm-pi-ai:` 设置节中添加模型之前，agent 无法回答。
- **只有 `web` profile 的组合包随 dsh 运行时交付**——`dsh-agent-tools` 以及 `headless`、`sdk` 与 `acp` 模式组合包是 CLI 的开发依赖，因此这些 profile 只能在源码检出中使用。
- **覆盖会替换整个设置块**——patch 条目会替换目标的整个配置，因此你的覆盖必须重述每个想保留的设置；不会自动合并。
- **按表层的设置属于该表层的组合包**——web GUI 与 headless 模式取值不同的默认值放在对应表层的组合包里，而不是共享核心。
- **全文会话搜索处于关闭状态**——`session-query-sqlite` 行保持 `openAt: never`；后续 patch 层把 `openAt` 设为 `first-search` 或 `startup` 即可启用内容搜索。
- **在沙箱化文件系统提供方之上添加普通提供方会导致 profile 失败**——两者注册同一个服务，profile 因此拒绝加载；二选一。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
