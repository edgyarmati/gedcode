# SPEC

## Goal

Backport the accepted macOS TCC prompt-loop prevention behavior from upstream commit `b76f161d`.

## Scope

- Avoid spawning Tailscale status checks when desktop exposure does not need Tailscale endpoints.
- Cache Tailscale MagicDNS status reads for a short TTL when endpoints do need it.
- Allow Tailscale endpoint resolution to use an injected MagicDNS reader.
- Treat permission-denied filesystem browse directories as empty listings.
- Stop prefetching highlighted child browse directories from the command palette.
- Add focused regression tests where local test coverage exists.
- Update changelog and upstream decision bookkeeping.

## Non-Goals

- Do not change Tailscale Serve configuration semantics.
- Do not redesign command palette browse behavior beyond removing eager child prefetch.
- Do not address source-control or Grok provider backlog items in this slice.

## Acceptance Criteria

- Desktop endpoint discovery does not invoke Tailscale status when local-only and Tailscale Serve is disabled.
- Tailscale MagicDNS lookup can be injected and cached by the caller.
- Denied browse directories return an empty entry list instead of retryable errors.
- Required repository checks pass.
- Completed upstream item is removed from the desktop/SSH/source-control backlog entry.
