---
description: "headless、SDK 与 ACP profile 的本地 agent 工具平面：shell、文件、skill、subagent、工作流、后台任务、目标、计划模式、web 抓取与可选启用的遥测，供用户组合或定制 profile。"
kind: "package-bundle"
---

# @ahel/dsh-agent-tools

[English](README.md) | 中文

## 概述

`dsh-agent-tools` 把聊天核心变成本地编码 agent（智能体）：shell 命令、文件读取与编辑、文件搜索、skill、subagent、程序化工具调用（PTC）、工作流、后台任务、目标、待办列表、计划模式与 web 抓取。`headless`、`sdk` 与 `acp` profile 把它列在 `dsh-base` 与各自的模式组合包之间。`web` profile 与桌面应用不加载它。遥测行默认禁用且不带收集器 URL，web 搜索也不随附提供方。本包为私有包，只能从源码检出中解析。

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

随发行版交付的 `headless`、`sdk` 与 `acp` profile 已列出本组合包，因此在源码检出中这些 profile 无需额外配置即可获得完整工具集。

### 加入 profile

在 profile 的 `package.json` 中，把本组合包列在 `@ahel/dsh-base` 之后、模式组合包之前。随发行版交付的 `headless` profile 使用以下顺序：

```json
{
  "dsh": {
    "profile": {
      "bundles": ["@ahel/dsh-base", "@ahel/dsh-agent-tools", "@ahel/dsh-headless"]
    }
  }
}
```

`dsh` CLI 把本包列为开发依赖，而不是运行时依赖。在源码检出之外，启动器无法解析它，会在启动时把它报告为被跳过的组合包，并加载其余层。profile 约定见 [app-boot 的 profile 章节](../../boot/app-boot/README.zh.md)。

### 你得到什么

本组合包在聊天核心之上添加以下行为：

- **Shell 命令**：在 macOS 与 Linux 上通过沙箱化 bash 工具执行，在 Windows 上通过对应的 PowerShell 孪生工具执行。
- **文件工具**：在工作区内读取、写入、编辑与搜索，并把 `AGENTS.md` 指令载入提示词。
- **Skill**：从文件系统加载，通过 skill 工具使用。
- **Subagent**：全新的（`subagent`）与以历史为种子的（`subagent_fork`）进程内子 agent，并支持后续消息与子 agent 列表。
- **程序化工具调用与工作流**：运行在 Node PTC 运行时上，另有后台任务。
- **规划辅助**：待办列表、带 `/goal` 的持久会话目标，以及计划模式。
- **上下文压缩**：`/compact` 与工具结果裁剪。
- **Web 抓取**：抓取公开 HTTP(S) 页面，无需逐次审批；抓取提供方会拒绝非公开目的地址。
- **权限预设**：在核心的沙箱策略与审批之上提供 `read-only`、`workspace-write` 与 `danger-full-access`。

### 各平台的 shell 工具

在 macOS 与 Linux 上你获得 bash shell 工具；在 Windows 上则获得对应的 PowerShell 孪生工具，因此每台机器恰好有一套 shell 栈。各平台的安全行为完全一致。偏好不受沙盒约束的 PowerShell 执行器的 Windows 主机可以在其 profile patch 中切换 shell 行——切换必须同时禁用两个 PowerShell 行并重新启用两个 bash 行，否则 profile 无法加载。

### 可选工具

默认文件编辑使用 `read`、`write` 和 `edit`。`str_replace_editor` 工具仍可显式启用。要将它加入带有本组合包的 profile，请在 profile、home 或逐次调用 patch 中添加以下条目：

```yaml
- insert:
    - id: tool-str-replace-editor
      name: '@ahel/dsh-tool-str-replace-editor'
      config:
        maxOutputChars: 16000
```

`ralph` 迭代工具默认禁用；后续 patch 层用 `- id: tool-ralph` 与 `disabled: false` 恢复它。Web 搜索需要提供方：挂载一个提供方（例如 `@ahel/dsh-web-search-exa`），并在 `web` 行的 `searchProvider` 中指定它。

### 启用遥测

`otel` 与 `session-telemetry-otel` 行以 `disabled: true` 交付，导出器 URL 默认为空字符串，因此不会有会话记录离开进程。要导出，请把 `DSH_TELEMETRY_OTLP_URL` 设为完整的 OTLP 日志端点，并在后续 patch 层中启用这两行：

```yaml
- id: otel
  disabled: false
- id: session-telemetry-otel
  disabled: false
```

`DSH_TELEMETRY_MODE` 选择 `FEEDBACK_ONLY`（默认）或 `DISABLED`；[OTel 会话遥测后端](../../session/session-telemetry-otel/README.zh.md)说明每种模式发送的内容。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本组合包是一份静态 patch 文档：一个在 `dsh-base` 层之后应用的 `insert` 列表。它自身不挂载任何服务；每条插入行所属的包负责该行的行为与不变式。这些行使用核心提供的服务，例如沙箱策略、审批、工具注册表与沙箱化文件系统。

### 组合机制

patch 会替换目标行的整个 `config`，而不是合并进它。后续组合包层与用户的 profile `cordis.patch.yml` 按 id 覆盖行，每行最后一次写入生效。完整行集合及其设计依据以行内注释写在 [`cordis.patch.yml`](cordis.patch.yml) 里；[生成的组合图](../../../apps/cli/composition.md)负责渲染它。

### 平台门控

patch 在自身上按平台门控两个 shell 栈：`bash-sandbox` 与 `tool-bash` 携带 `disabled: !!js process.platform === 'win32'`，孪生行 `pwsh-sandbox` 与 `tool-pwsh` 以取反的表达式仅在 win32 挂载。权限面与 POSIX 完全一致：沙箱策略通过 Windows ACL 受限令牌 runner（`dsh-sandbox-local` → `@ahel/dsh-sandbox-windows-acl`）执行相同的文件效果策略，核心的 `fs-sandbox` 继续围栏 `ctx.fs` 写入。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | 组合包的实体：工具平面与遥测行，附以行内注释说明各行依据 |
| [`src/index.ts`](src/index.ts) | 包入口；不携带任何运行时 API |
| [`tests/agent-tools.spec.ts`](tests/agent-tools.spec.ts) | manifest（元数据清单）声明、无收集器的禁用遥测、web 抓取行，以及对称的平台门控 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当你想深入了解 profile、本层之下的核心或确切组合时，阅读以下页面。

- [dsh-base](../base/README.zh.md)——本层所基于的聊天核心。
- [组合包索引](../README.zh.md)——列出本层的 profile。
- [app-boot 的 profile 章节](../../boot/app-boot/README.zh.md)——profile 如何解析、分层与定制。
- [生成组合图](../../../apps/cli/composition.md)——随发行版交付的每个 profile 使用的确切插件集合。
- [Codex 提供方组合包](../../subagent/subagent-codex/README.zh.md)——可叠加安装的可选 subagent 提供方。

-----

<a id="model-experience"></a>
## 模型体验

通过每条插入行所属的包间接产生影响，由各包负责其行的模型可见行为。

#### KV Cache 影响

组合包本身不添加任何请求前缀；每条插入行所属的包负责各自的缓存影响。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制告诉你工具平面何时需要额外注意、覆盖应放在哪里。它们是当前包约束，不是通用对比或任务积压。

- **不随 dsh 运行时交付**——本包为私有包，且是 CLI 的开发依赖，因此只有源码检出能解析它。
- **没有 web 组合**——`web` profile 不列出本组合包，也没有随附测试覆盖该组合。
- **覆盖会替换整个设置块**——patch 条目会替换目标的整个配置，因此你的覆盖必须重述每个想保留的设置；不会自动合并。
- **Windows 的临时目录授权是按会话的私有子目录**——`workspace-write` 把写入限制在工作区与会话自己的 temp 子目录（`<temp>\dsh-<hash>`，受限子进程的 TMP/TEMP 被改写）；`read-only` 不授予任何临时目录写入权限。见 `@ahel/dsh-sandbox-windows-acl`。
- **Web 搜索没有默认提供方**——在 profile 挂载搜索提供方并在 `searchProvider` 中指定它之前，`web_search` 工具没有可用后端。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
