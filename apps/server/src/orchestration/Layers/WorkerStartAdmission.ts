import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Semaphore from "effect/Semaphore";

import { ServerSettingsService } from "../../serverSettings.ts";
import {
  WorkerStartAdmission,
  type WorkerStartAdmissionShape,
} from "../Services/WorkerStartAdmission.ts";

const make = Effect.gen(function* () {
  const serverSettings = yield* ServerSettingsService;
  const settings = yield* serverSettings.getSettings;
  const semaphore = yield* Semaphore.make(settings.orchestratorDefaults.maxParallelWorkers);

  return {
    withWorkerStartPermit: (effect) => semaphore.withPermits(1)(effect),
  } satisfies WorkerStartAdmissionShape;
});

export const WorkerStartAdmissionLive = Layer.effect(WorkerStartAdmission, make);
