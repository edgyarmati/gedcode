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
