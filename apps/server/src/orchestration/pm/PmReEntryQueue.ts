import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Semaphore from "effect/Semaphore";

import type { AssistantMessage, PmAdapterShape } from "../claude/pmHarness.ts";
import type { PmRuntimeError } from "./Errors.ts";

export const PM_LIFECYCLE_ACTION_INSTRUCTION = [
  "Continue the workflow now.",
  "Take the next concrete orchestration action in this turn.",
  "If progress genuinely requires a human decision or an external condition, end with",
  "`[PM_WAITING: <specific reason>]`.",
  "A passive acknowledgement is not a valid disposition.",
].join(" ");
export const PM_LIFECYCLE_CORRECTIVE_PROMPT = [
  "No orchestration action or explicit waiting condition was recorded for the lifecycle update.",
  PM_LIFECYCLE_ACTION_INSTRUCTION,
].join(" ");

export type PmReEntryQueueShape = {
  readonly enqueue: (message: string, kind?: PmReEntryQueueEntryKind) => Effect.Effect<void>;
  readonly drain: Effect.Effect<void, PmRuntimeError>;
  readonly runExclusive: <A, E>(operation: Effect.Effect<A, E>) => Effect.Effect<A, E>;
};

/**
 * User entries retain their position as the PM's primary request. Lifecycle
 * entries are structured, server-authored context that accompanies that
 * request instead of becoming synthetic user messages.
 */
export type PmReEntryQueueEntryKind = "lifecycle" | "user";

type PmReEntryQueueEntry = {
  readonly kind: PmReEntryQueueEntryKind;
  readonly message: string;
};

const serializeEntries = (entries: ReadonlyArray<PmReEntryQueueEntry>): string => {
  const userMessages = entries
    .filter((entry) => entry.kind === "user")
    .map((entry) => entry.message);
  const lifecycleMessages = entries
    .filter((entry) => entry.kind === "lifecycle")
    .map((entry) => entry.message);
  const userPayload = userMessages.join("\n\n");
  if (lifecycleMessages.length === 0) return userPayload;

  const lifecyclePayload = lifecycleMessages.join("\n\n");
  if (userPayload.length === 0) return lifecyclePayload;

  return [
    userPayload,
    "--- BEGIN LIFECYCLE CONTEXT ---",
    lifecyclePayload,
    "--- END LIFECYCLE CONTEXT ---",
  ].join("\n\n");
};

export type PmReEntryQueueOptions = {
  /** Leave queued entries untouched while durable project policy holds delivery. */
  readonly canDrain?: Effect.Effect<boolean>;
  // Observe a failed PM turn before its error propagates out of `drain`. Lets the
  // PM runtime detect provider-instance quota exhaustion (a rate-limit turn
  // failure) and mark the instance blocked so subsequent re-entry is held rather
  // than hammered. Runs as a `tapError`, so it never swallows the original error.
  readonly onTurnError?: (error: PmRuntimeError) => Effect.Effect<void>;
  /**
   * Require lifecycle-only turns to produce trusted orchestration-tool evidence
   * or an explicit waiting marker. Intended for providers that otherwise tend
   * to passively acknowledge lifecycle notifications.
   */
  readonly enforceLifecycleDisposition?: boolean;
};

const assistantText = (message: AssistantMessage): string =>
  message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("")
    .trim();

const hasWaitingDisposition = (message: AssistantMessage): boolean =>
  /\[PM_WAITING:\s*[^\]\s][^\]]*\]/.test(assistantText(message));

export const makePmReEntryQueue = (
  adapter: Pick<PmAdapterShape, "isIdle" | "prompt" | "followUp" | "lastTurnUsedOrchestrationTool">,
  options?: PmReEntryQueueOptions,
): Effect.Effect<PmReEntryQueueShape> =>
  Effect.gen(function* () {
    const queue = yield* Queue.unbounded<PmReEntryQueueEntry>();
    const semaphore = yield* Semaphore.make(1);
    const onTurnError = options?.onTurnError;

    // `drain` is serialized by this 1-permit semaphore, and `PmAdapterShape.prompt`
    // is blocking — it holds the permit for the *entire* PM turn and only resolves
    // once that turn settles (it flips the adapter idle again on the way out). So
    // by the time any fresh `drain` acquires the permit the previous turn has
    // necessarily completed and the adapter is idle, which is why the steady-state
    // path is `prompt`: one batched turn per drain. Settlements that arrive while a
    // turn is in flight stay queued and coalesce — via `takeAll` — into that next
    // single prompt rather than racing the running turn. The `followUp` branch is a
    // defensive fallback for an adapter reported busy by some path other than our
    // own in-flight prompt; under normal serialized operation it does not fire.
    const drain = semaphore.withPermits(1)(
      Effect.gen(function* () {
        if (options?.canDrain !== undefined && !(yield* options.canDrain)) return;
        const entries = yield* Queue.takeAll(queue);
        if (entries.length === 0) return;

        const lifecycleOnly = entries.every((entry) => entry.kind === "lifecycle");
        const enforceDisposition = options?.enforceLifecycleDisposition === true && lifecycleOnly;
        const serialized = serializeEntries(entries);
        const payload = enforceDisposition
          ? `${serialized}\n\n${PM_LIFECYCLE_ACTION_INSTRUCTION}`
          : serialized;
        const idle = yield* adapter.isIdle;
        const turn = idle ? adapter.prompt(payload) : adapter.followUp(payload);
        const result = yield* onTurnError === undefined
          ? turn
          : turn.pipe(Effect.tapError(onTurnError));
        if (!enforceDisposition || !idle || result === undefined) return;
        if (
          (adapter.lastTurnUsedOrchestrationTool !== undefined &&
            (yield* adapter.lastTurnUsedOrchestrationTool)) ||
          hasWaitingDisposition(result)
        ) {
          return;
        }
        const correctiveTurn = adapter.prompt(PM_LIFECYCLE_CORRECTIVE_PROMPT);
        yield* onTurnError === undefined
          ? correctiveTurn
          : correctiveTurn.pipe(Effect.tapError(onTurnError));
      }),
    );

    return {
      enqueue: (message, kind = "lifecycle") =>
        Queue.offer(queue, { message, kind }).pipe(Effect.asVoid),
      drain,
      runExclusive: (operation) => semaphore.withPermits(1)(operation),
    } satisfies PmReEntryQueueShape;
  });
