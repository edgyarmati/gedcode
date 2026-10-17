# GedCode

GedCode is a desktop and web workspace for running coding agents, built on
[T3 Code](https://github.com/pingdotgg/t3code). It keeps the harness — provider sessions, the
orchestrator, remote access, source control — and adds the **Ged layer**: durable project memory and
a verification discipline that an agent cannot talk its way past.

Works with the agents already installed on your machine: Codex, Claude, Cursor, Grok Build,
OpenCode, Antigravity, Muse, Pi, and anything speaking ACP.

## What GedCode adds

The orchestrator plans work and delegates it to worker agents. The Ged layer governs what happens at
the end of that, where it matters:

- **Nothing lands without an independent verdict.** A task lead spawns a verifier that is never the
  implementer, is handed the original acceptance criteria and the diff — never the implementer's own
  summary of its work — and is told to report, not fix. Verdicts are
  per-criterion and recorded against the exact commit they judged.
- **The gate is outside the model's control.** `.ged/bin/land-gate.sh` refuses a branch with no
  matching verdict record, with a verifier from the same vendor as the implementer, or with a
  criterion marked unverifiable. An agent cannot decide it has passed.
- **Expensive models where they pay off.** Planning and verification can run on a more capable model
  than implementation, and verification deliberately runs on a _different_ vendor than the code it
  is judging.
- **`.ged/` is durable project memory** — standards, decisions, context map, plans — readable by the
  agent through MCP tools rather than re-explained every session.

See [docs/ged/workflow.md](./docs/ged/workflow.md) for how a piece of work actually moves through it.

## Installation

> [!WARNING]
> Install and authenticate at least one provider first — for example install
> [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`, or install
> [Claude Code](https://claude.com/product/claude-code) and run `claude auth login`. The
> [provider docs](./docs/ged/user/) cover each one.

Download the macOS (Apple Silicon) build from
[GitHub Releases](https://github.com/edgyarmati/gedcode/releases). Other platforms run from source
with the [local development](#local-development) steps below.

macOS builds are ad-hoc signed rather than notarized, so the first install has to be allowed
manually in System Settings. After that, the app updates itself through Sparkle.

GedCode has no package-registry or `curl | sh` installer.

## Documentation

Using GedCode:

- [Install and first run](./docs/ged/user/install.md)
- [Set up Ged in a project](./docs/ged/user/ged-setup.md)
- [Permission modes](./docs/ged/user/permission-modes.md)
- [Keyboard shortcuts](./docs/ged/user/keybindings.md)
- [Remote access from another machine or your phone's browser](./docs/ged/user/remote-access.md)
- [Connect Claude Code, Codex, ChatGPT and other agents over MCP](./docs/ged/user/outside-agents.md)
- [Source control integrations](./docs/ged/user/source-control.md)

GedCode's own:

- [The Ged workflow](./docs/ged/workflow.md) — what it guarantees, and what it deliberately does not
- [`.ged/ORCHESTRATION.md`](./.ged/ORCHESTRATION.md) — the design, including the mechanisms it rests on
- [`.ged/STANDARDS.md`](./.ged/STANDARDS.md) — how this fork stays mergeable with upstream

Building from source? Start at [docs/internals/overview.md](./docs/internals/overview.md).

## Local development

<a id="install-vp"></a>

GedCode uses [Vite+](https://viteplus.dev/guide/), so install the global `vp` tool first:

```bash
curl -fsSL https://vite.plus | bash   # Windows: irm https://vite.plus/ps1 | iex
```

Then, from the repository root (Node 24 required):

```bash
vp i
vp run dev
```

Open the pairing URL the dev runner prints — the bare origin does not authenticate a new browser.
The checks are `vp fmt`, `vp lint`, `vp run -r typecheck` and `vp test run`. The
[development runbook](./docs/operations/development.md) has the rest.

## Project status

Early and moving quickly. Expect bugs. GedCode tracks upstream closely on purpose: the Ged layer is
built to be additive so that upstream's work keeps arriving, which is also why the repository carries
its own [contribution guide](./CONTRIBUTING.md).

## Privacy

GedCode collects no usage analytics and has no accounts or servers of its own. It talks to the
network for the coding agents you run (each through its own provider and your own credentials),
and to this repository on GitHub for update checks, release downloads and the model list. Your
projects, threads and settings stay on the machine that runs the GedCode server.

## License

GedCode is available under the [MIT License](./LICENSE), and retains T3 Code's copyright alongside
its own. See [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) for bundled third-party material.
