# Message Queueing Design Spike (Plan 015)

Status: SPIKE / design only. No runtime, contract, or store changes are made by this
document. This is a decision record to scope a future build.

Closes #19.

## Problem

While a turn is running the user cannot line up the next instruction. They must wait for
the turn to finish, then type and send. For long-running agent turns (the common case for
Codex/Claude coding turns) this is a real workflow gap: the user knows the next step but
has to babysit the turn to dispatch it. We want a "queue the next message" affordance: type
now, and have it sent automatically once the current turn completes.

This is distinct from _steering_ (injecting a message into the in-flight turn) which the
adapters already support — see "Today: no queue, only steer + optimistic buffer" below.

## Evidence: there is no queue concept today

`git grep -rniE "messageQueue|enqueue|queuedMessage|queueMessage"` over
`apps/web/src apps/server/src packages/contracts/src` returns only:

- `apps/server/src/serverRuntimeStartup.ts:51,71,102,431` — `enqueueCommand`, the command
  gate that defers dispatched commands until runtime readiness (a startup gate, not a
  user-message queue).
- `apps/server/src/terminal/Layers/Manager.ts:982,1000` — terminal `persistWorker.enqueue`
  (persists PTY output, unrelated).
- `apps/server/src/orchestration/Layers/CheckpointReactor.ts:846,855`,
  `ProviderCommandReactor.ts:1024`, `ProviderRuntimeIngestion.ts:1715,1723`,
  `ThreadDeletionReactor.ts:88` — internal reactor `worker.enqueue` fan-in queues
  (event processing, not user messages).

`git grep -rniE "\bqueue"` over `apps/server/src packages/contracts/src` returns no
user-facing queue. There is no queue command, event, projection column, or store field for
holding a user's next message.

### Today: no queue, only steer + optimistic buffer

- Optimistic send buffer: `apps/web/src/components/ChatView.tsx:694` holds
  `optimisticUserMessages` — a render-only buffer of just-sent messages awaiting a server
  echo (reconciled against `serverMessages` at `ChatView.tsx:1611,1615`, cleared at
  `:2347`). It is not a queue: messages are already dispatched, it only smooths rendering.
- Composer eligibility while running:
  `apps/web/src/components/ChatView.logic.ts:380` — `hasServerAcknowledgedLocalDispatch`
  branches on `input.phase === "running"` to return booleans for steer/dispatch
  eligibility. There is no buffering; the composer either dispatches now or is blocked.
- Composer footer while running: `apps/web/src/components/chat/ChatComposer.tsx:2417` —
  `ComposerFooterPrimaryActions` is rendered with `isRunning={phase === "running"}` and
  `onInterrupt={handleInterruptPrimaryAction}`. The footer switches to a stop/interrupt
  affordance; there is no "queued message" state.
- Steering (the closest existing behavior): when a `thread.turn.start` command arrives
  while a turn is active, the adapters treat it as a steer that injects into the _running_
  turn rather than starting a new one:
  `apps/server/src/provider/Layers/OpenCodeAdapter.ts:1154` (`steeringTurnId =
context.activeTurnId`, reuses the active `turnId`, suppresses a fresh `turn.started` at
  `:1210`); `apps/server/src/provider/Layers/ClaudeAdapter.ts:3188` (`steeringTurnState`).
  A queue is the opposite policy: hold the message and start a _new_ turn after completion.

## Turn lifecycle (state diagram) with file:line triggers

The web phase is `SessionPhase = "disconnected" | "connecting" | "ready" | "running"`
(`apps/web/src/types.ts:21`). The relevant slice for queueing is `ready` <-> `running`,
driven by the orchestration session's `orchestrationStatus` and `activeTurnId`.

```
                 thread.turn.start dispatched
                 (web: ChatView.tsx:2926 / :3243 / :3371,
                  ChatView.browser.tsx:2536 / :2763)
                          |
                          v
   +-----------+   turn.started (runtime event)   +-----------+
   |   ready   | ───────────────────────────────► |  running  |
   | (idle):   |   session.activeTurnId := turnId  | activeTurn|
   | activeTurn|   status := "running"             | Id set,   |
   | Id = null |   OpenCodeAdapter.ts:1203-1218    | status =  |
   +-----------+                                   | "running" |
        ▲                                          +-----------+
        │                                                |
        │  turn.completed (runtime event)                |
        │  CheckpointReactor.ts:353,531,791              |
        │  ProjectionPipeline.ts:1157,1245 clears        |
        │  activeTurnId when it == event.payload.turnId  |
        │  status returns to "running"->idle             |
        └────────────────────────────────────────────────┘
                  ▲  THIS is the edge a queue flushes on
```

Supporting derivations:

- Runtime event vocabulary: `packages/contracts/src/providerRuntime.ts:162-163` defines
  `"turn.started"` and `"turn.completed"`. `turn.completed` is the authoritative
  turn-finished signal (consumed at `CheckpointReactor.ts:791`,
  `ProjectionPipeline.ts:1157,1245`).
- Web "is the turn done" derivation: `apps/web/src/session-logic.ts:296-299` —
  `runningTurnId = status === "running" ? session.activeTurnId : null`; when the latest
  turn's `turnId` matches the running turn the UI shows it as active. When `activeTurnId`
  clears (turn complete), the phase returns to idle.
- Server-side acknowledgement of a local dispatch transitioning to running is tracked at
  `apps/web/src/components/ChatView.logic.ts:374-394` (latest-turn fields change +
  `session.activeTurnId` match).

The trigger to flush a queued message is the `turn.completed` runtime event for the active
turn (equivalently: the orchestration projection clearing `activeTurnId`). That is the
single, already-existing edge a queue hooks into.

## Where should the queue live?

Two homes are possible.

### Option A — web-store only (client-local)

The queued message is React state in the chat view (sibling to `optimisticUserMessages`).
On observing the active turn complete (the phase returns to idle / `activeTurnId` clears),
the client dispatches the normal `thread.turn.start` command it would have sent manually.

- Pros: smallest change; no contract/projection work; ships fast; reuses the exact existing
  dispatch path (`ChatView.tsx:2926`).
- Cons: NOT durable. A queued message is lost on browser refresh, tab close, web reconnect,
  or server restart mid-turn. It is invisible to a second paired device — if you queue on
  desktop and pick up on a phone, the phone shows nothing and may double-send. Two tabs
  each holding a local queue can both flush on completion and fire duplicate turns. The
  flush also depends on the client being connected at the exact moment the turn completes;
  if the client is offline at completion, the message either never sends or sends late on
  reconnect with stale context.

### Option B — orchestration projection (durable, server-owned) — RECOMMENDED

The queue is modeled as orchestration commands/events, like every other thread mutation in
`packages/contracts/src/orchestration.ts`. A `thread.queue.enqueue` command produces a
`thread.message-queued` event; the projection stores queue entries on the thread aggregate.
A server-side reactor watches the runtime `turn.completed` edge
(`CheckpointReactor.ts:791` is the existing precedent for reacting to that event) and, when
the queue is non-empty and the thread is idle, dispatches the next queued message as a
`thread.turn.start` command, emitting `thread.message-queue-flushed`.

- Pros: durable across web reconnect, server restart, and refresh (it is event-sourced like
  the rest of the thread). Consistent across paired devices — every client sees the same
  queue via the existing `orchestration.domainEvent` push and the snapshot replay path
  (`OrchestrationThreadStreamItem` snapshot|event at `orchestration.ts:1124`). The flush is
  driven server-side off the authoritative `turn.completed`, so it does not depend on any
  client being connected at completion time, and a single server-owned flush eliminates the
  multi-tab double-send race. Replay/audit comes for free.
- Cons: more work — a new command, event, payload, projection table/column, snapshot field,
  and a reactor. Touches the contracts package and projection pipeline.

### Recommendation

**Option B (durable orchestration projection).** AGENTS.md core priorities are
reliability and predictable behavior under reconnect/restart/partial streams, and the
explicit motivation for this feature is long-running turns plus remote/paired-device use.
A client-local queue (Option A) silently fails exactly under those conditions (refresh
mid-turn, hand-off between devices, server restart) and introduces a multi-client
double-dispatch race. The durability and single-flush guarantees of Option B are worth the
extra projection work. The flush hook already exists as a first-class signal
(`turn.completed`), and the command/event/projection machinery is well-trodden in this
codebase, so Option B is incremental rather than novel.

A pragmatic middle path is allowed during build: Phase 1 may ship the queue _entry_ state
durably (B's contracts + projection) while the flush trigger is still client-observed, then
move the flush server-side in Phase 2. But the queue home itself should be the durable
projection from the start to avoid a throwaway client-only data model.

## Flush + composition semantics (recommended defaults)

| Question                  | Options                                                 | Recommended default                                                                             | Rationale                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auto-flush vs manual      | auto-send on turn complete; or hold until user confirms | **Auto-flush on `turn.completed`**                                                              | The feature's whole value is unattended hand-off; manual confirm defeats the purpose. Provide a visible "queued, will send when this turn finishes" indicator and a cancel affordance.                                                                                                                                                                            |
| Reorder / edit / cancel   | none; cancel only; full edit + reorder                  | **Cancel + edit of a still-queued entry; reorder only if multi is enabled**                     | Editing/cancelling a not-yet-sent message is low-risk and high-value. Reorder only matters once multi-queue exists. Editing a queue entry maps to a `thread.queue.update` command.                                                                                                                                                                                |
| Precedence vs steer       | queue wins; steer wins; mutually exclusive              | **Steer and queue are distinct, explicit actions; queue never auto-steers**                     | Steering injects into the _running_ turn (`OpenCodeAdapter.ts:1154`, `ClaudeAdapter.ts:3188`); queueing waits for completion. Keep them separate so behavior is predictable: a queued message must NOT be reinterpreted as a steer. If the user wants to steer, that is a different button.                                                                       |
| Behavior on interrupt     | flush anyway; hold; discard                             | **Hold the queue; do not auto-flush on user interrupt**                                         | An interrupt (`thread.turn.interrupt`, `orchestration.ts:623`) is a "stop, I want control" signal. Auto-firing the queued message immediately after the user interrupts would be surprising. Keep the entry queued and let the user send/cancel explicitly. After a _natural_ `turn.completed`, auto-flush.                                                       |
| Single vs multi           | one slot; FIFO list                                     | **Single slot in Phase 1; FIFO multi later**                                                    | One queued message covers the dominant use case and sidesteps reorder/precedence complexity. The schema is shaped as a list so multi is additive, but the UI/flush enforces a single pending entry initially.                                                                                                                                                     |
| Dispatch-failure handling | drop; retry; surface error + requeue                    | **On flush, dispatch failure surfaces an error and leaves the entry queued (not auto-retried)** | If the post-completion `thread.turn.start` is rejected (`OrchestrationDispatchCommandError`, `orchestration.ts:1269`) or the environment is unavailable, silently dropping the user's message is the worst outcome. Keep it queued, mark it `failed` with the error, and let the user retry/edit. No infinite auto-retry — predictable under failure (AGENTS.md). |

Edge cases worth pinning down during build:

- Turn completes while the message is mid-edit: hold the flush until edit is committed, or
  flush the last committed text — recommend flushing committed text and surfacing that an
  uncommitted edit was discarded.
- Thread archived/deleted while a message is queued: cascade-clear the queue (the deletion
  reactor at `ThreadDeletionReactor.ts:88` is the natural place).
- Session error/exit before completion: treat like dispatch failure — keep queued, mark
  blocked, surface the session error.

## Contracts schema SKETCH (documentation only — NOT added to the package)

Modeled on the existing patterns in `packages/contracts/src/orchestration.ts`
(`ThreadArchiveCommand` at :516, `ThreadTurnStartCommand` at :581, the `OrchestrationEvent`
union at :1010, `EventBaseFields` at :998). **These are illustrative only; nothing below is
to be added to `packages/contracts` as part of this spike.**

```ts
// --- Queue entry value object (stored on the thread projection) ---
const QueuedMessageStatus = Schema.Literals(["queued", "failed", "cancelled"]);

const QueuedMessage = Schema.Struct({
  queueEntryId: QueueEntryId, // new branded id, mirrors MessageId/CommandId
  messageId: MessageId, // the message that will be sent on flush
  text: Schema.String,
  attachments: Schema.Array(ChatAttachment),
  status: QueuedMessageStatus,
  // carry the same dispatch knobs thread.turn.start needs at flush time:
  modelSelection: Schema.optional(ModelSelection),
  gedWorkflowEnabled: Schema.optionalKey(Schema.Boolean),
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  lastError: Schema.NullOr(TrimmedNonEmptyString),
  enqueuedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

// --- Client commands (join DispatchableClientOrchestrationCommand, :664) ---
const ThreadQueueEnqueueCommand = Schema.Struct({
  type: Schema.Literal("thread.queue.enqueue"),
  commandId: CommandId,
  threadId: ThreadId,
  queueEntryId: QueueEntryId,
  message: Schema.Struct({
    messageId: MessageId,
    role: Schema.Literal("user"),
    text: Schema.String,
    attachments: Schema.Array(UploadChatAttachment), // client variant, cf. :611
  }),
  modelSelection: Schema.optional(ModelSelection),
  gedWorkflowEnabled: Schema.optionalKey(Schema.Boolean),
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  createdAt: IsoDateTime,
});

const ThreadQueueUpdateCommand = Schema.Struct({
  // edit a still-queued entry
  type: Schema.Literal("thread.queue.update"),
  commandId: CommandId,
  threadId: ThreadId,
  queueEntryId: QueueEntryId,
  text: Schema.optional(Schema.String),
  // attachments/model/mode optional updates...
  createdAt: IsoDateTime,
});

const ThreadQueueCancelCommand = Schema.Struct({
  type: Schema.Literal("thread.queue.cancel"),
  commandId: CommandId,
  threadId: ThreadId,
  queueEntryId: QueueEntryId,
  createdAt: IsoDateTime,
});

// --- Internal command emitted by the flush reactor (join InternalOrchestrationCommand, :770) ---
const ThreadQueueFlushCommand = Schema.Struct({
  type: Schema.Literal("thread.queue.flush"),
  commandId: CommandId,
  threadId: ThreadId,
  queueEntryId: QueueEntryId,
  turnId: TurnId, // the completed turn that triggered the flush
  createdAt: IsoDateTime,
});

// --- Event types (add to OrchestrationEventType literals, :787) ---
//   "thread.message-queued"
//   "thread.message-queue-updated"
//   "thread.message-queue-cancelled"
//   "thread.message-queue-flushed"
//   "thread.message-queue-flush-failed"

const ThreadMessageQueuedPayload = Schema.Struct({
  threadId: ThreadId,
  entry: QueuedMessage,
});

const ThreadMessageQueueFlushedPayload = Schema.Struct({
  threadId: ThreadId,
  queueEntryId: QueueEntryId,
  messageId: MessageId,
  turnId: TurnId, // turn that completed and triggered the flush
  startedTurnId: Schema.NullOr(TurnId), // the new turn the flush started, if any
});

const ThreadMessageQueueFlushFailedPayload = Schema.Struct({
  threadId: ThreadId,
  queueEntryId: QueueEntryId,
  reason: TrimmedNonEmptyString,
});

// Events use the shared EventBaseFields (:998) + a payload, exactly like every other
// member of the OrchestrationEvent union (:1010). Snapshot exposure: add a
// `queuedMessages: ReadonlyArray<QueuedMessage>` field to the thread detail snapshot so a
// freshly connected / paired client sees the queue via OrchestrationThreadStreamItem (:1124).
```

Flush reactor sketch (server, illustrative): subscribe to runtime `turn.completed`
(precedent: `CheckpointReactor.ts:791`); when the thread has a `queued` entry and the
session is idle (`activeTurnId` cleared, `ProjectionPipeline.ts:1157`), emit
`thread.queue.flush` -> dispatch a `thread.turn.start` for the entry (reusing the existing
turn-start path) -> emit `thread.message-queue-flushed`, or
`thread.message-queue-flush-failed` and leave the entry `failed` on dispatch error
(`OrchestrationDispatchCommandError`, :1269).

## Phased build outline (rough effort)

1. **Phase 0 — Contracts + projection scaffolding** (~1-1.5 days)
   Add `QueueEntryId` brand, `QueuedMessage`, the enqueue/update/cancel commands, the
   queued/updated/cancelled events + payloads, and the projection table/column + snapshot
   field. Wire encode/decode and the receipt path. No flush yet. Includes contract tests
   mirroring `providerRuntime.test.ts` / orchestration decode tests.

2. **Phase 1 — Web compose + display, durable entry** (~1.5-2 days)
   Composer: a "queue" affordance while `phase === "running"` (sibling to the
   stop/interrupt action at `ChatComposer.tsx:2417`), dispatching `thread.queue.enqueue`.
   Render the pending entry with cancel/edit. Single-slot. Project the snapshot field into
   the web store so the queue survives reconnect and shows on paired devices. Client-side
   flush observation MAY be used here as a stopgap, but the entry itself is durable.

3. **Phase 2 — Server-side flush reactor** (~2 days)
   New reactor off runtime `turn.completed` (model on `CheckpointReactor`): on completion +
   idle + non-empty queue, dispatch `thread.turn.start` and emit
   `thread.message-queue-flushed` / `...-flush-failed`. Remove any client-side flush
   stopgap. Hold-on-interrupt and cascade-clear-on-delete handled here. Reactor tests
   (turn completes -> flush; interrupt -> no flush; dispatch failure -> entry `failed`).

4. **Phase 3 — Multi-queue + reorder (optional / follow-up)** (~1.5 days)
   FIFO list semantics, reorder command, multi-entry UI. Gated behind real demand.

Total for a shippable durable single-slot queue (Phases 0-2): roughly 5-6 days of focused
work, contracts-first.
