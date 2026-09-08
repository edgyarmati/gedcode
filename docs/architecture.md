# Architecture

GedCode has one server runtime and two client shells. The React web client talks to the server over
authenticated HTTP and WebSocket RPC. The Electron app starts that same server locally, loads its
loopback client endpoint in production, and adds operating-system integration through a sandboxed
preload bridge. A browser can also connect directly to a local or remote server.

```text
Browser or Electron renderer
        |
        | HTTP + authenticated WebSocket RPC
        v
apps/server
        |
        +-- orchestration state, projections, and reactors
        +-- provider sessions (Codex, Claude, OpenCode)
        +-- terminal, filesystem, git, and source-control services
        +-- SQLite persistence and checkpoint refs
```

## Runtime boundaries

### Server

[`apps/server/src/server.ts`](../apps/server/src/server.ts) composes the Effect service graph and
HTTP routes. [`apps/server/src/ws.ts`](../apps/server/src/ws.ts) implements the typed WebSocket RPC
boundary defined by [`packages/contracts`](../packages/contracts). The server owns provider
processes, orchestration, persistence, terminals, filesystem access, git operations, and source
control integrations. Clients request work and subscribe to snapshots or ordered streams; they do
not own the authoritative project or thread lifecycle.

Orchestration follows a command/event/projection model. The engine validates and persists commands,
projects events into queryable state, and lets reactors perform follow-up work such as provider
dispatch, checkpointing, worktree management, and recovery. The main composition points are:

- [`OrchestrationEngine`](../apps/server/src/orchestration/Layers/OrchestrationEngine.ts) for
  serialized command dispatch and durable event state;
- [`ProviderService`](../apps/server/src/provider/Layers/ProviderService.ts) and the provider driver
  registry for Codex, Claude, and OpenCode sessions;
- [`ProviderRuntimeIngestion`](../apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts)
  and [`ProviderCommandReactor`](../apps/server/src/orchestration/Layers/ProviderCommandReactor.ts)
  for the provider/orchestration boundary;
- [`CheckpointReactor`](../apps/server/src/orchestration/Layers/CheckpointReactor.ts) for workspace
  snapshots and turn diffs.

The Orchestrator is part of this server domain rather than a second application. Its PM runtime,
task lifecycle, worktree workers, gates, and recovery services are composed alongside the normal
chat/session services.

### Web client

[`apps/web`](../apps/web) is the React/Vite client. Each connected execution environment has its own
WebSocket RPC client and environment-scoped API. The connection registry in
[`apps/web/src/environments/runtime`](../apps/web/src/environments/runtime) owns connection and
subscription lifecycles; [`environmentApi.ts`](../apps/web/src/environmentApi.ts) exposes the API for
a selected environment. This keeps local, manually paired, Tailscale, HTTPS, and SSH-forwarded
environments on the same client path.

The web app may keep optimistic or presentation state, but server snapshots and streams remain the
source of truth for durable project, thread, task, and provider state.

### Desktop client

[`apps/desktop`](../apps/desktop) is an Electron shell around the web client. Its main process:

- starts and supervises the bundled server through
  [`DesktopBackendManager`](../apps/desktop/src/backend/DesktopBackendManager.ts);
- loads the Vite development origin in development and the loopback server origin in packaged
  builds through [`DesktopWindow`](../apps/desktop/src/window/DesktopWindow.ts);
- exposes narrow native capabilities through the sandboxed preload and typed IPC contracts;
- owns desktop settings, secure storage, updates, SSH launch/forwarding, and endpoint discovery.

Privileged IPC is restricted to the trusted top-level renderer document. WebSocket RPC remains the
normal application transport even inside Electron; native IPC is reserved for capabilities a web
page cannot provide.

## Package boundaries

- [`packages/contracts`](../packages/contracts) contains schemas and shared types for RPC,
  orchestration, providers, environments, and IPC. Keep it schema-only.
- [`packages/shared`](../packages/shared) contains reusable runtime utilities and uses explicit
  subpath exports instead of a barrel index.
- [`packages/client-runtime`](../packages/client-runtime) contains client-side environment and
  endpoint primitives shared outside the React application.
- [`packages/effect-codex-app-server`](../packages/effect-codex-app-server) wraps the Codex
  app-server protocol.
- [`packages/ssh`](../packages/ssh) and [`packages/tailscale`](../packages/tailscale) implement
  optional remote-access mechanisms without changing the core HTTP/WebSocket environment model.

## Architectural invariants

- The server is authoritative for durable work and runtime lifecycle state.
- Provider-native events are normalized before they become durable orchestration state.
- Every environment is addressed explicitly; client code must not silently fall back to a different
  environment.
- Long-running follow-up work must remain ordered, observable, and recoverable after interruption.
- Cross-process and network payloads are schema-validated at their boundary.
- Native desktop privileges must not be exposed through ordinary web content.
- Compatibility fallbacks are product decisions, not automatic additions.

For remote setup and the current security guidance, see [`REMOTE.md`](../REMOTE.md). For provider
details, see [`docs/providers`](./providers). Architectural decisions that need durable rationale
belong in [`docs/decisions`](./decisions).
