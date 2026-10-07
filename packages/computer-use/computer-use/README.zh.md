---
description: "Exclusive computer-use provider registration and the computerUse.enabled switch for Ahel Desktop."
kind: "package-reference"
---

# @ahel/dsh-computer-use

[English](README.md) | 中文

## 概述

`ctx.computerUse` 持有用户的 `computerUse.enabled` 开关（volatile 字段 `enabled`，默认 `false`）和唯一的电脑操作提供者槽位。设置 > 通用 > 电脑操作（测试版）写入该开关；Cua Driver 提供者据此启动和停止驱动，开关关闭时审批门控拒绝每次电脑操作调用。

## 目录

- [Use this package](#use-this-package)
- [Dev Note](#dev-note)

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
