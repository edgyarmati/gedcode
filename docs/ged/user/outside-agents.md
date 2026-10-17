# Outside agents

Agents that GedCode did not start can work with an environment through its MCP endpoint. They can read
projects and threads, start and message threads, and check which providers and models are available.
This covers Claude Code or Codex in your own terminal, and other tools that support remote MCP over
HTTP with OAuth. Each agent signs in once, and you choose what it may do.

## Get the MCP URL

In **Settings → Connections**, open a saved environment's menu and choose **Copy MCP URL**. The URL is
the environment's address followed by `/mcp`, for example `http://localhost:<port>/mcp`.

The agent must be able to reach that address. An agent on the same machine can use `localhost`; an agent
on another machine can use a LAN or Tailscale address. See [remote access](./remote-access.md). GedCode
has no hosted tunnel, so cloud-hosted agents cannot reach an environment unless you expose it yourself.

## Approve a sign-in

The first time an agent connects, it opens a sign-in page on the environment naming the agent. Only
approve a sign-in you just started. Enter a pairing code from **Settings → Connections** or from
`gedcode auth pairing create` on the host; a browser already signed in as an administrator can approve
without a code.

Then choose what the agent may do:

- **Read only** (default) lets it read projects and threads and see providers and models.
- **Supervised** through **Full access** also let it start, message and stop threads. A thread it
  starts cannot run with more permissions than the mode you chose.

## Claude Code

```sh
claude mcp add --transport http gedcode <mcp-url>
claude mcp login gedcode
```

`claude mcp login` opens the sign-in page in your browser. On a machine without a browser, add
`--no-browser`, open the printed URL elsewhere, and paste the final URL back when asked.

## Codex

```sh
codex mcp add gedcode --url <mcp-url>
codex mcp login gedcode
```

`codex mcp login --no-browser` prints the sign-in URL instead of opening it.

## Other agents

Any agent that supports remote MCP servers over HTTP with OAuth can connect: give it the MCP URL and
choose OAuth. Agents without OAuth support cannot connect.

## Remove an agent

Approved agents appear under **Settings → Connections** like other clients. Revoke one there to cut
off its access immediately. A sign-in lasts 30 days; after that the agent asks again.
