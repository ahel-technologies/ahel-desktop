# Ahel Desktop

English | [中文](README.zh.md)

Ahel Desktop is a desktop chat app for [ahel.ai](https://ahel.ai). Sign in with your ahel.ai account and the Ahel MCP connects on its own, so your apps, their cards and their approvals work right in the chat.

Models come from your ahel.ai account, your own API key, or a coding CLI already installed on your computer.

## Download

Get the latest macOS (Apple silicon) or Windows build from [the latest release](https://github.com/ahel-technologies/ahel-desktop/releases/latest).

Builds are unsigned beta builds for now. macOS: open the app once; when macOS refuses it, go to System Settings > Privacy & Security, press Open Anyway and enter your Mac password (right-click > Open no longer works on macOS 15). Windows: SmartScreen > More info > Run anyway.

## Build from source

Install Node.js and pnpm, then run:

```sh
pnpm install
pnpm run build
pnpm run package:desktop:mac:arm64:dev
```

The unsigned app lands under `apps/desktop/.desktop-build/`. See the [development guide](docs/development.md) and [AGENTS.md](AGENTS.md) for the rest.

## What is open and what is hosted

The desktop client in this repository is open source. The ahel connector (MCP), the chat gateway, the catalog, the knowledge data and billing are the hosted [ahel.ai](https://ahel.ai) service and are not in this repository.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md). Report security issues as described in [SECURITY.md](SECURITY.md).

## Licence

Code written by Ahel Technologies OÜ is licensed under the [Apache License 2.0](LICENSE). Code inherited from [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) by DeepSeek stays under the MIT License; [NOTICE](NOTICE) keeps its copyright notice and explains how to tell the two apart. Third-party dependencies and their licenses are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Bundled fonts are licensed under the SIL Open Font License.

## Trademarks

The ahel name, the tile and the wordmark are trademarks of Ahel Technologies OÜ and are not covered by either license; forks must rename and replace them, as [TRADEMARK.md](TRADEMARK.md) describes. DeepSeek Harness is a trademark of DeepSeek; this project is not affiliated with or endorsed by DeepSeek.
