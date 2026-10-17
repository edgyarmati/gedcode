# Providers

GedCode drives coding agents you already have. Open **Settings → Providers**, select the environment,
and enable the provider you want. Installation, login and configuration belong to the machine that runs
the agents, even when you connect from another device.

| Provider    | Install and authenticate                                                                          |
| ----------- | ------------------------------------------------------------------------------------------------- |
| Codex       | Install [Codex CLI](https://developers.openai.com/codex/cli), then run `codex login`.             |
| Claude      | Install [Claude Code](https://claude.com/product/claude-code), then run `claude auth login`.      |
| Cursor      | Choose **Sign in** under Cursor in provider settings, or set `CURSOR_API_KEY` for the server.     |
| Grok Build  | Install [Grok Build CLI](https://x.ai/cli), then run `grok login`.                                |
| OpenCode    | Install [OpenCode](https://opencode.ai), then run `opencode auth login`.                          |
| Antigravity | Install its runtime and sign in with Google from provider settings.                               |
| Pi          | Install [Pi](https://pi.dev) (Node.js 22.19 or newer), then run `pi` and `/login`.                |
| Muse Code   | Install [Muse Code](https://dev.meta.ai/docs/muse-code), run `muse login`, then enable it (beta). |
| Other ACP   | Add an agent from the ACP Registry, or a local command, under **Add provider**.                   |

Provider CLIs must be on the server's `PATH`. If GedCode cannot find one, set its **Binary path** in
provider settings, especially when you use a version manager. After changing a login or configuration,
choose **Refresh provider status**.

Add another provider instance for a separate account or configuration. Each instance can have its own
environment variables, such as API keys or a custom base URL. Mark secret values as sensitive; they are
not shown again after saving.

## Codex

Run `codex login` on the environment's machine to sign in; GedCode uses your installed Codex and its
login.

To use two accounts that can continue the same threads, keep your first account in `~/.codex` and sign
the second into a fresh directory:

```bash
mkdir -p ~/.codex_personal
CODEX_HOME=~/.codex_personal codex login
```

Then add a second Codex instance in **Settings → Providers** with **CODEX_HOME path** `~/.codex` and
**Shadow home path** `~/.codex_personal`. Both instances must use the same CODEX_HOME path. The shadow
account needs its own `auth.json`; if Codex uses an OS credential store, configure file storage for
this setup. Use a completely separate CODEX_HOME path, with no shadow home, for separate sessions and
configuration. Switch accounts in an existing thread from its model picker.

Codex can ask a question and keep working; answer it in the thread's question panel. When Codex hits a
usage limit, the thread shows the window and reset time when Codex reports them. In a Codex thread,
`/feedback` uploads the conversation and Codex logs to OpenAI.

## Claude

GedCode uses Claude Code's login and configuration. For a second account, give it its own config
directory:

```bash
mkdir -p ~/.claude_personal
CLAUDE_CONFIG_DIR=~/.claude_personal claude auth login
```

Add a Claude instance in **Settings → Providers** with **CLAUDE_CONFIG_DIR path** `~/.claude_personal`
and Binary path `claude`. Setting `HOME` instead can put credentials where GedCode will not find them.
Existing threads can only switch between instances with the same config directory.

- **Compaction:** set **Auto-compact after** (between `100000` and `1000000` tokens) to change when
  Claude summarizes. You can also send `/compact`, or use **Compact context** from the context meter.
- **Usage limits:** if your subscription runs out mid-turn, the thread shows the limit and the wait.
  Claude Code holds the turn until the window reopens; wait, or stop the turn and continue later.
- **Skills:** come from the config directory's `skills` folder and the project's `.claude/skills`
  folder. Use `$` in the composer to pick one.
- **OpenRouter and other routers:** create a Claude instance with its own config directory and set
  `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN` (sensitive) and an empty `ANTHROPIC_API_KEY` in its
  environment variables. For models outside the built-in list, use **Add custom model**.

## Cursor

Choose **Sign in** under Cursor in **Settings → Providers** and finish in your browser, or provide
`CURSOR_API_KEY` in the server's environment (it overrides browser sign-in). Each instance keeps its own
login, separate from your Cursor editor and CLI. **Change account** and **Sign out** stop that
instance's running threads and keep their history. Cursor runs agents locally in the selected project;
Cursor cloud agents are not supported.

## Grok Build

Install the CLI and run `grok login` on the environment's machine. Grok offers no **Auto-accept edits**
mode (see [permission modes](./permission-modes.md)). If it cannot sign in remotely, use
`grok login --device-auth` on the server.

## OpenCode

Install and authenticate OpenCode on the environment's machine (version 1.14.19 or newer; OpenCode 2 is
supported and detected automatically). Leave **Server URL** empty to let GedCode start OpenCode
locally, or set **Server URL** and its password to use an existing server. Don't run OpenCode 1.x and
2.x side by side on one machine. After changing OpenCode login or configuration, choose **Refresh
provider status**. **Auto** permission mode behaves like **Supervised** because OpenCode has no
automatic reviewer.

## Antigravity

GedCode runs Google's Antigravity ACP agent with its own sign-in, separate from the Antigravity IDE or
CLI. Enable it in **Settings → Providers**, install its runtime, choose **Sign in** and finish in the
browser. Wait for GedCode to confirm access and load models before starting a thread.

- **Remote sign-in:** Google returns to a `127.0.0.1` address. From another device the final page will
  fail to load; copy the full return address (including everything after `?`) into the return URL field
  where you started sign-in and choose **Continue**.
- **Other methods:** under **Sign-in method** choose Google account, Gemini Enterprise, Gemini API key,
  or Agent Platform / Vertex AI. An API key is stored in plain text in settings on the environment.
- **Runtime:** managed install supports Apple Silicon macOS, Linux and Windows hosts and needs several
  GB of free disk. Alternatively set **Binary path** to a manually installed ACP executable.
- **Limits:** use Antigravity's native `/plan` instead of GedCode's Plan mode. It cannot rewind its
  conversation, so reverting or editing an earlier turn is unavailable. Skills go in `.agents/skills`
  (also `.gemini/skills`).
- **Accounts:** add an instance per Google account. **Disable** keeps the sign-in; **Sign out** removes
  it.

## Pi

Install [Pi](https://pi.dev) on the machine running the GedCode server (Pi 0.80.5 or newer, Node.js
22.19 or newer), run `pi` then `/login`, then enable Pi in Settings and refresh the provider. For an npm
install: `npm install -g --ignore-scripts @earendil-works/pi-coding-agent`. Pi keeps its own models,
auth, extensions, skills and session history. If `pi` is not on the server's `PATH`, set its binary
path. GedCode rejects launch arguments that change Pi's execution mode or select a session. On a remote
host, sign in over SSH.

## Muse Code

Muse Code is a beta integration and is disabled by default. Install it on the environment's machine,
run `muse login`, enable **Muse Code** in **Settings → Providers**, and set **Binary path** if needed.
Provider status does not check your login; if you are signed out, messages fail until you run
`muse login`. To use an API key instead, add `META_API_KEY` to the Muse instance's environment
variables. Muse offers only **Supervised** and **Full access**.

## ACP agents

GedCode can run agents from the official
[ACP Registry](https://agentclientprotocol.com/get-started/registry) or any ACP command.

1. Open **Settings → Providers → Add provider**.
2. Search the Registry and select **Add**, or choose **Local ACP command** and enter the executable
   (one argument per row).
3. Complete the agent's sign-in under **Sign in** in its provider card.

Registry agents are third-party code; review their source and license first. They always run on the
machine that hosts your server, use their own models, tools and sandbox, and answer approval requests
by the thread's [permission mode](./permission-modes.md). The model picker lists the models the agent
reports; add others under **Custom models**. ACP agents cannot rewind their conversation, so the next
turn after a checkpoint rollback starts a fresh agent session. If an agent cannot sign in remotely, its
CLI remains available on the server (for example `codex login --device-auth`).

Registry agents are not used for GedCode's own text generation such as thread titles, commit messages
and branch names; configure a text-generation-capable provider for those.
