# Plan 015 [SPIKE]: Design message queueing (line up the next instruction during a running turn)

> **Executor instructions**: This is a DESIGN SPIKE. Your deliverable is a
> written design doc that defines where the queue lives, its lifecycle, and its
> open questions — NOT a built feature. Do the investigation, write the doc, and
> stop at the design gate. If a STOP condition occurs, stop and report. Update
> this plan's row in `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 65e913c7..HEAD -- apps/web/src/components/ChatView.logic.ts apps/web/src/components/chat/ChatComposer.tsx TODO.md`
> If any changed, re-confirm the excerpts below.

## Status

- **Priority**: P2
- **Effort**: L (design spike is M; the build is a separate, larger effort)
- **Risk**: MED
- **Depends on**: 002 (TODO.md reconcile) is a trivial companion; not blocking
- **Category**: direction
- **Planned at**: commit `65e913c7`, 2026-06-13
- **Issue**: https://github.com/edgyarmati/gedcode/issues/19

## Why this matters

Message queueing is the **only genuinely-unstarted** item in `TODO.md`'s "Bigger
things". Operators running long agent turns (the stated use case for the Ged
workflow) cannot line up the next instruction while a turn runs — today,
send-during-run is interrupt/steer-only, not buffered. A queue lets users keep
working without babysitting the turn. The design is non-trivial: a queue that
survives session restarts and reconnects must live in orchestration state, not
just the web store, and it must compose cleanly with the existing steer and
interrupt paths. This spike defines that design before any code is written.

## Current state (evidence)

- **No queue concept exists.** `grep -rn "messageQueue|enqueue user|queuedMessage|queueMessage"`
  over `apps/web/src`, `apps/server/src`, `packages/contracts/src` finds only:
  the web optimistic-send buffer (`ChatView.tsx:1615`, `optimisticUserMessages`),
  the server command gate (`serverRuntimeStartup.ts` `enqueueCommand`), and the
  terminal persist worker (`terminal/Layers/Manager.ts` `enqueue`). None is a
  user-message queue.
- **Send-during-run is gated/steered, not buffered.**
  `apps/web/src/components/ChatView.logic.ts:380` — when `input.phase === "running"`,
  the composer logic returns booleans for steer/dispatch eligibility:
  ```ts
  if (input.phase === "running") {
    if (!latestTurnChanged) {
      return false;
    }
    if (latestTurn?.startedAt === null || latestTurn === null) {
      return false;
    }
    if (session?.activeTurnId != null && latestTurn?.turnId !== session.activeTurnId) {
      return false;
    }
    return true;
  }
  ```
- `apps/web/src/components/chat/ChatComposer.tsx:2417` —
  `ComposerFooterPrimaryActions` switches to a stop/interrupt affordance when
  `isRunning`; there is no "queued message" UI state. So during a run the user
  can interrupt or (where eligible) steer, but cannot queue.
- The orchestration command/event contracts live in
  `packages/contracts/src/orchestration.ts` (commands like `ThreadArchiveCommand`,
  `thread.*` events) — read this to understand where a queue command/event/
  projection would fit, and how `dispatchCommand`/the projection pipeline work.
- The server projects events into read models via the projection pipeline
  (`apps/server/src/orchestration/Layers/ProjectionPipeline.ts`) — the natural
  home for a durable per-thread queue if it must survive restart.

## Commands you will need

| Purpose         | Command                                                                                                              | Expected on success     |
| --------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| Map turn states | `git grep -n "phase ===\|activeTurnId\|turn-completed\|TurnState\|steer" apps/web/src apps/server/src/orchestration` | maps lifecycle          |
| Map contracts   | `git grep -n "Command = Schema\|thread\\." packages/contracts/src/orchestration.ts`                                  | command/event surface   |
| Find steer path | `git grep -n "steer\|Steer" apps/server/src apps/web/src`                                                            | the existing steer impl |

## Scope

**In scope** (spike deliverables):

- A design doc: `docs/decisions/2026-06-message-queueing.md` (create
  `docs/decisions/` if absent).
- A small contracts-level _sketch_ is allowed in the doc (proposed schema for a
  queue command/event) but NOT wired into runtime.

**Out of scope**:

- Building the queue (web store changes, contracts changes, projection changes,
  composer UI). That is a follow-up plan once the design is approved.
- Changing the existing steer/interrupt behavior.

## Git workflow

- Branch: `advisor/015-spike-message-queueing`
- Commit: `docs: design message queueing (spike)`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Map the turn lifecycle and the existing send/steer/interrupt paths

Trace, with file:line: what `phase` values exist and their transitions; how a
normal message is dispatched (the non-running path of `ChatView.logic.ts` and
the command it sends); how steer works; how interrupt works; what event fires on
turn completion (the trigger a queue would flush on). Document the lifecycle as a
small state diagram in the doc.

**Verify**: the doc contains the turn-state diagram with the file:line of each
transition trigger.

### Step 2: Decide where the queue lives

Evaluate two homes against the "survives reconnect/restart" requirement:

- **Web-store-only**: simplest, but a queued message is lost on reload/reconnect
  and is invisible to other paired devices.
- **Orchestration projection (durable)**: a `thread.message-queued` command +
  event + a queue read-model, so the queue survives restart and is consistent
  across clients (matching how archiving/other thread state already works via
  contracts + projection).
  Recommend one. The stated use case (long turns, remote devices, the Ged
  reliability priority) argues for durable; say so if the evidence supports it.

**Verify**: the doc states the chosen home with the trade-off and the contracts/
projection touch-points it would require (file:line of analogous existing
command/event/projection to mirror).

### Step 3: Define flush + composition semantics

Specify the open questions explicitly:

- Flush trigger: auto-send the head of the queue on turn-complete, or require
  manual send? (Recommend auto-flush-on-complete with a visible queued state.)
- Ordering and editing: can the user reorder/edit/cancel a queued message?
- Interaction with **steer**: if steering is eligible mid-turn, does a queued
  message steer or wait? Define precedence.
- Interaction with **interrupt**: if the user interrupts, is the queue preserved
  or cleared?
- Multi-queue: one pending message or many?
- Failure: what happens if the flushed message fails to dispatch?

**Verify**: the doc answers each of these with a recommended default.

### Step 4: Sketch the contracts and a phased build plan

In the doc, sketch the proposed schema (command/event/queue entry) referencing
the existing `orchestration.ts` patterns, and outline a phased build (e.g. Phase
1: durable single-message queue with auto-flush; Phase 2: reorder/edit/multi).
This sketch is documentation only — do not add it to `packages/contracts`.

**Verify**: the doc contains a schema sketch and an ordered, phased build outline
with rough effort per phase.

## Test plan

No code tests (design spike). The deliverable is the doc; its quality bar is that
a follow-up implementer could build Phase 1 from it without re-deriving the turn
lifecycle or the queue-home decision.

## Done criteria

- [ ] `docs/decisions/2026-06-message-queueing.md` exists
- [ ] It contains the turn-state diagram (with file:line triggers), the queue-home decision + trade-off, the flush/steer/interrupt composition rules, and a contracts sketch + phased build outline
- [ ] No runtime/contracts code was committed (spike is design-only)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (the maintainer owns product direction) if:

- The turn lifecycle is more complex than the evidence suggests (e.g. multiple
  concurrent turns per thread) such that "flush on turn-complete" is ambiguous —
  report what you found and ask for direction.
- A durable queue would require schema migration patterns this repo does not yet
  have an example of — report; that affects the effort estimate.
- You discover a partial queue implementation the "Current state" grep missed —
  re-scope.

## Maintenance notes

- This is the product's genuine next feature; keep the spike honest about the
  reconnect/restart requirement, which is the thing that makes a naive web-only
  queue wrong for this product.
- Once the design is approved, remove "Queueing messages" from `TODO.md` in the
  build PR (plan 002 leaves it as the sole open item).
