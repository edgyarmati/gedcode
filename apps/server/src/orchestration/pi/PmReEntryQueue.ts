import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Semaphore from "effect/Semaphore";

import type { PmRuntimeError } from "./Errors.ts";
import type { PiAgentAdapterShape } from "./PiAgentAdapter.ts";

export type PmReEntryQueueShape = {
  readonly enqueue: (message: string) => Effect.Effect<void>;
  readonly drain: Effect.Effect<void, PmRuntimeError>;
};

export const makePmReEntryQueue = (
  adapter: Pick<PiAgentAdapterShape, "isIdle" | "prompt" | "followUp">,
): Effect.Effect<PmReEntryQueueShape> =>
  Effect.gen(function* () {
    const queue = yield* Queue.unbounded<string>();
    const semaphore = yield* Semaphore.make(1);

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
        if (idle) {
          yield* adapter.prompt(payload);
        } else {
          yield* adapter.followUp(payload);
        }
      }),
    );

    return {
      enqueue: (message) => Queue.offer(queue, message).pipe(Effect.asVoid),
      drain,
    } satisfies PmReEntryQueueShape;
  });
