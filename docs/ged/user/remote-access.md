# Remote access

Connect a browser (including one on your phone) or another desktop app to GedCode running on a
different machine. That machine must stay running and reachable while you work.

Remote access in GedCode is direct: over your local network, Tailscale, or SSH. There is no hosted
relay or hosted web app.

## Pair over a LAN or private network

On a desktop host, open **Settings → Connections**, enable **Network access**, then create a pairing
link using an address the other device can reach. Changing network access restarts the desktop app.
You can turn it off in the same place.

For a command-line host, replace `<private-ip>` with the host's LAN or tailnet address:

```bash
gedcode serve --host <private-ip>
```

If a server is already running, generate a fresh link without restarting it:

```bash
gedcode pair
```

Paste the pairing URL into **Add environment** in the receiving client (**Settings → Connections**),
or into **Add a computer** on the first-run setup page.
A loopback address such as `127.0.0.1` reaches only the device that opens the link.

Pairing authorizes that device for future connections. Use a fresh one-time link for each new device.
Links created in Settings can only be copied while the Connections page that created them stays open.

### Several routes to one machine

A machine can have more than one route: LAN, Tailscale, another VPN, a public URL, or SSH. Pairing the
same machine again over another address adds a route instead of a second machine. GedCode connects over
the first route that answers and moves back to an earlier one when it works again. Select the route
count under the machine's name in **Settings → Connections** to reorder or remove routes.

## Tailscale HTTPS

Join both devices to the same tailnet. In the desktop app, enable **Tailscale HTTPS** in
**Settings → Connections**. For a command-line server:

```bash
gedcode serve --tailscale-serve
```

For an already-running server:

```bash
gedcode pair --tailscale
```

The pairing link uses an address such as `https://machine.tailnet.ts.net/`. The mapping persists across
restarts. Remove its default-port mapping with `tailscale serve --https=443 off`. If that port is in
use, choose another with `--tailscale-serve-port`. See `gedcode pair --help` for more options.

## Desktop-managed SSH

In the desktop app, open **Settings → Connections → Add environment**, choose **SSH**, and enter a host
or SSH alias such as `user@example.com`. GedCode starts or reuses a server there and opens the port
forward for you. Projects, provider credentials, and agent work stay on the remote machine.

GedCode installs its server on the remote host from the GedCode release archives. Those archives
are not published yet, so desktop-managed SSH does not work until a release ships them; use
Tailscale or your local network in the meantime. The remote host also needs your
[providers](./providers.md) installed.
Provider CLIs must be on the `PATH` of a non-interactive login shell there; check with:

```bash
ssh user@example.com 'sh -lc "command -v claude codex"'
```

## Connect an outside agent

Claude Code, Codex and other agents GedCode did not start can drive threads through the environment's
MCP endpoint. See [outside agents](./outside-agents.md).

## Manage or revoke access

On the host, **Settings → Connections** lets administrators create pairing links and revoke client
sessions. Revoke an unused link to prevent new pairings, or a device's session to remove its access.
From the command line, see `gedcode auth --help`.

To choose a token's permissions, pass `--scope` once per scope:

```sh
gedcode pair --scope orchestration:read
```

The selected scopes replace the default permissions; each command's `--help` lists the available
scopes. To change an existing client's permissions, create a fresh pairing link with the scopes it needs
and pair again; reconnecting alone does not change permissions.

Treat pairing URLs and authorization codes as passwords. Do not include them in screenshots, logs, or
bug reports.

## Use the desktop app as a remote client only

If a computer should only drive work running elsewhere, switch off **Local environment** in
**Settings → Connections**. GedCode restarts without a local server; your projects, history and saved
connections are kept. Switch it back on in the same place to restart with your previous local settings.
