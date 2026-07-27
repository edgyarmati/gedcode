# STATE

- **Phase**: implement
- **Active roadmap**: Reliable Replay, Then Task-Oriented Inbox
- **Active PR**: PR 1 — Durable Subscription Bootstrap
- **Active task**: WS-10 — commit, push, and open detailed PR 1
- **Clarified**: 2026-07-27
- **PR 2 status**: blocked on human review and merge of PR 1

## Locked Decisions

- Two sequential, non-stacked PRs; do not merge without explicit authorization.
- PR 1 covers durable sequence-backed state after persistence, not raw provider/token streams.
- Server guarantees snapshot → replay → buffered live → live ordering and deduplication through one
  shared abstraction; the client retains defensive gap recovery.
- Domain history remains lossless. Coalescing and payload trimming happen only at the WebSocket
  boundary with explicit sequence/truncation metadata.
- No compatibility shims are required because there are no production clients.
- Inbox has a sliding `Threads | Orchestrator` pill and separate Active/Snoozed/Settled filtering,
  with no project grouping.
- Orchestrator rows open the owning project-level Orchestrator view.
- Lifecycle is durable and replayable; snooze survives ordinary background work but raised-hand
  conditions surface immediately.
- Production-code delegation is Sol-low only. Terra-low is limited to scouting, testing, and
  independent verification. Luna is unavailable.

## Upstream Reference Facts

- Reliability concepts: `c14a5ca4`, `db4b2d8a`, `d60f6e97`, `765e1b5f`.
- Sidebar lifecycle: `32c6012d`, `202e5609`, with later polish used selectively.
- Upstream normal-thread auto-settle defaults to three days; nullable disables it; valid range is
  1–90 days.
- Snooze presets are one hour, this evening when more than one hour away, tomorrow 09:00, and next
  Monday 09:00 using local-calendar arithmetic.
- Do not import upstream's Sidebar/client-runtime stack or project grouping.
