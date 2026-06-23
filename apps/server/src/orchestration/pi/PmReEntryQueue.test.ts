import { assert, describe, it } from "@effect/vitest";
import type { Usage } from "@earendil-works/pi-ai";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Ref from "effect/Ref";
import * as TestClock from "effect/testing/TestClock";

import { PmRuntimeError } from "./Errors.ts";
import { makePmReEntryQueue, PM_COMPACTION_TIMEOUT } from "./PmReEntryQueue.ts";

const compactResult = {
  summary: "summary",
  firstKeptEntryId: "entry-1",
  tokensBefore: 1,
};

const makeUsage = (totalTokens: number): Usage => ({
  input: totalTokens,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
});
const noAssistantUsage = Effect.sync((): Usage | undefined => undefined);

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
        latestAssistantUsage: noAssistantUsage,
        compact: () => Effect.succeed(compactResult),
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
          latestAssistantUsage: noAssistantUsage,
          compact: () => Effect.succeed(compactResult),
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

  // WP-Q5: a failed PM turn is observed by `onTurnError` (so the runtime can
  // detect provider-instance quota exhaustion and mark it blocked) while the
  // original error still propagates out of `drain` unchanged.
  it.effect("reports a failed turn to onTurnError and re-propagates the error", () =>
    Effect.gen(function* () {
      const observed: PmRuntimeError[] = [];
      const failure = new PmRuntimeError({
        operation: "PiAgentAdapter.prompt",
        detail: "PM prompt failed.",
        cause: new Error("Rate limit exceeded"),
      });
      const queue = yield* makePmReEntryQueue(
        {
          isIdle: Effect.succeed(true),
          prompt: () => Effect.fail(failure) as never,
          followUp: () => Effect.void as never,
          latestAssistantUsage: noAssistantUsage,
          compact: () => Effect.succeed(compactResult),
        },
        {
          onTurnError: (error) =>
            Effect.sync(() => {
              observed.push(error);
            }),
        },
      );

      yield* queue.enqueue("stage result");
      const exit = yield* queue.drain.pipe(Effect.exit);

      assert.isTrue(Exit.isFailure(exit));
      assert.strictEqual(observed.length, 1);
      assert.strictEqual(observed[0], failure);
    }),
  );

  it.effect("leaves a successful turn untouched when onTurnError is supplied", () =>
    Effect.gen(function* () {
      const observed: PmRuntimeError[] = [];
      const prompts: string[] = [];
      const queue = yield* makePmReEntryQueue(
        {
          isIdle: Effect.succeed(true),
          prompt: (message) =>
            Effect.sync(() => {
              prompts.push(message);
            }) as never,
          followUp: () => Effect.void as never,
          latestAssistantUsage: noAssistantUsage,
          compact: () => Effect.succeed(compactResult),
        },
        {
          onTurnError: (error) =>
            Effect.sync(() => {
              observed.push(error);
            }),
        },
      );

      yield* queue.enqueue("stage result");
      yield* queue.drain;

      assert.deepStrictEqual(prompts, ["stage result"]);
      assert.strictEqual(observed.length, 0);
    }),
  );

  it.effect("compacts once after an idle turn when pi says the context exceeds threshold", () =>
    Effect.gen(function* () {
      const idle = yield* Ref.make(true);
      const compactIdleObservations: boolean[] = [];
      let compactCount = 0;
      let customInstructions: string | undefined;
      const queue = yield* makePmReEntryQueue(
        {
          isIdle: Ref.get(idle),
          prompt: () =>
            Effect.gen(function* () {
              yield* Ref.set(idle, false);
              yield* Ref.set(idle, true);
            }) as never,
          followUp: () => Effect.void as never,
          latestAssistantUsage: Effect.succeed(makeUsage(81)),
          compact: (instructions) =>
            Effect.gen(function* () {
              compactIdleObservations.push(yield* Ref.get(idle));
              compactCount += 1;
              customInstructions = instructions;
              return compactResult;
            }),
        },
        {
          autoCompaction: {
            enabled: true,
            reserveTokens: 20,
            keepRecentTokens: 10,
            contextWindow: 100,
            customInstructions: "Preserve active gate state.",
          },
        },
      );

      yield* queue.enqueue("stage result");
      yield* queue.drain;

      assert.strictEqual(compactCount, 1);
      assert.deepStrictEqual(compactIdleObservations, [true]);
      assert.strictEqual(customInstructions, "Preserve active gate state.");
    }),
  );

  it.effect("does not compact when auto-compaction is disabled", () =>
    Effect.gen(function* () {
      let compactCount = 0;
      const queue = yield* makePmReEntryQueue(
        {
          isIdle: Effect.succeed(true),
          prompt: () => Effect.void as never,
          followUp: () => Effect.void as never,
          latestAssistantUsage: Effect.succeed(makeUsage(99)),
          compact: () =>
            Effect.sync(() => {
              compactCount += 1;
              return compactResult;
            }),
        },
        {
          autoCompaction: {
            enabled: false,
            reserveTokens: 20,
            keepRecentTokens: 10,
            contextWindow: 100,
          },
        },
      );

      yield* queue.enqueue("stage result");
      yield* queue.drain;

      assert.strictEqual(compactCount, 0);
    }),
  );

  it.effect("logs and continues when post-turn compaction fails", () =>
    Effect.gen(function* () {
      const queue = yield* makePmReEntryQueue(
        {
          isIdle: Effect.succeed(true),
          prompt: () => Effect.void as never,
          followUp: () => Effect.void as never,
          latestAssistantUsage: Effect.succeed(makeUsage(81)),
          compact: () =>
            Effect.fail(
              new PmRuntimeError({
                operation: "PiAgentAdapter.compact",
                detail: "PM compaction failed.",
                cause: new Error("summary model unavailable"),
              }),
            ),
        },
        {
          autoCompaction: {
            enabled: true,
            reserveTokens: 20,
            keepRecentTokens: 10,
            contextWindow: 100,
          },
        },
      );

      yield* queue.enqueue("stage result");
      const exit = yield* queue.drain.pipe(Effect.exit);

      assert.isTrue(Exit.isSuccess(exit));
    }),
  );

  it.effect("times out hung post-turn compaction and releases the drain permit", () =>
    Effect.gen(function* () {
      const compactStarted = yield* Deferred.make<void>();
      const prompts: string[] = [];
      let compactCount = 0;
      const queue = yield* makePmReEntryQueue(
        {
          isIdle: Effect.succeed(true),
          prompt: (message) =>
            Effect.sync(() => {
              prompts.push(message);
            }) as never,
          followUp: () => Effect.void as never,
          latestAssistantUsage: Effect.succeed(makeUsage(81)),
          compact: () =>
            Effect.gen(function* () {
              compactCount += 1;
              if (compactCount === 1) {
                yield* Deferred.succeed(compactStarted, void 0);
                return yield* Effect.never;
              }
              return compactResult;
            }),
        },
        {
          autoCompaction: {
            enabled: true,
            reserveTokens: 20,
            keepRecentTokens: 10,
            contextWindow: 100,
          },
        },
      );

      yield* queue.enqueue("stage result");
      const firstDrain = yield* queue.drain.pipe(Effect.forkChild);
      yield* Deferred.await(compactStarted);
      yield* TestClock.adjust(PM_COMPACTION_TIMEOUT);

      const firstExit = yield* Fiber.await(firstDrain);
      assert.isTrue(Exit.isSuccess(firstExit));

      yield* queue.enqueue("next settlement");
      yield* queue.drain;

      assert.deepStrictEqual(prompts, ["stage result", "next settlement"]);
      assert.strictEqual(compactCount, 2);
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("logs and continues when post-turn compaction dies with a defect", () =>
    Effect.gen(function* () {
      const prompts: string[] = [];
      const queue = yield* makePmReEntryQueue(
        {
          isIdle: Effect.succeed(true),
          prompt: (message) =>
            Effect.sync(() => {
              prompts.push(message);
            }) as never,
          followUp: () => Effect.void as never,
          latestAssistantUsage: Effect.succeed(makeUsage(81)),
          compact: () =>
            Effect.sync(() => {
              throw new Error("compact defect");
            }),
        },
        {
          autoCompaction: {
            enabled: true,
            reserveTokens: 20,
            keepRecentTokens: 10,
            contextWindow: 100,
          },
        },
      );

      yield* queue.enqueue("stage result");
      const exit = yield* queue.drain.pipe(Effect.exit);

      assert.isTrue(Exit.isSuccess(exit));
      assert.deepStrictEqual(prompts, ["stage result"]);
    }),
  );
});
