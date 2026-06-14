# Scoping Spike: GUI Remote-Project Add Gap (Plan 016)

Status: spike / decision
Date: 2026-06-13
Issue: #20

## Question

`REMOTE.md` claims the GUIs cannot add projects on remote environments and that
"full GUI support for remote project management is coming soon." This spike
inventories the add-project entry points in the web GUI and determines, with
file:line evidence, whether that claim is still true.

This pass is documentation/analysis only. No code (and no `REMOTE.md` edit) is
changed here — see the Recommendation section for the follow-up.

## The stale claim

`REMOTE.md:99-102`:

> Note
> The GUIs do not currently support adding projects on remote environments.
> For now, use `gedcode project ...` on the server machine instead.
> Full GUI support for remote project management is coming soon.

## How the add-project flow is structured

Every add-project entry point in the web GUI is keyed by an `environmentId` and
dispatches over that environment's own API. The API is resolved per environment,
not from a hard-coded "local" connection.

### Entry point: environment picker

`apps/web/src/components/CommandPalette.tsx:400-433` —
`addProjectEnvironmentOptions` is built from the **primary** environment
(`primaryEnvironmentId`, lines 404-415) **plus every saved environment** in
`savedEnvironmentRegistry` (the `for (const record of Object.values(...))` loop,
lines 417-433). Saved environments are exactly the remote/LAN/Tailscale/SSH-launch
environments described in `REMOTE.md`. So the picker already lists remote
environments as add-project targets.

`apps/web/src/components/CommandPalette.tsx:905-932` — `openAddProjectFlow` shows
that environment picker when more than one environment exists, then calls
`startAddProjectSourceSelection(environmentId)` for the chosen environment.

### Entry point 1 — Add existing directory (browse)

`apps/web/src/components/CommandPalette.tsx:714-725` —
`startAddProjectBrowse(environmentId)` opens the filesystem-browse view for the
selected environment (the "Local folder" / "Browse a folder on disk" source item,
defined at lines 752-762).

- Browse data is fetched per environment:
  `apps/web/src/components/CommandPalette.tsx:511-522` — `fetchBrowseResult` calls
  `readEnvironmentApi(browseEnvironmentId)` then `api.filesystem.browse(...)`.
- The browse start path is seeded from the **per-environment**
  `addProjectBaseDirectory` setting:
  `apps/web/src/components/CommandPalette.tsx:468-483`
  (`getAddProjectInitialQueryForEnvironment` reads the saved environment's
  `serverConfig.settings.addProjectBaseDirectory` for non-primary environments).
- Selecting/confirming a directory dispatches `project.create` over the same
  per-environment API:
  `apps/web/src/components/CommandPalette.tsx:1032-1117` — `handleAddProject`
  resolves `api = readEnvironmentApi(browseEnvironmentId)` (line 1035) and calls
  `api.orchestration.dispatchCommand({ type: "project.create", ... })`
  (lines 1091-1103).

This is the "add an existing directory" path. It is end-to-end environment-keyed.

### Entry point 2 — Clone from a remote source (Git URL / provider)

`apps/web/src/components/CommandPalette.tsx:727-738` —
`startAddProjectClone(environmentId, source)` is keyed by `environmentId`.

- Provider repository lookup uses the per-environment API:
  `apps/web/src/components/CommandPalette.tsx:1141` (`api =
readEnvironmentApi(addProjectCloneFlow.environmentId)`) and
  `apps/web/src/components/CommandPalette.tsx:1178`
  (`api.sourceControl.lookupRepository`).
- The clone itself runs on the target environment:
  `apps/web/src/components/CommandPalette.tsx:1245`
  (`api.sourceControl.cloneRepository`), then hands the resulting `cwd` to
  `handleAddProject` (line 1249), which dispatches `project.create` as above.

### Why this works for non-local environments

`apps/web/src/environmentApi.ts:62-78` — `readEnvironmentApi(environmentId)`
resolves the API from `readEnvironmentConnection(environmentId)` and wraps that
environment's own `WsRpcClient`. There is **no local-only branch**; every method
(`filesystem.browse`, `sourceControl.cloneRepository`,
`orchestration.dispatchCommand` / `project.create`) is forwarded over the
environment's WebSocket connection.

`apps/web/src/environments/runtime/service.ts:1545-1549` —
`readEnvironmentConnection` looks the connection up in a registry that holds both
the primary connection and every saved (remote) environment connection.

So a remote environment is just another GedCode server reachable over its own
authenticated WebSocket; the same add-project RPCs land on that remote server.

## Inventory summary

| Entry point                            | Keyed by environmentId? | Dispatches over remote API? | Evidence                                              |
| -------------------------------------- | ----------------------- | --------------------------- | ----------------------------------------------------- |
| Environment picker (lists remote envs) | yes                     | n/a                         | CommandPalette.tsx:400-433, 905-932                   |
| Add existing directory (browse)        | yes                     | yes                         | CommandPalette.tsx:714-725, 511-522, 1032-1117        |
| Clone from Git URL / provider          | yes                     | yes                         | CommandPalette.tsx:727-738, 1141, 1178, 1245          |
| Per-environment base directory seed    | yes                     | yes                         | CommandPalette.tsx:468-483                            |
| API resolution (no local-only gate)    | yes                     | yes                         | environmentApi.ts:62-78; runtime/service.ts:1545-1549 |

There is no separate desktop add-project path: the desktop app (`apps/desktop`)
is an Electron wrapper around the same web UI and server, so it inherits the same
flow. `apps/desktop/src` contains no `project.create` / add-project code path.

`publishRepository` is exposed on the environment API
(`apps/web/src/environmentApi.ts:29`) but is **not** wired into the CommandPalette
add-project flow (no `publish` reference exists in `CommandPalette.tsx`); it is a
git-publish action used elsewhere, not an add-project entry point. So
"publish-local" is not an add-project gap.

## Security note (filesystem browse surface)

The suspected gap was "add an existing remote directory," which needs a remote
filesystem browse. That surface already exists and is already used by the GUI:
`apps/server/src/ws.ts:1006-1019` serves `filesystemBrowse` via the same handler
on every server instance, so a remote server browses **its own** filesystem. The
GUI add-existing flow reuses this already-guarded, already-authenticated
(pairing-token + session per `REMOTE.md`) per-environment RPC. No new exposure is
introduced by recognizing this path as supported, and this spike recommends no
widening of the browse surface.

## Conclusion: (a) — it already fully works; the fix is docs-only

Both add-project entry points (clone, and add-existing via browse) already accept
a non-local `environmentId` end-to-end and run against the selected environment's
own server. The environment picker already surfaces saved/remote environments.
There is no missing wiring and no new RPC surface to add.

The `REMOTE.md:99-102` note is **stale**. The remaining work is documentation:
remove (or correct) that note and describe adding remote projects from the GUI.

## Recommendation (follow-up, out of scope for this spike)

- Delete the stale `REMOTE.md:99-102` note and replace it with a short paragraph
  describing the GUI flow: open the add-project command, pick the remote
  environment, then either browse to an existing directory or clone from a Git
  URL / provider.
- Keep the CLI (`gedcode project ...`) documented as an alternative, not as the
  only option.
- No code change is required. If any UX hardening is wanted, it would be cosmetic
  (e.g. clearer labeling that "Local folder" means "a folder on the selected
  environment"), not a functional gap.
