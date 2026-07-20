import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  OrchestrationReactor,
  type OrchestrationReactorShape,
} from "../Services/OrchestrationReactor.ts";
import { CheckpointReactor } from "../Services/CheckpointReactor.ts";
import { OrphanTurnReconciler } from "../Services/OrphanTurnReconciler.ts";
import { PmRuntime } from "../Services/PmRuntime.ts";
import { ProviderCommandReactor } from "../Services/ProviderCommandReactor.ts";
import { ProviderRuntimeIngestionService } from "../Services/ProviderRuntimeIngestion.ts";
import { TaskWorktreeReactor } from "../Services/TaskWorktreeReactor.ts";
import { TaskCancellationReconciler } from "../Services/TaskCancellationReconciler.ts";
import { ThreadDeletionReactor } from "../Services/ThreadDeletionReactor.ts";
import { HelperRunReactor } from "../Services/HelperRunReactor.ts";
import { ProjectContextRunReactor } from "../Services/ProjectContextRunReactor.ts";

export const makeOrchestrationReactor = Effect.gen(function* () {
  const taskCancellationReconciler = yield* TaskCancellationReconciler;
  const orphanTurnReconciler = yield* OrphanTurnReconciler;
  const providerRuntimeIngestion = yield* ProviderRuntimeIngestionService;
  const providerCommandReactor = yield* ProviderCommandReactor;
  const checkpointReactor = yield* CheckpointReactor;
  const threadDeletionReactor = yield* ThreadDeletionReactor;
  const taskWorktreeReactor = yield* TaskWorktreeReactor;
  const helperRunReactor = yield* HelperRunReactor;
  const projectContextRunReactor = yield* ProjectContextRunReactor;
  const pmRuntime = yield* PmRuntime;

  const start: OrchestrationReactorShape["start"] = Effect.fn("start")(function* () {
    yield* taskCancellationReconciler.reconcile();
    yield* providerRuntimeIngestion.start();
    yield* providerCommandReactor.start();
    yield* checkpointReactor.start();
    yield* threadDeletionReactor.start();
    yield* taskWorktreeReactor.start();
    yield* helperRunReactor.start();
    yield* projectContextRunReactor.start();
    // PM startup can replay a settlement and immediately hand off a retry, so
    // provider consumers must already be subscribed before the PM starts.
    yield* pmRuntime.start();
    // Emit orphan-stage settlements only after the PM subscription is live.
    yield* orphanTurnReconciler.reconcile();
  });

  return {
    start,
  } satisfies OrchestrationReactorShape;
});

export const OrchestrationReactorLive = Layer.effect(
  OrchestrationReactor,
  makeOrchestrationReactor,
);
