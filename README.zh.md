# Ahel Desktop

[English](README.md) | 中文

Ahel Desktop 是 [ahel.ai](https://ahel.ai) 的桌面聊天应用。使用 ahel.ai 账号登录后，Ahel MCP 会自动连接，你的应用、卡片和审批都能直接在聊天中使用。

模型可来自你的 ahel.ai 账号、你自己的 API key，或电脑上已安装的编程 CLI。

## 下载

从[最新 release](https://github.com/ahel-technologies/ahel-desktop/releases/latest) 下载 macOS（Apple 芯片）或 Windows 版本。

当前构建尚未签名。macOS：右键点击应用并选择“打开”。Windows：SmartScreen > 更多信息 > 仍要运行。

## 从源码构建

安装 Node.js 和 pnpm，然后运行：

```sh
pnpm install
pnpm run build
pnpm run package:desktop:mac:arm64:dev
```

未签名应用位于 `apps/desktop/.desktop-build/` 下。其余内容见[开发指南](docs/development.zh.md)和 [AGENTS.md](AGENTS.md)。

## 贡献与安全

见 [CONTRIBUTING.zh.md](CONTRIBUTING.zh.md)。安全问题请按 [SECURITY.md](SECURITY.md) 所述报告。

## 许可证

[MIT](LICENSE)。第三方依赖及其许可证列于 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

基于 DeepSeek 的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（MIT）构建。DeepSeek Harness 是 DeepSeek 的商标；本项目与 DeepSeek 无关联，也未获其认可。

内置字体采用 SIL Open Font License 授权。Ahel 图块和文字标识是 Ahel Technologies OÜ 的商标，不在 MIT 许可范围内。
