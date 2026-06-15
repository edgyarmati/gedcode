import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import { describe, expect, it } from "vitest";

import { ServerSettingsService } from "../../serverSettings.ts";
import { WorkerStartAdmission } from "../Services/WorkerStartAdmission.ts";
import { WorkerStartAdmissionLive } from "./WorkerStartAdmission.ts";

describe("WorkerStartAdmission", () => {
  it("caps concurrent worker starts from server settings", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const admission = yield* WorkerStartAdmission;
        const active = yield* Ref.make(0);
        const maxActive = yield* Ref.make(0);
        const firstEntered = yield* Deferred.make<void>();
        const releaseFirst = yield* Deferred.make<void>();
        const releaseSecond = yield* Deferred.make<void>();

        const run = (label: "first" | "second") =>
          admission.withWorkerStartPermit(
            Effect.gen(function* () {
              const nextActive = yield* Ref.updateAndGet(active, (value) => value + 1);
              yield* Ref.update(maxActive, (value) => Math.max(value, nextActive));
              if (label === "first") {
                yield* Deferred.succeed(firstEntered, undefined);
                yield* Deferred.await(releaseFirst);
              } else {
                yield* Deferred.await(releaseSecond);
              }
              yield* Ref.update(active, (value) => value - 1);
            }),
          );

        const first = yield* run("first").pipe(Effect.forkChild);
        yield* Deferred.await(firstEntered);
        const second = yield* run("second").pipe(Effect.forkChild);
        yield* Effect.sleep("10 millis");
        const activeWhileSecondQueued = yield* Ref.get(active);
        yield* Deferred.succeed(releaseFirst, undefined);
        yield* Effect.sleep("10 millis");
        yield* Deferred.succeed(releaseSecond, undefined);
        yield* Fiber.join(first);
        yield* Fiber.join(second);

        return {
          activeWhileSecondQueued,
          maxActive: yield* Ref.get(maxActive),
        };
      }).pipe(
        Effect.provide(
          WorkerStartAdmissionLive.pipe(
            Layer.provide(
              ServerSettingsService.layerTest({
                orchestratorDefaults: { maxParallelWorkers: 1 },
              }),
            ),
          ),
        ),
      ),
    );

    expect(result).toEqual({
      activeWhileSecondQueued: 1,
      maxActive: 1,
    });
  });
});
