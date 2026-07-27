# Notes

> Handoff notes for cross-session context.

## WS-01 — durable subscription surface map and shared contract (2026-07-27)

Outcome: **use one server-owned ordered-bootstrap primitive for all four durable subscription
surfaces**. Keep the existing WebSocket method names and surface-specific snapshot/event schemas;
the shared API is an internal server abstraction, not a replacement client runtime or a raw-provider
stream contract.

### Current surface map

| Surface | WebSocket method | Snapshot loader/cursor | Live source | Replay/filter | Web consumer |
| --- | --- | --- | --- | --- | --- |
| Shell | `orchestration.subscribeShell` | `ProjectionSnapshotQuery.getShellSnapshot()` / `snapshotSequence` | `OrchestrationEngine.streamShellEvents` (domain events mapped once through the shared shell hub) | **None today** | `environments/runtime/connection.ts`; snapshot gates environment bootstrap, later shell projection events are sequence-deduped |
| Normal thread | `orchestration.subscribeThread` | `getThreadDetailById()` plus a separately loaded `getSnapshotSequence()` | `streamDomainEvents`, filtered to the thread and `isThreadDetailEvent` | `readEvents(snapshotSequence)`, same filter plus `lastClearedSequence` boundary | `environments/runtime/service.ts`; protects a newer aggregate event from an older snapshot |
| Orchestrator project | `orchestrator.subscribeProject` | `loadOrchestratorProjectSnapshot()` derived from `ProjectionSnapshotQuery.getSnapshot()` | `streamDomainEvents`, filtered by `isProjectOrchestratorEvent` | `readEvents(snapshot.snapshotSequence)`, same filter plus PM-thread clear boundary | `environments/runtime/service.ts`; applies project snapshot with per-aggregate newer-event guards |
| Orchestrator task | `orchestrator.subscribeTask` | `loadOrchestratorTaskSnapshot()` derived from `ProjectionSnapshotQuery.getSnapshot()` | `streamDomainEvents`, filtered by `isTaskOrchestratorEvent` | `readEvents(snapshot.snapshotSequence)`, same filter | `environments/runtime/service.ts`; rejects an older task snapshot after a newer event |

All four currently load their snapshot before the returned live stream is materialized. Thread,
project, and task concatenate replay before live, but their live subscription is still attached too
late; shell has no replay at all. The public wire items are already the smallest useful shape:
one `{ kind: "snapshot", snapshot }`, followed by sequenced surface events (shell events are direct;
the other three use `{ kind: "event", event }`). Preserve those shapes until WS-06/WS-07 add
transport-only range/truncation metadata.

### Smallest shared ordered-bootstrap API

Add one server module (suggested name `orderedDurableSubscription.ts`) whose only public operation is
conceptually:

```ts
orderedDurableSubscription({
  live,                 // hot sequenced source; the primitive MUST start draining it immediately
  loadSnapshot,         // returns a snapshot containing snapshotSequence
  replayAfter,          // (cursor, limit) => ordered durable source
  projectReplay,        // domain event => zero or one surface event, preserving its sequence
  projectLive,          // live item => zero or one surface event, preserving its sequence
  toSnapshotItem,
  toEventItem,
})
```

`live` must be acquired and drained into a scoped queue **before** invoking `loadSnapshot`; merely
constructing or reading the current lazy `Stream.fromPubSub` getter before snapshot I/O is not an
attachment. Surface filtering/projection belongs in the supplied adapters, but the primitive owns
cursor comparison, ordering, and duplicate suppression. It emits:

1. exactly one snapshot item;
2. replayed surface events with `sequence > snapshotSequence`, ascending;
3. buffered live surface events, sorted ascending, only when their sequence is greater than the
   greatest sequence already considered;
4. continuing live surface events under the same monotonic `sequence > lastSeenSequence` rule.

Use the durable **global event sequence** as the cursor. Events filtered out for a surface still need
to advance the primitive's considered cursor, otherwise sparse shell/project/task streams cannot
distinguish an intentional filter gap from missing delivery. Therefore replay and buffered-live
deduplication/order should occur on domain envelopes before optional surface projection. For shell,
historical domain events must use `toShellStreamEvent`; live delivery may keep the engine's
single-mapped shell hub only if the bootstrap input also retains the originating global sequence and
the attachment is atomic. The lower-tech-debt option is to let the shared primitive consume
`streamDomainEvents` for each subscriber and use the same shell projector for replay/live; if that
query multiplier is unacceptable, extend the shared shell hub envelope rather than create a separate
shell-only bootstrap algorithm.

The implementation must keep one queue consumer/state machine across buffer drain and ongoing live
delivery so there is no second race at the drain→live boundary. Buffered callback order is not
trusted: sort by sequence, discard `<= lastSeenSequence`, and never coalesce here.

### Central replay bound and fresh-snapshot rule

Define one exported bootstrap policy constant:

```ts
ORCHESTRATION_SUBSCRIPTION_REPLAY_LIMIT = 1_000
```

The value matches the event store's existing `DEFAULT_READ_FROM_SEQUENCE_LIMIT`, but bootstrap must
always call replay explicitly with `limit + 1` (1,001). The current engine `readEvents(cursor)` hides
the store's 1,000-event default and can silently present a truncated replay as complete; extend that
engine method to accept an explicit limit in the later implementation slice.

- Collect at most `limit + 1` durable domain events after the snapshot cursor, before
  surface-filtering.
- At `<= limit`, replay normally.
- At `limit + 1`, emit none of that stale replay, reload a fresh snapshot while the original live
  buffer remains attached, discard buffered entries at or below the new cursor, and repeat the
  bounded check from the new cursor.
- Do not fall back to an unbounded read or silently truncate. Snapshot refresh is the sole excessive-
  distance path.

Counting must happen before surface filtering: 1,001 global durable events are excessive even if
only one affects the subscribed task. This keeps memory/work bounded and gives every surface one
observable contract.

### Boundaries for the next slices

- WS-02 should expose a public subscription through the server test harness, pause its snapshot
  loader, dispatch a durable event after live attachment should have occurred, then release the
  snapshot and assert the current implementation loses it.
- WS-03 should implement only buffer/replay/drain and adopt the narrow tracer/thread path named by
  TASKS; do not add coalescing or payload trimming.
- `orchestration.replayEvents` and `orchestrationRecovery.ts` remain defensive client recovery, not
  the normal bootstrap stitcher.
- Raw Codex/Claude token, tool-progress, terminal, VCS, lifecycle, auth, and config streams are out of
  scope because they do not share this durable global cursor/snapshot contract.

## WS-06 — transport covered-sequence compaction (2026-07-28)

Added one coordinator-level behavior test in
`apps/web/src/orchestrationRecovery.test.ts`: after bootstrap snapshot cursor `0`, a transport event
covering durable sequences `1..2` must apply once, advance `latestSequence` to `2`, ignore the
duplicate range, and accept the following `3..3` range without requesting gap recovery.

The initial RED failed on the intentionally missing public `classifyDomainEventRange(1, 2)` API.
The completed slice adds explicit `coveredSequenceStart`/`coveredSequenceEnd` fields to thread stream
events, compacts only consecutive assistant streaming deltas for the same message, and preserves
completion as a separate event. The web recovery coordinator understands ranges for dense streams;
the sparse thread-detail stream intentionally continues to use its aggregate applied-sequence marker,
advanced from `coveredSequenceEnd`, rather than a global coordinator cursor. This preserves a live
aggregate event when a globally newer snapshot contains stale aggregate detail.

Independent verification passed on 2026-07-28; exact commands and counts are recorded in `TESTS.md`.

## WORKER-TRIPWIRE-01 — narrow Codex hook trust proof (2026-07-25)

Outcome: **narrow trust is provable**, so `WORKER-TRIPWIRE-02` is unblocked. Verified against
`codex-cli 0.145.0` on macOS with runtime fixtures (temporary `CODEX_HOME`, temporary git project,
server-owned hook script outside the project).

### What Codex exposes

`hooks/list` over `codex app-server` reports every discovered hook with `source`, `sourcePath`, `key`,
`currentHash`, `enabled`, `isManaged`, and `trustStatus`. Trust is keyed to the hook's sha256 hash and
read from config key `hooks.state."<hook key>"` (`trusted_hash`, `enabled`). There is no `hooks/trust`
request; the app-server surface is read-only for trust. Managed hooks come only from enterprise policy
(`/etc/codex/requirements.toml`), which is host-wide and therefore rejected here.

### Proven mechanism

The hook is delivered entirely through per-invocation config overrides, so nothing is written into the
task worktree and nothing is persisted to the user's Codex home:

```
codex -c 'hooks.PreToolUse=[{ matcher = "*", hooks = [{ type = "command", command = "<server-owned script>" }] }]' \
      -c 'hooks.state={ "/<session-flags>/config.toml:pre_tool_use:0:0" = { trusted_hash = "sha256:…", enabled = true } }' \
      …
```

- Session-flag hooks report `source: "sessionFlags"` and the stable key
  `/<session-flags>/config.toml:pre_tool_use:0:0` — independent of the project path.
- `currentHash` was identical across repeated runs, but it covers the hook definition (including the
  absolute script path), so it must be discovered per script/path via one short-lived `hooks/list`
  probe rather than hardcoded.
- Only `hooks.PreToolUse` is accepted for this shape. `hooks.pre_tool_use` and `hooks.hooks.PreToolUse`
  silently discover no hook.
- A dotted-path override (`-c hooks.state."<key>".trusted_hash=…`) does not work; the whole
  `hooks.state` table must be supplied as one inline TOML value.

### Isolation and blast radius

With the override above applied while an unrelated **user-scope** `PostToolUse` hook also existed:

```
HOOK {"source":"user","event":"postToolUse","trustStatus":"untrusted","isManaged":false}
HOOK {"source":"sessionFlags","event":"preToolUse","trustStatus":"trusted","isManaged":false}
```

- Exactly the server-owned hook became `trusted`; the unrelated hook kept its normal `untrusted` state.
- The fixture `CODEX_HOME/config.toml` was unchanged afterwards — `-c` persists nothing.
- The fixture project's worktree stayed clean (`git status --porcelain` empty).
- No `--dangerously-bypass-hook-trust`, `--dangerously-bypass-approvals-and-sandbox`, or managed-hook
  policy was used at any point.

### End-to-end A/B on a real turn

Same prompt (`/bin/echo gedcode-tripwire-probe`) under `-s danger-full-access`, hook script exiting 2
with a reason on stderr:

- **Control** (hook present, no trust override): command ran normally, hook never executed, no review
  prompt — an untrusted hook is silently skipped.
- **Test** (narrow hash trust added): `hook: PreToolUse` →
  `error=Command blocked by PreToolUse hook: GedCode tripwire: denied for the proof run.` →
  `hook: PreToolUse Blocked`, and the agent reported the block. One denial, no approval loop, no
  permission request re-entering the PM.

### Implications for WORKER-TRIPWIRE-02

- The hook script and its definition both live outside the task worktree, so the guardrail cannot
  pollute a task diff or the verification land gate (unlike `.gedcode-hooks/`, which needs an
  info/exclude entry).
- Worker sessions are spawned in `apps/server/src/provider/Layers/CodexSessionRuntime.ts` with
  `["app-server"]`; global `-c` flags must precede the subcommand.
- The per-script `hooks/list` hash probe is the only added startup cost and can be cached for the
  server process lifetime.
- Scripts, opaque subprocesses, and tools that opt out of `PreToolUse` remain outside the guardrail;
  it stays best-effort accident prevention, never filesystem isolation.
