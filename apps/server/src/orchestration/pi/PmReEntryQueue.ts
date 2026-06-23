import { calculateContextTokens, shouldCompact } from "@earendil-works/pi-agent-core";
import type { Usage } from "@earendil-works/pi-ai";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Semaphore from "effect/Semaphore";

import { increment, orchestrationPmCompactionsTotal } from "../../observability/Metrics.ts";
import type { PmRuntimeError } from "./Errors.ts";
import type { PiAgentAdapterShape } from "./PiAgentAdapter.ts";

export type PmReEntryQueueShape = {
  readonly enqueue: (message: string) => Effect.Effect<void>;
  readonly drain: Effect.Effect<void, PmRuntimeError>;
};

export type PmReEntryQueueOptions = {
  // Observe a failed PM turn before its error propagates out of `drain`. Lets the
  // PM runtime detect provider-instance quota exhaustion (a rate-limit turn
  // failure) and mark the instance blocked so subsequent re-entry is held rather
  // than hammered. Runs as a `tapError`, so it never swallows the original error.
  readonly onTurnError?: (error: PmRuntimeError) => Effect.Effect<void>;
  readonly autoCompaction?: {
    readonly enabled: boolean;
    readonly reserveTokens: number;
    readonly keepRecentTokens: number;
    readonly customInstructions?: string;
    readonly contextWindow: number;
  };
};

export const makePmReEntryQueue = (
  adapter: Pick<
    PiAgentAdapterShape,
    "isIdle" | "latestAssistantUsage" | "prompt" | "followUp" | "compact"
  >,
  options?: PmReEntryQueueOptions,
): Effect.Effect<PmReEntryQueueShape> =>
  Effect.gen(function* () {
    const queue = yield* Queue.unbounded<string>();
    const semaphore = yield* Semaphore.make(1);
    const onTurnError = options?.onTurnError;
    const autoCompaction = options?.autoCompaction;

    const compactIfNeeded = Effect.gen(function* () {
      if (autoCompaction === undefined || !autoCompaction.enabled) return;

      const idle = yield* adapter.isIdle;
      if (!idle) {
        yield* Effect.logWarning("PM auto-compaction skipped because adapter is not idle", {
          contextWindow: autoCompaction.contextWindow,
        });
        return;
      }

      const usage: Usage | undefined = yield* adapter.latestAssistantUsage;
      if (usage === undefined) return;

      const contextTokens = calculateContextTokens(usage);
      const settings = {
        enabled: autoCompaction.enabled,
        reserveTokens: autoCompaction.reserveTokens,
        keepRecentTokens: autoCompaction.keepRecentTokens,
      };
      if (!shouldCompact(contextTokens, autoCompaction.contextWindow, settings)) return;

      yield* adapter.compact(autoCompaction.customInstructions).pipe(
        Effect.tap((result) =>
          Effect.gen(function* () {
            yield* increment(orchestrationPmCompactionsTotal, {});
            yield* Effect.logInfo("PM auto-compaction completed", {
              contextTokens,
              contextWindow: autoCompaction.contextWindow,
              tokensBefore: result.tokensBefore,
            });
          }),
        ),
        Effect.catch((error) =>
          Effect.logWarning("PM auto-compaction failed", {
            contextTokens,
            contextWindow: autoCompaction.contextWindow,
            error,
          }),
        ),
      );
    });

    // `drain` is serialized by this 1-permit semaphore, and `PiAgentAdapter.prompt`
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
        const messages = yield* Queue.takeAll(queue);
        if (messages.length === 0) return;

        const payload = messages.join("\n\n");
        const idle = yield* adapter.isIdle;
        const turn = idle ? adapter.prompt(payload) : adapter.followUp(payload);
        yield* onTurnError === undefined ? turn : turn.pipe(Effect.tapError(onTurnError));
        yield* compactIfNeeded;
      }),
    );

    return {
      enqueue: (message) => Queue.offer(queue, message).pipe(Effect.asVoid),
      drain,
    } satisfies PmReEntryQueueShape;
  });
