---
description: "Computer use through the bundled Cua Driver: embedded stdio MCP server ahel-computer and the Settings switch."
kind: "package-reference"
---

# @ahel/dsh-computer-use-cua-driver

[English](README.md) | 中文

## 概述

在 `computerUse.enabled` 打开时，把固定版本的 [Cua Driver](https://github.com/trycua/cua)（MIT）作为独立可执行文件运行。Host 以直接子进程启动 `cua-driver serve --embedded` 和 `cua-driver mcp --embedded`，并挂载为 MCP 服务器 `ahel-computer`，因此驱动工具以 `mcp__ahel-computer__<tool>` 到达模型并经过审批门控。它还提供设置 > 通用 > 电脑操作（测试版）这一行。

## 目录

- [Use this package](#use-this-package)
- [Dev Note](#dev-note)

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

`AHEL_CUA_DRIVER_E2E` 指向一个可执行文件时，`tests/real-driver.e2e.ts` 运行真实驱动（只读）。单元测试使用 `tests/fixtures/fake-cua-driver.mjs`，从不启动真实驱动。

</details>
