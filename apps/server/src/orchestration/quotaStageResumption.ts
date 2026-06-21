import type { OrchestrationQuotaBlockedStage, ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import {
  ProjectionQuotaBlockedStageRepository,
  type ProjectionQuotaBlockedStageRepositoryShape,
} from "../persistence/Services/ProjectionQuotaBlockedStages.ts";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "./Services/OrchestrationEngine.ts";
import {
  ProjectionSnapshotQuery,
  type ProjectionSnapshotQueryShape,
} from "./Services/ProjectionSnapshotQuery.ts";
import { originalStageInstructions, quotaStageResumeCommandId } from "./stageResolution.ts";

export const resumeQuotaBlockedStageWithServices = Effect.fn("resumeQuotaBlockedStageWithServices")(
  function* (input: {
    readonly stage: OrchestrationQuotaBlockedStage;
    readonly createdAt: string;
    readonly orchestrationEngine: OrchestrationEngineShape;
    readonly projectionSnapshotQuery: ProjectionSnapshotQueryShape;
  }) {
    const readModel = yield* input.projectionSnapshotQuery.getCommandReadModel();
    const task = readModel.tasks.find((entry) => entry.id === input.stage.taskId);
    if (task?.status !== "blocked-on-quota") {
      return false;
    }

    const thread = yield* input.projectionSnapshotQuery
      .getThreadDetailById(input.stage.stageThreadId)
      .pipe(Effect.map(Option.getOrNull));
    if (thread === null) {
      yield* Effect.logWarning("quota stage resumption skipped missing stage thread", {
        taskId: String(input.stage.taskId),
        stageThreadId: String(input.stage.stageThreadId),
      });
      return false;
    }
    const instructions = originalStageInstructions(thread);
    if (instructions === null) {
      yield* Effect.logWarning("quota stage resumption skipped missing original instructions", {
        taskId: String(input.stage.taskId),
        stageThreadId: String(input.stage.stageThreadId),
      });
      return false;
    }

    yield* input.orchestrationEngine.dispatch({
      type: "task.stage.start",
      commandId: quotaStageResumeCommandId(input.stage.stageThreadId, input.stage.retryCount),
      taskId: input.stage.taskId,
      role: input.stage.role,
      instructions,
      createdAt: input.createdAt,
    });
    return true;
  },
);

export const resumeQuotaBlockedStage = Effect.fn("resumeQuotaBlockedStage")(function* (input: {
  readonly stage: OrchestrationQuotaBlockedStage;
  readonly createdAt: string;
}) {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  return yield* resumeQuotaBlockedStageWithServices({
    ...input,
    orchestrationEngine,
    projectionSnapshotQuery,
  });
});

export const resumeQuotaBlockedStagesForProviderWithServices = Effect.fn(
  "resumeQuotaBlockedStagesForProviderWithServices",
)(function* (input: {
  readonly providerInstanceId: ProviderInstanceId;
  readonly createdAt: string;
  readonly orchestrationEngine: OrchestrationEngineShape;
  readonly projectionSnapshotQuery: ProjectionSnapshotQueryShape;
  readonly projectionQuotaBlockedStageRepository: ProjectionQuotaBlockedStageRepositoryShape;
}) {
  const blockedStages =
    yield* input.projectionQuotaBlockedStageRepository.listBlockedByProviderInstanceId({
      providerInstanceId: input.providerInstanceId,
    });
  yield* Effect.forEach(
    blockedStages,
    (stage) =>
      resumeQuotaBlockedStageWithServices({
        stage,
        createdAt: input.createdAt,
        orchestrationEngine: input.orchestrationEngine,
        projectionSnapshotQuery: input.projectionSnapshotQuery,
      }),
    { concurrency: 1, discard: true },
  );
});

export const resumeQuotaBlockedStagesForProvider = Effect.fn("resumeQuotaBlockedStagesForProvider")(
  function* (input: {
    readonly providerInstanceId: ProviderInstanceId;
    readonly createdAt: string;
  }) {
    const orchestrationEngine = yield* OrchestrationEngineService;
    const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
    const projectionQuotaBlockedStageRepository = yield* ProjectionQuotaBlockedStageRepository;
    yield* resumeQuotaBlockedStagesForProviderWithServices({
      ...input,
      orchestrationEngine,
      projectionSnapshotQuery,
      projectionQuotaBlockedStageRepository,
    });
  },
);
