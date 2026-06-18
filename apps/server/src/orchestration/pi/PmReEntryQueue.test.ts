import { assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
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

  // Pins the serialization invariant the `drain` comment relies on: because
  // `PiAgentAdapter.prompt` blocks for the whole turn while holding the drain
  // semaphore, a settlement that lands mid-turn cannot be observed by a second
  // drain and routed to `followUp` — it waits for the permit and rides the next
  // `prompt`. If the semaphore were removed, the second drain would see the busy
  // adapter and the mid-flight assertion below would catch it in `followUps`.
  it.effect("serializes drains so a mid-turn settlement rides the next prompt, not follow-up", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const idle = yield* Ref.make(true);
        const prompts: string[] = [];
        const followUps: string[] = [];
        const promptEntered = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();

        const queue = yield* makePmReEntryQueue({
          isIdle: Ref.get(idle),
          // Mirror PiAgentAdapter.prompt: mark busy on entry, block for the whole
          // turn, then flip idle again on the way out.
          prompt: (message) =>
            Effect.gen(function* () {
              prompts.push(message);
              yield* Ref.set(idle, false);
              yield* Deferred.succeed(promptEntered, void 0);
              yield* Deferred.await(release);
              yield* Ref.set(idle, true);
            }) as never,
          followUp: (message) =>
            Effect.sync(() => {
              followUps.push(message);
            }) as never,
        });

        yield* queue.enqueue("first turn");
        const drain1 = yield* queue.drain.pipe(Effect.forkScoped);

        // The first drain now holds the only permit and is parked inside prompt
        // with the adapter marked busy.
        yield* Deferred.await(promptEntered);

        // A settlement lands mid-turn. A second drain must NOT observe the busy
        // adapter and fall into follow-up — it has to wait for the permit.
        yield* queue.enqueue("second turn");
        const drain2 = yield* queue.drain.pipe(Effect.forkScoped);
        yield* Effect.yieldNow;
        yield* Effect.yieldNow;

        // While the first turn is still in flight the second drain is blocked on
        // the semaphore, so nothing has been routed to follow-up.
        assert.deepStrictEqual(prompts, ["first turn"]);
        assert.deepStrictEqual(followUps, []);

        // Let the first turn finish; the buffered settlement then rides the next
        // prompt (adapter is idle again), never follow-up.
        yield* Deferred.succeed(release, void 0);
        yield* Fiber.join(drain1);
        yield* Fiber.join(drain2);

        assert.deepStrictEqual(prompts, ["first turn", "second turn"]);
        assert.deepStrictEqual(followUps, []);
      }),
    ),
  );
});
