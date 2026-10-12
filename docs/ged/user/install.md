# Install GedCode

GedCode runs coding agents on your computer and lets you control them from its desktop app. Set up the
machine where the agents will work first.

## Requirements

- A Mac with Apple Silicon (arm64). No Windows, Linux or Intel Mac builds are published.
- At least one installed, authenticated provider before you start a thread. You can open GedCode first
  and configure providers afterwards. See [Providers](./providers.md).

## Install the desktop app

1. Download the `.dmg` from [GitHub Releases](https://github.com/edgyarmati/gedcode/releases).
2. Drag GedCode to Applications.
3. The app is not notarized, so macOS blocks the first launch. Right-click GedCode and choose **Open**,
   then confirm. Alternatively, try to open it once, then go to **System Settings → Privacy & Security**
   and choose **Open Anyway**.

You only do this once. After that, updates install automatically from inside the app.

## The `gedcode` command

Open **Settings → General → About** and choose **Install** next to the `gedcode` command setting. It
adds a `gedcode` link to a folder on your `PATH`, like VS Code's `code`. Open a new terminal afterwards.
**Remove** takes it off again.

| Task                                               | Command                   |
| -------------------------------------------------- | ------------------------- |
| Open the current directory as a project in the app | `gedcode app` (or a path) |
| Start the server without a browser                 | `gedcode serve`           |
| Create a pairing link for another device           | `gedcode pair`            |
| Add, rename or remove projects                     | `gedcode project --help`  |
| Manage paired devices and sessions                 | `gedcode auth --help`     |

`gedcode --help` lists everything. `gedcode app` needs the desktop app to be running.

If a server is already running, connect to it instead of starting another. To run an independent
server, give it a different `--base-dir`.

## Where your data lives

Projects, threads and settings are stored on the machine that runs the server, in `~/.gedcode`.
Keybindings are in `~/.gedcode/userdata/keybindings.json`.

## Project configuration

A `gedcode.json` file in a repository root configures that project, for example its setup scripts for
new worktrees. New worktrees get branch names like `gedcode/1a2b3c4d`; change the prefix in settings
(the default is `gedcode`).

## Providers

GedCode drives agents you already have. Open **Settings → Providers**, select the environment, and
enable the provider you want. Installation and login belong to the machine that runs the agents. See
[Providers](./providers.md).

## Updating

GedCode checks for updates itself and installs them in the app after you confirm. Releases and
release notes are on [GitHub Releases](https://github.com/edgyarmati/gedcode/releases). For background
on how updates work, see [Sparkle updates](../sparkle-updates.md).

## Next steps

- [Permission modes](./permission-modes.md): choose when agents ask before acting.
- [Keyboard shortcuts](./keybindings.md)
- [Remote access](./remote-access.md): connect from another device.
- [Source control](./source-control.md)
- [Outside agents](./outside-agents.md): drive GedCode from Claude Code, Codex and others.
