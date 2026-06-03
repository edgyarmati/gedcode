# OpenCode

This guide is for people who want to use OpenCode in GedCode.

GedCode can either start OpenCode for you or connect to an OpenCode server you already run.

## Basic Setup

Install OpenCode and authenticate at least one upstream provider:

```bash
opencode auth login
```

Then open GedCode Settings and keep the default OpenCode provider enabled:

```text
Display name: OpenCode
Binary path: opencode
Server URL: empty
Server password: empty
```

An empty `Server URL` tells GedCode to start and manage OpenCode when it needs a provider session.

## Version Requirement

GedCode requires OpenCode v1.14.19 or newer.

Check your installed version:

```bash
opencode --version
```

If GedCode reports that OpenCode is too old, update OpenCode with the package manager you used to
install it.

## Models And Upstream Providers

OpenCode exposes models from its connected upstream providers. GedCode shows those models after the
OpenCode provider status check succeeds.

If GedCode says OpenCode is available but no upstream providers are connected:

1. Run `opencode auth login`.
2. Choose and authenticate the provider you want OpenCode to use.
3. Refresh provider status in GedCode Settings.

## Connect To An Existing OpenCode Server

Use this when you already run OpenCode elsewhere and want GedCode to connect to that server instead
of starting its own process.

In GedCode Settings, configure OpenCode like this:

```text
Display name: OpenCode Remote
Binary path: opencode
Server URL: http://127.0.0.1:4096
Server password: optional
```

Use `Server password` only when the target OpenCode server requires it. GedCode stores this value in
plain text on disk today.

## Multiple OpenCode Providers

You can add more than one OpenCode provider instance.

Common uses:

- one local OpenCode provider
- one provider connected to an existing OpenCode server
- separate named providers for different upstream model sets

Each OpenCode provider has its own settings, display name, and accent color. Use clear names so the
model picker is easy to scan.

## Troubleshooting

- OpenCode CLI is not found:
  - Set `Binary path` to the full path of your `opencode` executable.
- OpenCode is too old:
  - Upgrade to v1.14.19 or newer.
- Existing server cannot be reached:
  - Check `Server URL`, confirm the server is running, and confirm the URL is reachable from the machine running GedCode.
- Existing server rejects authentication:
  - Check `Server password`.
- No models appear:
  - Run `opencode auth login`, authenticate an upstream provider, then refresh provider status.

OpenCode setup can change over time. Use the upstream CLI docs for current OpenCode installation and
authentication details: <https://opencode.ai/docs/cli/>.
