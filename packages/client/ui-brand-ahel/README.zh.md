---
description: "面向侧栏与空白会话首屏的 Ahel 品牌填充；供选择或替换品牌呈现的用户与维护者阅读。"
kind: "package-reference"
---

# @ahel/dsh-client-ui-brand-ahel

[English](README.md) | 中文

## 概述

本包让客户端在侧栏显示 Ahel 标志块与小写 "ahel" 字标，并在空白会话首屏的标题旁显示标志块。挂载本包的每个构建都显示 Ahel 品牌，构建 profile 不做门控。不挂载时，侧栏回退到外壳的标志块与本地构建标签，首屏显示中性圆点。本包不保留运行时状态，也不影响模型请求。

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

将本插件挂载到 Ahel 部署的浏览器插件名单。Web 应用 bundle 以 `ui-brand-ahel` 行挂载它。

### 品牌图形

标志块是红色 `#e42238` 圆角方块，内含奶油色 `#f6f1e7` 链环字形；两种颜色在浅色与深色主题下都保持不变。字标是 Prime 字体的小写 "ahel"，以轮廓绘制并使用周围文字颜色，因此在两种主题下都跟随侧栏墨色。两者都来自 `@ahel/dsh-client-ui-primitives`（`AhelTile`、`BrandWordmark`）。

### 替换品牌

使用其他身份的部署不组合本包，而是组合另一个占据相同 slot 的包。占据 slot 是唯一的组合路径；这里不存在任何品牌配置面。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

两个侧栏填充作为一组声明感知的注册安装：嵌套的 `ctx.slots.inject()` 调用等待侧栏声明，因此无论本行在声明者之前还是之后激活，这组注册都能工作；声明消失时两个填充一并撤回，HMR 期间也不会留下残缺的品牌混合。首屏标志等待会话包自身的声明。浏览器半部是 [`src/client/index.ts`](src/client/index.ts)；node 半部是一个空 Loader 座位。浏览器标题是构建环境的事（`DSH_CLIENT_TITLE`），不在 slot 系统之内。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当品牌面不够用时阅读以下页面。它们从本包占据的 slot 进入渲染这些 slot 的外壳。

- [ui-sidebar](../ui-sidebar/README.zh.md)——声明 `sidebar.brand.mark` 与 `sidebar.brand.name` 并渲染其回退。
- [ui-conversation](../ui-conversation/README.zh.md)——在首屏声明 `conversation.hero.brand.mark`。
- [Web 客户端架构](../../../docs/subsystems/web-client.zh.md)——浏览器插件行如何加载并注册 slot。

-----

<a id="model-experience"></a>
## 模型体验

无，因为本包只贡献浏览器呈现；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；本包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制界定了品牌呈现的供给方式。它们是当前包约束，不是品牌设计对比或任务积压。

- **只有一组填充**——替代呈现属于占据相同 slot 的另一个 Cordis 包。
- **浏览器标题独立**——`DSH_CLIENT_TITLE` 在构建时选择标题文本，而非通过 UI slot。
- **运行状态标志不在本包**——`@ahel/dsh-client-ui-ahel-account` 以呼吸的标志块短片填充 `conversation.brand.pulse`；首屏标志块只在悬停时借会话包的脉动呼吸。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
