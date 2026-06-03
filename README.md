# GedCode

GedCode is a desktop and web workspace for running coding agents through the Ged workflow: clarify the request, plan the change, implement with visible progress, verify the result, and commit or continue from the same place. The current release supports Codex, Claude, and OpenCode provider sessions.

![GedCode workspace screenshot](./assets/screenshot/workspace.png)

## Ged workflow

The Ged workflow is the reason GedCode exists. It keeps agentic coding work on a predictable path instead of leaving every task as a loose chat thread:

- clarify scope and success criteria before changing files
- plan non-trivial work in tracked `.ged/` artifacts
- implement focused slices with visible session state
- verify with recorded evidence before treating work as done
- commit or continue with the next bounded change

Read the public workflow guide: [docs/ged-workflow.md](./docs/ged-workflow.md).

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

## Project status

GedCode is early and moving quickly. Expect bugs, but the direction is clear: make structured agentic coding work visible, repeatable, and recoverable across long-running sessions.

Useful docs:

- Ged workflow: [docs/ged-workflow.md](./docs/ged-workflow.md)
- Source control integrations: [docs/source-control-providers.md](./docs/source-control-providers.md)
- Observability guide: [docs/observability.md](./docs/observability.md)
- Release checklist: [docs/release.md](./docs/release.md)

## Local development

Before local development, prepare the environment and install dependencies:

```bash
# Optional: only needed if you use mise for dev tool management.
mise install
bun install .
```

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening an issue or PR.
