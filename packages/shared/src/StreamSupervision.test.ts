import { it } from "@effect/vitest";
import { describe, expect } from "vitest";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";

import { superviseForever } from "./StreamSupervision.ts";

describe("superviseForever", () => {
  it.effect("restarts a failed worker after the initial backoff", () =>
    Effect.gen(function* () {
      let runs = 0;
      const firstFailed = yield* Deferred.make<void>();
      const secondStarted = yield* Deferred.make<void>();

      const fiber = yield* Effect.forkChild(
        superviseForever(
          { site: "test.restart", initialBackoff: "5 seconds" },
          Effect.gen(function* () {
            runs += 1;
            if (runs === 1) {
              yield* Deferred.succeed(firstFailed, undefined);
              return yield* Effect.fail("boom");
            }
            yield* Deferred.succeed(secondStarted, undefined);
            return yield* Effect.never;
          }),
        ),
      );

      yield* Deferred.await(firstFailed);
      yield* TestClock.adjust(Duration.millis(4999));
      expect(runs).toBe(1);
      yield* TestClock.adjust(Duration.millis(1));
      yield* Deferred.await(secondStarted);

      yield* Fiber.interrupt(fiber);
      expect(runs).toBe(2);
    }),
  );

  it.effect("backs off exponentially between restarts up to the cap", () =>
    Effect.gen(function* () {
      let runs = 0;
      const advance = (millis: number) =>
        TestClock.adjust(Duration.millis(millis)).pipe(Effect.andThen(Effect.yieldNow));

      const fiber = yield* Effect.forkChild(
        superviseForever(
          {
            site: "test.backoff",
            initialBackoff: "1 seconds",
            backoffFactor: 2,
            maxBackoff: "3 seconds",
          },
          Effect.gen(function* () {
            runs += 1;
            return yield* Effect.fail("boom");
          }),
        ),
      );
      yield* Effect.yieldNow;

      expect(runs).toBe(1);
      yield* advance(999);
      expect(runs).toBe(1);
      yield* advance(1);
      expect(runs).toBe(2);
      yield* advance(1999);
      expect(runs).toBe(2);
      yield* advance(1);
      expect(runs).toBe(3);
      yield* advance(2999);
      expect(runs).toBe(3);
      yield* advance(1);
      expect(runs).toBe(4);
      yield* advance(3000);
      expect(runs).toBe(5);

      yield* Fiber.interrupt(fiber);
    }),
  );

  it.effect("stops when the worker succeeds unless restartOnSuccess is set", () =>
    Effect.gen(function* () {
      let stoppingRuns = 0;
      const stopping = yield* Effect.forkChild(
        superviseForever(
          { site: "test.stops", initialBackoff: "1 seconds" },
          Effect.sync(() => {
            stoppingRuns += 1;
          }),
        ),
      );
      const stoppingExit = yield* Fiber.await(stopping);
      expect(stoppingRuns).toBe(1);
      yield* TestClock.adjust(Duration.seconds(10));
      expect(stoppingRuns).toBe(1);
      expect(stoppingExit._tag).toBe("Failure");

      let restartingRuns = 0;
      const restarting = yield* Effect.forkChild(
        superviseForever(
          {
            site: "test.restarts",
            initialBackoff: "2 seconds",
            restartOnSuccess: true,
          },
          Effect.sync(() => {
            restartingRuns += 1;
          }),
        ),
      );
      yield* Effect.yieldNow;
      expect(restartingRuns).toBe(1);
      yield* TestClock.adjust(Duration.millis(1999));
      expect(restartingRuns).toBe(1);
      yield* TestClock.adjust(Duration.millis(1)).pipe(Effect.andThen(Effect.yieldNow));
      expect(restartingRuns).toBe(2);

      yield* Fiber.interrupt(restarting);
    }),
  );

  it.effect("does not resurrect an interrupted worker", () =>
    Effect.gen(function* () {
      let runs = 0;
      const started = yield* Deferred.make<void>();
      const fiber = yield* Effect.forkChild(
        superviseForever(
          { site: "test.interrupt", initialBackoff: "1 millis" },
          Effect.gen(function* () {
            runs += 1;
            yield* Deferred.succeed(started, undefined);
            return yield* Effect.never;
          }),
        ),
      );

      yield* Deferred.await(started);
      yield* Fiber.interrupt(fiber);

      const exit = yield* Fiber.await(fiber);
      expect(exit._tag).toBe("Failure");
      expect(runs).toBe(1);
    }),
  );
});
