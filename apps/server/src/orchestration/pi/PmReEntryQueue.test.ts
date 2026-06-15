import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";

import { makePmReEntryQueue } from "./PmReEntryQueue.ts";

describe("PmReEntryQueue", () => {
  it.effect("prompts when idle and buffers into follow-up when busy", () =>
    Effect.gen(function* () {
      const idle = yield* Ref.make(true);
      const prompts: string[] = [];
      const followUps: string[] = [];
      const queue = yield* makePmReEntryQueue({
        isIdle: Ref.get(idle),
        prompt: (message) =>
          Effect.sync(() => {
            prompts.push(message);
          }) as never,
        followUp: (message) =>
          Effect.sync(() => {
            followUps.push(message);
          }) as never,
      });

      yield* queue.enqueue("stage result 1");
      yield* queue.enqueue("stage result 2");
      yield* queue.drain;

      assert.deepStrictEqual(prompts, ["stage result 1\n\nstage result 2"]);
      assert.deepStrictEqual(followUps, []);

      yield* Ref.set(idle, false);
      yield* queue.enqueue("gate approved");
      yield* queue.drain;

      assert.deepStrictEqual(prompts, ["stage result 1\n\nstage result 2"]);
      assert.deepStrictEqual(followUps, ["gate approved"]);
    }),
  );
});
