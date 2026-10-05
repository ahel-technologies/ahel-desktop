# Ahel Desktop

English | [中文](README.zh.md)

Ahel Desktop is a desktop chat app for [ahel.ai](https://ahel.ai). Sign in with your ahel.ai account and the Ahel MCP connects on its own, so your apps, their cards and their approvals work right in the chat.

Models come from your ahel.ai account, your own API key, or a coding CLI already installed on your computer.

## Download

Get the latest macOS (Apple silicon) or Windows build from [the latest release](https://github.com/ahel-technologies/ahel-desktop/releases/latest).

Builds are unsigned for now. macOS: right-click the app and choose Open. Windows: SmartScreen > More info > Run anyway.

## Build from source

Install Node.js and pnpm, then run:

```sh
pnpm install
pnpm run build
pnpm run package:desktop:mac:arm64:dev
```

The unsigned app lands under `apps/desktop/.desktop-build/`. See the [development guide](docs/development.md) and [AGENTS.md](AGENTS.md) for the rest.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md). Report security issues as described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE). Third-party dependencies and their licenses are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Built on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (MIT) by DeepSeek. DeepSeek Harness is a trademark of DeepSeek; this project is not affiliated with or endorsed by DeepSeek.

Bundled fonts are licensed under the SIL Open Font License. The Ahel tile and wordmark are trademarks of Ahel Technologies OÜ and are not covered by the MIT license.
