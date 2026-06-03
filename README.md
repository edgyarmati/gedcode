# GedCode

GedCode is a minimal desktop and web GUI for coding agents. The current release supports Codex, Claude, and OpenCode provider sessions.

<!-- SCREENSHOT PLACEHOLDER: add one GedCode workspace screenshot here before release. -->

## Installation

> [!WARNING]
> GedCode currently supports Codex, Claude, and OpenCode.
> Install and authenticate at least one provider before use:
>
> - Codex: install [Codex CLI](https://developers.openai.com/codex/cli), run `codex login`, and see [docs/providers/codex.md](./docs/providers/codex.md).
> - Claude: install [Claude Code](https://claude.com/product/claude-code), run `claude auth login`, and see [docs/providers/claude.md](./docs/providers/claude.md).
> - OpenCode: install [OpenCode](https://opencode.ai), run `opencode auth login`, and see [docs/providers/opencode.md](./docs/providers/opencode.md).

### Run without installing

```bash
npx gedcode
```

### Desktop app

Install the latest version of the desktop app from [GitHub Releases](https://github.com/edgyarmati/gedcode/releases).

## Some notes

We are very very early in this project. Expect bugs.

Observability guide: [docs/observability.md](./docs/observability.md)

## Local development

Before local development, prepare the environment and install dependencies:

```bash
# Optional: only needed if you use mise for dev tool management.
mise install
bun install .
```

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening an issue or PR.
