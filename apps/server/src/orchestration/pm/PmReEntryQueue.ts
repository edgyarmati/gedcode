import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Semaphore from "effect/Semaphore";

import type { PmAdapterShape } from "../claude/pmHarness.ts";
import type { PmRuntimeError } from "./Errors.ts";

export type PmReEntryQueueShape = {
  readonly enqueue: (message: string) => Effect.Effect<void>;
  readonly drain: Effect.Effect<void, PmRuntimeError>;
  readonly runExclusive: <A, E>(operation: Effect.Effect<A, E>) => Effect.Effect<A, E>;
};

export type PmReEntryQueueOptions = {
  /** Leave queued entries untouched while durable project policy holds delivery. */
  readonly canDrain?: Effect.Effect<boolean>;
  // Observe a failed PM turn before its error propagates out of `drain`. Lets the
  // PM runtime detect provider-instance quota exhaustion (a rate-limit turn
  // failure) and mark the instance blocked so subsequent re-entry is held rather
  // than hammered. Runs as a `tapError`, so it never swallows the original error.
  readonly onTurnError?: (error: PmRuntimeError) => Effect.Effect<void>;
};

export const makePmReEntryQueue = (
  adapter: Pick<PmAdapterShape, "isIdle" | "prompt" | "followUp">,
  options?: PmReEntryQueueOptions,
): Effect.Effect<PmReEntryQueueShape> =>
  Effect.gen(function* () {
    const queue = yield* Queue.unbounded<string>();
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
        const messages = yield* Queue.takeAll(queue);
        if (messages.length === 0) return;

        const payload = messages.join("\n\n");
        const idle = yield* adapter.isIdle;
        const turn = idle ? adapter.prompt(payload) : adapter.followUp(payload);
        yield* onTurnError === undefined ? turn : turn.pipe(Effect.tapError(onTurnError));
      }),
    );

    return {
      enqueue: (message) => Queue.offer(queue, message).pipe(Effect.asVoid),
      drain,
      runExclusive: (operation) => semaphore.withPermits(1)(operation),
    } satisfies PmReEntryQueueShape;
  });
