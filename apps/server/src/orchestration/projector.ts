import type {
  OrchestrationEvent,
  OrchestrationPendingGate,
  OrchestrationProject,
  OrchestrationProjectContextRun,
  OrchestrationReadModel,
  OrchestrationTask,
  OrchestrationHelperRun,
  OrchestrationStageHistory,
  TaskId,
  ThreadId,
} from "@t3tools/contracts";
import {
  NullablePmModelSelection,
  OrchestrationCheckpointSummary,
  OrchestrationMessage,
  OrchestrationSession,
  OrchestrationThread,
  TaskAbandonedPayload,
  TaskArchivedPayload,
  TaskCancellationFailedPayload,
  TaskCancellationPhaseCompletedPayload,
  TaskCancellationRequestedPayload,
  TaskChangeReviewRequestedPayload,
  TaskChangeReviewResolvedPayload,
  TaskClassifiedPayload,
  TaskCreatedPayload,
  TaskDeletedPayload,
  TaskGateRequestedPayload,
  TaskGateResolvedPayload,
  TaskLandedPayload,
  TaskNoChangesNeededPayload,
  TaskPrOpenFailedPayload,
  TaskPrOpenedPayload,
  TaskReleaseDispatchFailedPayload,
  TaskReleaseDispatchRequestedPayload,
  TaskReleaseDispatchedPayload,
  TaskCapabilityTiersUpdatedPayload,
  TaskRestoredPayload,
  TaskStageBlockedPayload,
  TaskStageCompletedPayload,
  TaskStageInterruptedPayload,
  TaskStageStartedPayload,
  TaskSplitPayload,
  TaskVerificationRecordedPayload,
  ProjectContextCompletedPayload,
  ProjectContextDismissedPayload,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { toProjectorDecodeError, type OrchestrationProjectorDecodeError } from "./Errors.ts";
import { resolveStageModelSelection, taskStatusForStageRole } from "./stageModelSelection.ts";
import {
  MessageSentPayloadSchema,
  ProjectCreatedPayload,
  ProjectDeletedPayload,
  ProjectMetaUpdatedPayload,
  ThreadActivityAppendedPayload,
  ThreadArchivedPayload,
  ThreadClearedPayload,
  ThreadCreatedPayload,
  ThreadDeletedPayload,
  ThreadInteractionModeSetPayload,
  ThreadMetaUpdatedPayload,
  ThreadPmHandoffCompletedPayload,
  ThreadPmHandoffRequestedPayload,
  ThreadProposedPlanUpsertedPayload,
  ThreadRuntimeModeSetPayload,
  ThreadUnarchivedPayload,
  ThreadRevertedPayload,
  ThreadSessionSetPayload,
  ThreadTurnDiffCompletedPayload,
} from "./Schemas.ts";

type ThreadPatch = Partial<Omit<OrchestrationThread, "id" | "projectId">>;
type TaskPatch = Partial<Omit<OrchestrationTask, "id" | "projectId">>;
type HelperRunPatch = Partial<Omit<OrchestrationHelperRun, "id" | "projectId">>;
type ProjectContextRunPatch = Partial<Omit<OrchestrationProjectContextRun, "id" | "projectId">>;
type PendingGatePatch = Partial<Omit<OrchestrationPendingGate, "gateId" | "taskId">>;
type ProjectOrchestratorConfig = NonNullable<OrchestrationProject["orchestratorConfig"]>;
const MAX_THREAD_MESSAGES = 2_000;
const MAX_THREAD_CHECKPOINTS = 500;

function checkpointStatusToLatestTurnState(status: "ready" | "missing" | "error") {
  if (status === "error") return "error" as const;
  if (status === "missing") return "interrupted" as const;
  return "completed" as const;
}

function settledTurnStateForSessionStatus(
  status: OrchestrationSession["status"],
): "completed" | "interrupted" | "error" | null {
  switch (status) {
    case "idle":
    case "ready":
      return "completed";
    case "error":
      return "error";
    case "interrupted":
    case "stopped":
      return "interrupted";
    case "starting":
    case "running":
      return null;
  }
}

function updateThread(
  threads: ReadonlyArray<OrchestrationThread>,
  threadId: ThreadId,
  patch: ThreadPatch,
): OrchestrationThread[] {
  return threads.map((thread) => (thread.id === threadId ? { ...thread, ...patch } : thread));
}

function updateTask(
  tasks: ReadonlyArray<OrchestrationTask>,
  taskId: TaskId,
  patch: TaskPatch,
): OrchestrationTask[] {
  return withAggregateTaskProgress(
    tasks.map((task) => (task.id === taskId ? { ...task, ...patch } : task)),
  );
}

function updateHelperRun(
  helperRuns: ReadonlyArray<OrchestrationHelperRun>,
  helperRunId: OrchestrationHelperRun["id"],
  patch: HelperRunPatch,
): OrchestrationHelperRun[] {
  return helperRuns.map((run) => (run.id === helperRunId ? { ...run, ...patch } : run));
}

function updateProjectContextRun(
  runs: ReadonlyArray<OrchestrationProjectContextRun>,
  runId: OrchestrationProjectContextRun["id"],
  patch: ProjectContextRunPatch,
): OrchestrationProjectContextRun[] {
  return runs.map((run) => (run.id === runId ? { ...run, ...patch } : run));
}

function withAggregateTaskProgress(tasks: ReadonlyArray<OrchestrationTask>): OrchestrationTask[] {
  const progressByParent = new Map<
    TaskId,
    { total: number; terminal: number; landed: number; abandoned: number }
  >();
  for (const child of tasks) {
    if (child.parentTaskId === undefined || child.parentTaskId === null) continue;
    const progress = progressByParent.get(child.parentTaskId) ?? {
      total: 0,
      terminal: 0,
      landed: 0,
      abandoned: 0,
    };
    progress.total += 1;
    if (
      child.status === "landed" ||
      child.status === "no-changes-needed" ||
      child.status === "abandoned"
    )
      progress.terminal += 1;
    if (child.status === "landed") progress.landed += 1;
    if (child.status === "abandoned") progress.abandoned += 1;
    progressByParent.set(child.parentTaskId, progress);
  }
  return tasks.map((task) => {
    const aggregateProgress = progressByParent.get(task.id);
    if (aggregateProgress === undefined) return task;
    return {
      ...task,
      aggregateProgress,
    };
  });
}

function updatePendingGate(
  pendingGates: ReadonlyArray<OrchestrationPendingGate>,
  gateId: OrchestrationPendingGate["gateId"],
  patch: PendingGatePatch,
): OrchestrationPendingGate[] {
  return pendingGates.map((gate) => (gate.gateId === gateId ? { ...gate, ...patch } : gate));
}

function decodeForEvent<A>(
  schema: Schema.Decoder<A, never>,
  value: unknown,
  eventType: OrchestrationEvent["type"],
  field: string,
): Effect.Effect<A, OrchestrationProjectorDecodeError> {
  return Schema.decodeUnknownEffect(schema)(value).pipe(
    Effect.mapError(toProjectorDecodeError(`${eventType}:${field}`)),
  );
}

const normalizeOrchestratorConfigForEvent = (
  value: ProjectOrchestratorConfig,
  eventType: OrchestrationEvent["type"],
): Effect.Effect<ProjectOrchestratorConfig, OrchestrationProjectorDecodeError> => {
  const next = { ...value };
  if (!Object.hasOwn(next, "pmModelSelection")) {
    return Effect.succeed(next);
  }

  return decodeForEvent(
    NullablePmModelSelection,
    next.pmModelSelection,
    eventType,
    "payload.orchestratorConfig.pmModelSelection",
  ).pipe(Effect.map((pmModelSelection) => ({ ...next, pmModelSelection })));
};

function retainThreadMessagesAfterRevert(
  messages: ReadonlyArray<OrchestrationMessage>,
  retainedTurnIds: ReadonlySet<string>,
  turnCount: number,
): ReadonlyArray<OrchestrationMessage> {
  const retainedMessageIds = new Set<string>();
  for (const message of messages) {
    if (message.role === "system") {
      retainedMessageIds.add(message.id);
      continue;
    }
    if (message.turnId !== null && retainedTurnIds.has(message.turnId)) {
      retainedMessageIds.add(message.id);
    }
  }

  const retainedUserCount = messages.filter(
    (message) => message.role === "user" && retainedMessageIds.has(message.id),
  ).length;
  const missingUserCount = Math.max(0, turnCount - retainedUserCount);
  if (missingUserCount > 0) {
    const fallbackUserMessages = messages
      .filter(
        (message) =>
          message.role === "user" &&
          !retainedMessageIds.has(message.id) &&
          (message.turnId === null || retainedTurnIds.has(message.turnId)),
      )
      .toSorted(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
      )
      .slice(0, missingUserCount);
    for (const message of fallbackUserMessages) {
      retainedMessageIds.add(message.id);
    }
  }

  const retainedAssistantCount = messages.filter(
    (message) => message.role === "assistant" && retainedMessageIds.has(message.id),
  ).length;
  const missingAssistantCount = Math.max(0, turnCount - retainedAssistantCount);
  if (missingAssistantCount > 0) {
    const fallbackAssistantMessages = messages
      .filter(
        (message) =>
          message.role === "assistant" &&
          !retainedMessageIds.has(message.id) &&
          (message.turnId === null || retainedTurnIds.has(message.turnId)),
      )
      .toSorted(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
      )
      .slice(0, missingAssistantCount);
    for (const message of fallbackAssistantMessages) {
      retainedMessageIds.add(message.id);
    }
  }

  return messages.filter((message) => retainedMessageIds.has(message.id));
}

function retainThreadActivitiesAfterRevert(
  activities: ReadonlyArray<OrchestrationThread["activities"][number]>,
  retainedTurnIds: ReadonlySet<string>,
): ReadonlyArray<OrchestrationThread["activities"][number]> {
  return activities.filter(
    (activity) => activity.turnId === null || retainedTurnIds.has(activity.turnId),
  );
}

function retainThreadProposedPlansAfterRevert(
  proposedPlans: ReadonlyArray<OrchestrationThread["proposedPlans"][number]>,
  retainedTurnIds: ReadonlySet<string>,
): ReadonlyArray<OrchestrationThread["proposedPlans"][number]> {
  return proposedPlans.filter(
    (proposedPlan) => proposedPlan.turnId === null || retainedTurnIds.has(proposedPlan.turnId),
  );
}

function compareThreadActivities(
  left: OrchestrationThread["activities"][number],
  right: OrchestrationThread["activities"][number],
): number {
  if (left.sequence !== undefined && right.sequence !== undefined) {
    if (left.sequence !== right.sequence) {
      return left.sequence - right.sequence;
    }
  } else if (left.sequence !== undefined) {
    return 1;
  } else if (right.sequence !== undefined) {
    return -1;
  }

  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

export function createEmptyReadModel(nowIso: string): OrchestrationReadModel {
  return {
    snapshotSequence: 0,
    projects: [],
    threads: [],
    tasks: [],
    helperRuns: [],
    projectContextRuns: [],
    pendingGates: [],
    quotaBlockedStages: [],
    stageHistory: {},
    updatedAt: nowIso,
  };
}

export function projectEvent(
  model: OrchestrationReadModel,
  event: OrchestrationEvent,
): Effect.Effect<OrchestrationReadModel, OrchestrationProjectorDecodeError> {
  const nextBase: OrchestrationReadModel = {
    ...model,
    snapshotSequence: event.sequence,
    updatedAt: event.occurredAt,
  };

  switch (event.type) {
    case "project.context-run-requested":
      return Effect.succeed({
        ...nextBase,
        projectContextRuns: [
          ...nextBase.projectContextRuns.filter(
            (run) => run.id !== event.payload.projectContextRunId,
          ),
          {
            id: event.payload.projectContextRunId,
            projectId: event.payload.projectId,
            mode: event.payload.mode,
            tier: event.payload.tier,
            providerInstanceId: event.payload.providerInstanceId,
            model: event.payload.model,
            modelOptions: event.payload.modelOptions,
            primaryCheckoutPath: event.payload.primaryCheckoutPath,
            schemaVersion: event.payload.schemaVersion,
            fingerprint: event.payload.fingerprint,
            prompt: event.payload.prompt,
            baselineManifest: event.payload.baselineManifest,
            workspaceStatusManifest: event.payload.workspaceStatusManifest,
            gitState: event.payload.gitState,
            status: "pending",
            pmStartState: event.payload.pmStartState,
            providerThreadId: null,
            result: null,
            failureMessage: null,
            changes: [],
            scopeViolationPaths: [],
            resolution: null,
            commitHash: null,
            resultSchemaVersion: null,
            resultFingerprint: null,
            createdAt: event.payload.createdAt,
            startedAt: null,
            pendingReviewAt: null,
            failedAt: null,
            interruptedAt: null,
            resolvedAt: null,
            updatedAt: event.payload.updatedAt,
          },
        ],
      });

    case "project.context-run-start-prepared":
      return Effect.succeed({
        ...nextBase,
        projectContextRuns: updateProjectContextRun(
          nextBase.projectContextRuns,
          event.payload.projectContextRunId,
          {
            pmStartState: event.payload.pmStartState,
            updatedAt: event.payload.updatedAt,
          },
        ),
      });

    case "project.context-run-baseline-refreshed":
      return Effect.succeed({
        ...nextBase,
        projectContextRuns: updateProjectContextRun(
          nextBase.projectContextRuns,
          event.payload.projectContextRunId,
          {
            schemaVersion: event.payload.schemaVersion,
            fingerprint: event.payload.fingerprint,
            baselineManifest: event.payload.baselineManifest,
            workspaceStatusManifest: event.payload.workspaceStatusManifest,
            gitState: event.payload.gitState,
            pmStartState: "ready",
            updatedAt: event.payload.updatedAt,
          },
        ),
      });

    case "project.context-run-started":
      return Effect.succeed({
        ...nextBase,
        projectContextRuns: updateProjectContextRun(
          nextBase.projectContextRuns,
          event.payload.projectContextRunId,
          {
            status: "running",
            providerThreadId: event.payload.providerThreadId,
            startedAt: event.payload.startedAt,
            updatedAt: event.payload.updatedAt,
          },
        ),
      });

    case "project.context-run-pending-review":
      return Effect.succeed({
        ...nextBase,
        projectContextRuns: updateProjectContextRun(
          nextBase.projectContextRuns,
          event.payload.projectContextRunId,
          {
            status: "pending-review",
            result: event.payload.result,
            failureMessage: null,
            changes: event.payload.changes,
            scopeViolationPaths: event.payload.scopeViolationPaths,
            pendingReviewAt: event.payload.pendingReviewAt,
            updatedAt: event.payload.updatedAt,
          },
        ),
      });

    case "project.context-run-revised":
      return Effect.succeed({
        ...nextBase,
        projectContextRuns: updateProjectContextRun(
          nextBase.projectContextRuns,
          event.payload.projectContextRunId,
          {
            status: "pending",
            prompt: event.payload.prompt,
            providerThreadId: null,
            result: null,
            failureMessage: null,
            changes: [],
            scopeViolationPaths: [],
            resolution: null,
            commitHash: null,
            resultSchemaVersion: null,
            resultFingerprint: null,
            startedAt: null,
            pendingReviewAt: null,
            failedAt: null,
            interruptedAt: null,
            resolvedAt: null,
            updatedAt: event.payload.updatedAt,
          },
        ),
      });

    case "project.context-run-committed":
      return Effect.succeed({
        ...nextBase,
        projectContextRuns: updateProjectContextRun(
          nextBase.projectContextRuns,
          event.payload.projectContextRunId,
          {
            status: "completed",
            resolution: "committed",
            commitHash: event.payload.commitHash,
            resultSchemaVersion: event.payload.resultSchemaVersion,
            resultFingerprint: event.payload.resultFingerprint,
            resolvedAt: event.payload.resolvedAt,
            updatedAt: event.payload.updatedAt,
          },
        ),
      });

    case "project.context-run-applied":
      return Effect.succeed({
        ...nextBase,
        projectContextRuns: updateProjectContextRun(
          nextBase.projectContextRuns,
          event.payload.projectContextRunId,
          {
            status: "completed",
            result: event.payload.result,
            changes: event.payload.changes,
            scopeViolationPaths: [],
            resolution: "applied",
            commitHash: null,
            resultSchemaVersion: event.payload.resultSchemaVersion,
            resultFingerprint: event.payload.resultFingerprint,
            resolvedAt: event.payload.resolvedAt,
            updatedAt: event.payload.updatedAt,
          },
        ),
      });

    case "project.context-run-discarded":
      return Effect.succeed({
        ...nextBase,
        projectContextRuns: updateProjectContextRun(
          nextBase.projectContextRuns,
          event.payload.projectContextRunId,
          {
            status: "discarded",
            resolution: "discarded",
            commitHash: null,
            resultSchemaVersion: event.payload.resultSchemaVersion,
            resultFingerprint: event.payload.resultFingerprint,
            resolvedAt: event.payload.resolvedAt,
            updatedAt: event.payload.updatedAt,
          },
        ),
      });

    case "project.context-run-failed":
      return Effect.succeed({
        ...nextBase,
        projectContextRuns: updateProjectContextRun(
          nextBase.projectContextRuns,
          event.payload.projectContextRunId,
          {
            status: "failed",
            failureMessage: event.payload.message,
            failedAt: event.payload.failedAt,
            updatedAt: event.payload.updatedAt,
          },
        ),
      });

    case "project.context-run-interrupted":
      return Effect.succeed({
        ...nextBase,
        projectContextRuns: updateProjectContextRun(
          nextBase.projectContextRuns,
          event.payload.projectContextRunId,
          {
            status: "interrupted",
            interruptedAt: event.payload.interruptedAt,
            updatedAt: event.payload.updatedAt,
          },
        ),
      });

    case "helper.run-requested":
      return Effect.succeed({
        ...nextBase,
        helperRuns: [
          ...(nextBase.helperRuns ?? []).filter((run) => run.id !== event.payload.helperRunId),
          {
            id: event.payload.helperRunId,
            projectId: event.payload.projectId,
            attachment: event.payload.attachment,
            accessMode: event.payload.accessMode,
            tier: event.payload.tier,
            providerInstanceId: event.payload.providerInstanceId,
            model: event.payload.model,
            modelOptions: event.payload.modelOptions,
            prompt: event.payload.prompt,
            status: "pending",
            providerThreadId: null,
            result: null,
            failureMessage: null,
            createdAt: event.payload.createdAt,
            startedAt: null,
            completedAt: null,
            updatedAt: event.payload.updatedAt,
          },
        ],
      });

    case "helper.run-started":
      return Effect.succeed({
        ...nextBase,
        helperRuns: updateHelperRun(nextBase.helperRuns ?? [], event.payload.helperRunId, {
          status: "running",
          providerThreadId: event.payload.providerThreadId,
          startedAt: event.payload.startedAt,
          updatedAt: event.payload.updatedAt,
        }),
      });

    case "helper.run-completed":
      return Effect.succeed({
        ...nextBase,
        helperRuns: updateHelperRun(nextBase.helperRuns ?? [], event.payload.helperRunId, {
          status: "completed",
          result: event.payload.result,
          failureMessage: null,
          completedAt: event.payload.completedAt,
          updatedAt: event.payload.updatedAt,
        }),
      });

    case "helper.run-failed":
      return Effect.succeed({
        ...nextBase,
        helperRuns: updateHelperRun(nextBase.helperRuns ?? [], event.payload.helperRunId, {
          status: "failed",
          failureMessage: event.payload.message,
          completedAt: event.payload.failedAt,
          updatedAt: event.payload.updatedAt,
        }),
      });

    case "helper.run-interrupted":
      return Effect.succeed({
        ...nextBase,
        helperRuns: updateHelperRun(nextBase.helperRuns ?? [], event.payload.helperRunId, {
          status: "interrupted",
          completedAt: event.payload.interruptedAt,
          updatedAt: event.payload.updatedAt,
        }),
      });

    case "project.created":
      return decodeForEvent(ProjectCreatedPayload, event.payload, event.type, "payload").pipe(
        Effect.flatMap((payload) =>
          Effect.map(
            payload.orchestratorConfig === undefined
              ? Effect.succeed({} as ProjectOrchestratorConfig)
              : normalizeOrchestratorConfigForEvent(payload.orchestratorConfig, event.type),
            (orchestratorConfig) => ({ payload, orchestratorConfig }),
          ),
        ),
        Effect.map(({ payload, orchestratorConfig }) => {
          const existing = nextBase.projects.find((entry) => entry.id === payload.projectId);
          const nextProject = {
            id: payload.projectId,
            title: payload.title,
            workspaceRoot: payload.workspaceRoot,
            defaultModelSelection: payload.defaultModelSelection,
            roleModelSelections: payload.roleModelSelections ?? {},
            rolePromptPrefixes: payload.rolePromptPrefixes ?? {},
            orchestratorConfig,
            projectContextResolution: null,
            scripts: payload.scripts,
            createdAt: payload.createdAt,
            updatedAt: payload.updatedAt,
            deletedAt: null,
          };

          return {
            ...nextBase,
            projects: existing
              ? nextBase.projects.map((entry) =>
                  entry.id === payload.projectId ? nextProject : entry,
                )
              : [...nextBase.projects, nextProject],
          };
        }),
      );

    case "project.meta-updated":
      return decodeForEvent(ProjectMetaUpdatedPayload, event.payload, event.type, "payload").pipe(
        Effect.flatMap((payload) =>
          Effect.map(
            payload.orchestratorConfig === undefined
              ? Effect.void
              : normalizeOrchestratorConfigForEvent(payload.orchestratorConfig, event.type),
            (orchestratorConfig) => ({ payload, orchestratorConfig }),
          ),
        ),
        Effect.map(({ payload, orchestratorConfig }) => ({
          ...nextBase,
          projects: nextBase.projects.map((project) =>
            project.id === payload.projectId
              ? {
                  ...project,
                  ...(payload.title !== undefined ? { title: payload.title } : {}),
                  ...(payload.workspaceRoot !== undefined
                    ? { workspaceRoot: payload.workspaceRoot }
                    : {}),
                  ...(payload.defaultModelSelection !== undefined
                    ? { defaultModelSelection: payload.defaultModelSelection }
                    : {}),
                  ...(payload.roleModelSelections !== undefined
                    ? { roleModelSelections: payload.roleModelSelections }
                    : {}),
                  ...(payload.rolePromptPrefixes !== undefined
                    ? { rolePromptPrefixes: payload.rolePromptPrefixes }
                    : {}),
                  ...(orchestratorConfig !== undefined ? { orchestratorConfig } : {}),
                  ...(payload.scripts !== undefined ? { scripts: payload.scripts } : {}),
                  updatedAt: payload.updatedAt,
                }
              : project,
          ),
        })),
      );

    case "project.context-dismissed":
      return decodeForEvent(
        ProjectContextDismissedPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => ({
          ...nextBase,
          projects: nextBase.projects.map((project) =>
            project.id === payload.projectId
              ? {
                  ...project,
                  projectContextResolution: {
                    schemaVersion: payload.schemaVersion,
                    fingerprint: payload.fingerprint,
                    outcome: "dismissed",
                    resolvedAt: payload.dismissedAt,
                  },
                  updatedAt: payload.dismissedAt,
                }
              : project,
          ),
        })),
      );

    case "project.context-completed":
      return decodeForEvent(
        ProjectContextCompletedPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => ({
          ...nextBase,
          projects: nextBase.projects.map((project) =>
            project.id === payload.projectId
              ? {
                  ...project,
                  projectContextResolution: {
                    schemaVersion: payload.schemaVersion,
                    fingerprint: payload.fingerprint,
                    outcome: "completed",
                    resolvedAt: payload.completedAt,
                  },
                  updatedAt: payload.completedAt,
                }
              : project,
          ),
        })),
      );

    case "project.deleted":
      return decodeForEvent(ProjectDeletedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          projects: nextBase.projects.map((project) =>
            project.id === payload.projectId
              ? {
                  ...project,
                  deletedAt: payload.deletedAt,
                  updatedAt: payload.deletedAt,
                }
              : project,
          ),
        })),
      );

    case "thread.created":
      return Effect.gen(function* () {
        const payload = yield* decodeForEvent(
          ThreadCreatedPayload,
          event.payload,
          event.type,
          "payload",
        );
        const thread: OrchestrationThread = yield* decodeForEvent(
          OrchestrationThread,
          {
            id: payload.threadId,
            projectId: payload.projectId,
            title: payload.title,
            modelSelection: payload.modelSelection,
            gedWorkflowEnabled: payload.gedWorkflowEnabled ?? true,
            runtimeMode: payload.runtimeMode,
            interactionMode: payload.interactionMode,
            branch: payload.branch,
            worktreePath: payload.worktreePath,
            latestTurn: null,
            createdAt: payload.createdAt,
            updatedAt: payload.updatedAt,
            archivedAt: null,
            deletedAt: null,
            pendingPmHandoff: null,
            messages: [],
            activities: [],
            checkpoints: [],
            session: null,
          },
          event.type,
          "thread",
        );
        const existing = nextBase.threads.find((entry) => entry.id === thread.id);
        const stage = nextBase.stageHistory[thread.id];
        return {
          ...nextBase,
          threads: existing
            ? nextBase.threads.map((entry) => (entry.id === thread.id ? thread : entry))
            : [...nextBase.threads, thread],
          stageHistory:
            stage === undefined
              ? nextBase.stageHistory
              : {
                  ...nextBase.stageHistory,
                  [thread.id]: { ...stage, runtimeMode: payload.runtimeMode },
                },
        };
      });

    case "thread.deleted":
      return decodeForEvent(ThreadDeletedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            deletedAt: payload.deletedAt,
            updatedAt: payload.deletedAt,
          }),
        })),
      );

    case "thread.archived":
      return decodeForEvent(ThreadArchivedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            archivedAt: payload.archivedAt,
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "thread.unarchived":
      return decodeForEvent(ThreadUnarchivedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            archivedAt: null,
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "thread.meta-updated":
      return decodeForEvent(ThreadMetaUpdatedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            ...(payload.title !== undefined ? { title: payload.title } : {}),
            ...(payload.modelSelection !== undefined
              ? { modelSelection: payload.modelSelection }
              : {}),
            ...(payload.gedWorkflowEnabled !== undefined
              ? { gedWorkflowEnabled: payload.gedWorkflowEnabled }
              : {}),
            ...(payload.branch !== undefined ? { branch: payload.branch } : {}),
            ...(payload.worktreePath !== undefined ? { worktreePath: payload.worktreePath } : {}),
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "thread.runtime-mode-set":
      return decodeForEvent(ThreadRuntimeModeSetPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            runtimeMode: payload.runtimeMode,
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "thread.interaction-mode-set":
      return decodeForEvent(
        ThreadInteractionModeSetPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => ({
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            interactionMode: payload.interactionMode,
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "thread.message-sent":
      return Effect.gen(function* () {
        const payload = yield* decodeForEvent(
          MessageSentPayloadSchema,
          event.payload,
          event.type,
          "payload",
        );
        const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
        if (!thread) {
          return nextBase;
        }

        const message: OrchestrationMessage = yield* decodeForEvent(
          OrchestrationMessage,
          {
            id: payload.messageId,
            role: payload.role,
            text: payload.text,
            ...(payload.attachments !== undefined ? { attachments: payload.attachments } : {}),
            turnId: payload.turnId,
            streaming: payload.streaming,
            createdAt: payload.createdAt,
            updatedAt: payload.updatedAt,
          },
          event.type,
          "message",
        );

        const existingMessage = thread.messages.find((entry) => entry.id === message.id);
        const messages = existingMessage
          ? thread.messages.map((entry) =>
              entry.id === message.id
                ? {
                    ...entry,
                    text: message.streaming
                      ? `${entry.text}${message.text}`
                      : message.text.length > 0
                        ? message.text
                        : entry.text,
                    streaming: message.streaming,
                    updatedAt: message.updatedAt,
                    turnId: message.turnId,
                    ...(message.attachments !== undefined
                      ? { attachments: message.attachments }
                      : {}),
                  }
                : entry,
            )
          : [...thread.messages, message];
        const cappedMessages = messages.slice(-MAX_THREAD_MESSAGES);

        return {
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            messages: cappedMessages,
            updatedAt: event.occurredAt,
          }),
        };
      });

    case "thread.cleared":
      return decodeForEvent(ThreadClearedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => {
          const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
          if (!thread) {
            return nextBase;
          }

          return {
            ...nextBase,
            threads: updateThread(nextBase.threads, payload.threadId, {
              messages: [],
              activities: [],
              proposedPlans: [],
              checkpoints: [],
              latestTurn: null,
              session: null,
              lastClearedSequence: event.sequence,
              pendingPmHandoff: null,
              updatedAt: payload.clearedAt,
            }),
          };
        }),
      );

    case "thread.pm-handoff-requested":
      return decodeForEvent(
        ThreadPmHandoffRequestedPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => ({
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            pendingPmHandoff: {
              mode: payload.mode,
              ...(payload.brief !== undefined ? { brief: payload.brief } : {}),
              requestedAt: payload.createdAt,
            },
            updatedAt: payload.createdAt,
          }),
        })),
      );

    case "thread.pm-handoff-completed":
      return decodeForEvent(
        ThreadPmHandoffCompletedPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => ({
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            pendingPmHandoff: null,
            updatedAt: payload.createdAt,
          }),
        })),
      );

    case "thread.session-set":
      return Effect.gen(function* () {
        const payload = yield* decodeForEvent(
          ThreadSessionSetPayload,
          event.payload,
          event.type,
          "payload",
        );
        const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
        if (!thread) {
          return nextBase;
        }

        const session: OrchestrationSession = yield* decodeForEvent(
          OrchestrationSession,
          payload.session,
          event.type,
          "session",
        );
        const settledTurnState = settledTurnStateForSessionStatus(session.status);

        return {
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            session,
            latestTurn:
              session.status === "running" && session.activeTurnId !== null
                ? {
                    turnId: session.activeTurnId,
                    state: "running",
                    requestedAt:
                      thread.latestTurn?.turnId === session.activeTurnId
                        ? thread.latestTurn.requestedAt
                        : session.updatedAt,
                    startedAt:
                      thread.latestTurn?.turnId === session.activeTurnId
                        ? (thread.latestTurn.startedAt ?? session.updatedAt)
                        : session.updatedAt,
                    completedAt: null,
                    assistantMessageId:
                      thread.latestTurn?.turnId === session.activeTurnId
                        ? thread.latestTurn.assistantMessageId
                        : null,
                  }
                : thread.latestTurn !== null &&
                    thread.latestTurn.state === "running" &&
                    settledTurnState !== null
                  ? {
                      ...thread.latestTurn,
                      state: settledTurnState,
                      completedAt: session.updatedAt,
                    }
                  : thread.latestTurn,
            updatedAt: event.occurredAt,
          }),
        };
      });

    case "thread.proposed-plan-upserted":
      return Effect.gen(function* () {
        const payload = yield* decodeForEvent(
          ThreadProposedPlanUpsertedPayload,
          event.payload,
          event.type,
          "payload",
        );
        const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
        if (!thread) {
          return nextBase;
        }

        const proposedPlans = [
          ...thread.proposedPlans.filter((entry) => entry.id !== payload.proposedPlan.id),
          payload.proposedPlan,
        ]
          .toSorted(
            (left, right) =>
              left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
          )
          .slice(-200);

        return {
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            proposedPlans,
            updatedAt: event.occurredAt,
          }),
        };
      });

    case "thread.turn-diff-completed":
      return Effect.gen(function* () {
        const payload = yield* decodeForEvent(
          ThreadTurnDiffCompletedPayload,
          event.payload,
          event.type,
          "payload",
        );
        const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
        if (!thread) {
          return nextBase;
        }

        const checkpoint = yield* decodeForEvent(
          OrchestrationCheckpointSummary,
          {
            turnId: payload.turnId,
            checkpointTurnCount: payload.checkpointTurnCount,
            checkpointRef: payload.checkpointRef,
            status: payload.status,
            files: payload.files,
            assistantMessageId: payload.assistantMessageId,
            completedAt: payload.completedAt,
          },
          event.type,
          "checkpoint",
        );

        // Do not let a placeholder (status "missing") overwrite a checkpoint
        // that has already been captured with a real git ref (status "ready").
        // ProviderRuntimeIngestion may fire multiple turn.diff.updated events
        // per turn; without this guard later placeholders would clobber the
        // real capture dispatched by CheckpointReactor.
        const existing = thread.checkpoints.find((entry) => entry.turnId === checkpoint.turnId);
        if (existing && existing.status !== "missing" && checkpoint.status === "missing") {
          return nextBase;
        }

        const checkpoints = [
          ...thread.checkpoints.filter((entry) => entry.turnId !== checkpoint.turnId),
          checkpoint,
        ]
          .toSorted((left, right) => left.checkpointTurnCount - right.checkpointTurnCount)
          .slice(-MAX_THREAD_CHECKPOINTS);
        const turnStillRunning =
          thread.session?.status === "running" && thread.session.activeTurnId === payload.turnId;

        return {
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            checkpoints,
            latestTurn: turnStillRunning
              ? thread.latestTurn
              : {
                  turnId: payload.turnId,
                  state: checkpointStatusToLatestTurnState(payload.status),
                  requestedAt:
                    thread.latestTurn?.turnId === payload.turnId
                      ? thread.latestTurn.requestedAt
                      : payload.completedAt,
                  startedAt:
                    thread.latestTurn?.turnId === payload.turnId
                      ? (thread.latestTurn.startedAt ?? payload.completedAt)
                      : payload.completedAt,
                  completedAt: payload.completedAt,
                  assistantMessageId: payload.assistantMessageId,
                },
            updatedAt: event.occurredAt,
          }),
        };
      });

    case "thread.reverted":
      return decodeForEvent(ThreadRevertedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => {
          const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
          if (!thread) {
            return nextBase;
          }

          const checkpoints = thread.checkpoints
            .filter((entry) => entry.checkpointTurnCount <= payload.turnCount)
            .toSorted((left, right) => left.checkpointTurnCount - right.checkpointTurnCount)
            .slice(-MAX_THREAD_CHECKPOINTS);
          const retainedTurnIds = new Set(checkpoints.map((checkpoint) => checkpoint.turnId));
          const messages = retainThreadMessagesAfterRevert(
            thread.messages,
            retainedTurnIds,
            payload.turnCount,
          ).slice(-MAX_THREAD_MESSAGES);
          const proposedPlans = retainThreadProposedPlansAfterRevert(
            thread.proposedPlans,
            retainedTurnIds,
          ).slice(-200);
          const activities = retainThreadActivitiesAfterRevert(thread.activities, retainedTurnIds);

          const latestCheckpoint = checkpoints.at(-1) ?? null;
          const latestTurn =
            latestCheckpoint === null
              ? null
              : {
                  turnId: latestCheckpoint.turnId,
                  state: checkpointStatusToLatestTurnState(latestCheckpoint.status),
                  requestedAt: latestCheckpoint.completedAt,
                  startedAt: latestCheckpoint.completedAt,
                  completedAt: latestCheckpoint.completedAt,
                  assistantMessageId: latestCheckpoint.assistantMessageId,
                };

          return {
            ...nextBase,
            threads: updateThread(nextBase.threads, payload.threadId, {
              checkpoints,
              messages,
              proposedPlans,
              activities,
              latestTurn,
              updatedAt: event.occurredAt,
            }),
          };
        }),
      );

    case "thread.activity-appended":
      return decodeForEvent(
        ThreadActivityAppendedPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => {
          const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
          if (!thread) {
            return nextBase;
          }

          const activities = [
            ...thread.activities.filter((entry) => entry.id !== payload.activity.id),
            payload.activity,
          ]
            .toSorted(compareThreadActivities)
            .slice(-500);

          return {
            ...nextBase,
            threads: updateThread(nextBase.threads, payload.threadId, {
              activities,
              updatedAt: event.occurredAt,
            }),
          };
        }),
      );

    // --- Task aggregate (Plan 018 WP-D) -----------------------------------
    //
    // Status is a deterministic left-fold over the `task.*` log: each event maps
    // to exactly one `OrchestrationTaskStatus` by its type + role/gate/decision
    // discriminant. There is intentionally NO `task.status.set` command and no
    // payload status field is ever trusted — the projector is the sole authority
    // on status. The derivation matches design §5.

    case "task.created":
      // `task.created → draft`. Seeds the aggregate row from the create payload.
      return decodeForEvent(TaskCreatedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => {
          const existing = nextBase.tasks.find((entry) => entry.id === payload.taskId);
          const task: OrchestrationTask = {
            id: payload.taskId,
            projectId: payload.projectId,
            type: payload.taskType,
            title: payload.title,
            status: "draft",
            branch: payload.branch,
            worktreePath: payload.worktreePath,
            prUrl: null,
            pmMessageId: payload.pmMessageId,
            stageThreadIds: [],
            currentStageThreadId: null,
            parentTaskId: payload.parentTaskId ?? null,
            childOrder: payload.childOrder ?? null,
            aggregateProgress: null,
            acceptanceCriteria: payload.acceptanceCriteria ?? [],
            dependsOnTaskIds: payload.dependsOnTaskIds ?? [],
            supersedesTaskId: payload.supersedesTaskId ?? null,
            supersededByTaskId: null,
            cancellation: null,
            changeReview: null,
            verification: null,
            noChangesNeeded: null,
            landing: null,
            releaseDispatch: null,
            roleCapabilityTiers: {},
            playbookVersion: payload.playbookVersion,
            createdAt: payload.createdAt,
            updatedAt: payload.updatedAt,
            archivedAt: null,
            deletedAt: null,
          };
          return {
            ...nextBase,
            tasks: withAggregateTaskProgress(
              (existing
                ? nextBase.tasks.map((entry) => (entry.id === payload.taskId ? task : entry))
                : [...nextBase.tasks, task]
              ).map((entry) =>
                payload.supersedesTaskId !== undefined &&
                payload.supersedesTaskId !== null &&
                entry.id === payload.supersedesTaskId
                  ? Object.assign({}, entry, {
                      supersededByTaskId: payload.taskId,
                      updatedAt: payload.updatedAt,
                    })
                  : entry,
              ),
            ),
          };
        }),
      );

    case "task.classified":
      // `task.classified → classified`. Snapshots the resolved task type +
      // playbook version onto the aggregate for determinism.
      return decodeForEvent(TaskClassifiedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          tasks: updateTask(nextBase.tasks, payload.taskId, {
            status: "classified",
            type: payload.taskType,
            playbookVersion: payload.playbookVersion,
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "task.split":
      return decodeForEvent(TaskSplitPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          tasks: updateTask(nextBase.tasks, payload.taskId, {
            branch: null,
            worktreePath: null,
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "task.capability-tiers-updated":
      return decodeForEvent(
        TaskCapabilityTiersUpdatedPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => ({
          ...nextBase,
          tasks: updateTask(nextBase.tasks, payload.taskId, {
            roleCapabilityTiers: payload.roleCapabilityTiers,
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "task.archived":
      return decodeForEvent(TaskArchivedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          tasks: updateTask(nextBase.tasks, payload.taskId, {
            archivedAt: payload.archivedAt,
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "task.restored":
      return decodeForEvent(TaskRestoredPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          tasks: updateTask(nextBase.tasks, payload.taskId, {
            archivedAt: null,
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "task.deleted":
      return decodeForEvent(TaskDeletedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          tasks: updateTask(nextBase.tasks, payload.taskId, {
            deletedAt: payload.deletedAt,
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "task.stage-started":
      // Status by role:
      //   classify → classified (classify runs while the task is `classified`;
      //              no distinct status)
      //   plan     → planning
      //   review   → reviewing
      //   work     → working
      //   verify   → verifying
      // Always records the stage thread and points `currentStageThreadId` at it.
      return decodeForEvent(TaskStageStartedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => {
          const task = nextBase.tasks.find((entry) => entry.id === payload.taskId);
          if (!task) {
            return nextBase;
          }
          const project = nextBase.projects.find((entry) => entry.id === task.projectId);
          // Prefer the backend/model stamped on the event; fall back to
          // re-deriving from config for events appended before the payload
          // carried them (append-only compatibility).
          const fallbackSelection =
            project === undefined
              ? null
              : resolveStageModelSelection({
                  project,
                  role: payload.role,
                });
          const providerInstanceId = payload.providerInstanceId ?? fallbackSelection?.instanceId;
          const model = payload.model ?? fallbackSelection?.model;
          const modelOptions = payload.modelOptions ?? fallbackSelection?.options ?? null;
          const status = taskStatusForStageRole(payload.role);
          const stageThreadIds = task.stageThreadIds.includes(payload.stageThreadId)
            ? task.stageThreadIds
            : [...task.stageThreadIds, payload.stageThreadId];
          const blockedStageToResume = nextBase.quotaBlockedStages
            .filter(
              (stage) =>
                stage.taskId === payload.taskId &&
                stage.role === payload.role &&
                stage.status === "blocked",
            )
            .toSorted(
              (left, right) =>
                right.blockedAt.localeCompare(left.blockedAt) ||
                right.stageThreadId.localeCompare(left.stageThreadId),
            )[0];
          return {
            ...nextBase,
            tasks: updateTask(nextBase.tasks, payload.taskId, {
              status,
              stageThreadIds,
              currentStageThreadId: payload.stageThreadId,
              ...(payload.role === "work" ? { verification: null } : {}),
              updatedAt: payload.updatedAt,
            }),
            quotaBlockedStages:
              blockedStageToResume === undefined
                ? nextBase.quotaBlockedStages
                : nextBase.quotaBlockedStages.map((stage) =>
                    stage.stageThreadId === blockedStageToResume.stageThreadId
                      ? { ...stage, status: "resumed" as const, resumedAt: payload.updatedAt }
                      : stage,
                  ),
            stageHistory:
              providerInstanceId === undefined || model === undefined
                ? nextBase.stageHistory
                : ({
                    ...nextBase.stageHistory,
                    [payload.stageThreadId]: {
                      projectId: task.projectId,
                      taskId: payload.taskId,
                      stageThreadId: payload.stageThreadId,
                      role: payload.role,
                      capabilityTier: payload.capabilityTier ?? null,
                      providerInstanceId,
                      model,
                      modelOptions,
                      ...(payload.runtimeMode === undefined
                        ? {}
                        : { runtimeMode: payload.runtimeMode }),
                      ...(payload.startHead === undefined ? {} : { startHead: payload.startHead }),
                      status: "running",
                      startedAt: payload.updatedAt,
                      endedAt: null,
                    },
                  } satisfies OrchestrationStageHistory),
          };
        }),
      );

    case "task.stage-completed":
      // Only the `work` stage completing advances status (`work → review`).
      // Other roles' completion is recorded (updatedAt) but their forward
      // transition is driven by the next stage starting or a gate event, so a
      // completed classify/plan stage does not regress the derived status.
      return decodeForEvent(TaskStageCompletedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => {
          const existingStage = nextBase.stageHistory[payload.stageThreadId];
          return {
            ...nextBase,
            tasks: updateTask(nextBase.tasks, payload.taskId, {
              ...(payload.role === "work"
                ? { status: "review" as const }
                : (payload.ownershipViolationPaths?.length ?? 0) > 0
                  ? {
                      status: (payload.role === "verify" ? "review" : "plan-review") as
                        | "review"
                        | "plan-review",
                    }
                  : {}),
              currentStageThreadId: null,
              updatedAt: payload.updatedAt,
            }),
            stageHistory:
              existingStage === undefined
                ? nextBase.stageHistory
                : {
                    ...nextBase.stageHistory,
                    [payload.stageThreadId]: {
                      ...existingStage,
                      status: "completed" as const,
                      endedAt: payload.updatedAt,
                    },
                  },
          };
        }),
      );

    case "task.change-review-requested":
      return decodeForEvent(
        TaskChangeReviewRequestedPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => ({
          ...nextBase,
          tasks: updateTask(nextBase.tasks, payload.taskId, {
            status: "change-review",
            changeReview: {
              status: "pending",
              workStageThreadId: payload.workStageThreadId,
              detectedHead: payload.detectedHead,
              resolution: null,
              requestedAt: payload.requestedAt,
              resolvedAt: null,
            },
            verification: null,
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "task.change-review-resolved":
      return decodeForEvent(
        TaskChangeReviewResolvedPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => {
          const task = nextBase.tasks.find((entry) => entry.id === payload.taskId);
          if (task?.changeReview === null || task?.changeReview === undefined) return nextBase;
          return {
            ...nextBase,
            tasks: updateTask(nextBase.tasks, payload.taskId, {
              status: task.currentStageThreadId === null ? "review" : task.status,
              changeReview: {
                ...task.changeReview,
                status: "resolved",
                resolution: payload.resolution,
                resolvedAt: payload.resolvedAt,
              },
              verification: null,
              updatedAt: payload.updatedAt,
            }),
          };
        }),
      );

    case "task.verification-recorded":
      return decodeForEvent(
        TaskVerificationRecordedPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => ({
          ...nextBase,
          tasks: updateTask(nextBase.tasks, payload.taskId, {
            status: "review",
            verification: {
              stageThreadId: payload.stageThreadId,
              head: payload.head,
              verifiedAt: payload.verifiedAt,
            },
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "task.no-changes-needed":
      return decodeForEvent(TaskNoChangesNeededPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          tasks: updateTask(nextBase.tasks, payload.taskId, {
            status: "no-changes-needed",
            currentStageThreadId: null,
            noChangesNeeded: {
              baseHead: payload.baseHead,
              head: payload.head,
              completedAt: payload.completedAt,
            },
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "task.stage-blocked":
      return decodeForEvent(TaskStageBlockedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => {
          const retryCount =
            nextBase.quotaBlockedStages.filter(
              (stage) => stage.taskId === payload.taskId && stage.role === payload.role,
            ).length + 1;
          return {
            ...nextBase,
            tasks: updateTask(nextBase.tasks, payload.taskId, {
              status: "blocked-on-quota",
              currentStageThreadId: null,
              updatedAt: payload.updatedAt,
            }),
            quotaBlockedStages: [
              ...nextBase.quotaBlockedStages,
              {
                taskId: payload.taskId,
                stageThreadId: payload.stageThreadId,
                role: payload.role,
                providerInstanceId: payload.providerInstanceId,
                resetAt: payload.resetAt ?? null,
                status: "blocked" as const,
                retryCount,
                blockedAt: payload.updatedAt,
                resumedAt: null,
              },
            ],
            stageHistory:
              nextBase.stageHistory[payload.stageThreadId] === undefined
                ? nextBase.stageHistory
                : {
                    ...nextBase.stageHistory,
                    [payload.stageThreadId]: {
                      ...nextBase.stageHistory[payload.stageThreadId],
                      providerInstanceId: payload.providerInstanceId,
                      status: "blocked" as const,
                      endedAt: payload.updatedAt,
                    },
                  },
          };
        }),
      );

    case "task.stage-interrupted":
      return decodeForEvent(TaskStageInterruptedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          tasks: updateTask(nextBase.tasks, payload.taskId, {
            status: "blocked",
            currentStageThreadId: null,
            updatedAt: payload.updatedAt,
          }),
          stageHistory:
            nextBase.stageHistory[payload.stageThreadId] === undefined
              ? nextBase.stageHistory
              : {
                  ...nextBase.stageHistory,
                  [payload.stageThreadId]: {
                    ...nextBase.stageHistory[payload.stageThreadId],
                    status: "interrupted" as const,
                    endedAt: payload.updatedAt,
                  },
                },
        })),
      );

    case "task.gate-requested":
      // Requesting a gate parks the task on the gate:
      //   plan → plan-review
      //   land → review
      // Other gate kinds are reconciliation-only and leave status unchanged.
      return decodeForEvent(TaskGateRequestedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => {
          const existingGate = nextBase.pendingGates?.find(
            (gate) => gate.gateId === payload.gateId,
          );
          const pendingGate: OrchestrationPendingGate = {
            gateId: payload.gateId,
            taskId: payload.taskId,
            gate: payload.gate,
            contentHash: payload.contentHash,
            stageThreadId: payload.stageThreadId,
            status: "pending",
            approvedHash: existingGate?.approvedHash ?? null,
            decision: existingGate?.decision ?? null,
            origin: existingGate?.origin ?? null,
            requestedAt: existingGate?.requestedAt ?? payload.updatedAt,
            resolvedAt: existingGate?.resolvedAt ?? null,
          };
          const pendingGates =
            existingGate === undefined
              ? [...(nextBase.pendingGates ?? []), pendingGate]
              : (nextBase.pendingGates ?? []).map((gate) =>
                  gate.gateId === payload.gateId ? pendingGate : gate,
                );
          return {
            ...nextBase,
            tasks: updateTask(nextBase.tasks, payload.taskId, {
              ...(payload.gate === "plan"
                ? { status: "plan-review" as const }
                : payload.gate === "land"
                  ? { status: "review" as const }
                  : {}),
              updatedAt: payload.updatedAt,
            }),
            pendingGates,
          };
        }),
      );

    case "task.gate-resolved":
      // Resolving a gate by (gate, decision):
      //   plan + approved → planning (a subsequent work stage-start moves it to
      //                     working)
      //   plan + rejected → blocked
      //   land + rejected → blocked
      //   land + approved → leave status (the `task.land` path drives `landed`)
      // The decider rejects PM-runtime origin (WP-E); the projector trusts the
      // already-validated event.
      return decodeForEvent(TaskGateResolvedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => {
          const nextStatus =
            payload.gate === "plan"
              ? payload.decision === "approved"
                ? ("planning" as const)
                : ("blocked" as const)
              : payload.gate === "land" && payload.decision === "rejected"
                ? ("blocked" as const)
                : null;
          return {
            ...nextBase,
            tasks: updateTask(nextBase.tasks, payload.taskId, {
              ...(nextStatus !== null ? { status: nextStatus } : {}),
              updatedAt: payload.updatedAt,
            }),
            pendingGates: updatePendingGate(nextBase.pendingGates ?? [], payload.gateId, {
              status: "resolved",
              approvedHash: payload.approvedHash,
              decision: payload.decision,
              origin: payload.origin,
              resolvedAt: payload.updatedAt,
            }),
          };
        }),
      );

    case "task.landed":
      // `task.landed → landed` (terminal success).
      return decodeForEvent(TaskLandedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          tasks: updateTask(nextBase.tasks, payload.taskId, {
            status: "landed",
            landing: {
              status: "opening-pr",
              failureMessage: null,
              branchPushed: false,
              updatedAt: payload.updatedAt,
            },
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "task.landing-retry-requested":
      return decodeForEvent(TaskLandedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          tasks: updateTask(nextBase.tasks, payload.taskId, {
            landing: {
              status: "opening-pr",
              failureMessage: null,
              branchPushed: false,
              updatedAt: payload.updatedAt,
            },
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "task.release-dispatch-requested":
      return decodeForEvent(
        TaskReleaseDispatchRequestedPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => ({
          ...nextBase,
          tasks: updateTask(nextBase.tasks, payload.taskId, {
            releaseDispatch: {
              status: "dispatching",
              workflow: payload.workflow,
              ref: payload.ref,
              inputs: payload.inputs,
              contentHash: payload.contentHash,
              workflowUrl: null,
              failureMessage: null,
              requestedAt: payload.requestedAt,
              updatedAt: payload.updatedAt,
            },
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "task.release-dispatched":
      return decodeForEvent(
        TaskReleaseDispatchedPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => {
          const task = nextBase.tasks.find((entry) => entry.id === payload.taskId);
          return task?.releaseDispatch == null
            ? nextBase
            : {
                ...nextBase,
                tasks: updateTask(nextBase.tasks, payload.taskId, {
                  releaseDispatch: {
                    ...task.releaseDispatch,
                    status: "dispatched",
                    workflowUrl: payload.workflowUrl,
                    failureMessage: null,
                    updatedAt: payload.updatedAt,
                  },
                  updatedAt: payload.updatedAt,
                }),
              };
        }),
      );

    case "task.release-dispatch-failed":
      return decodeForEvent(
        TaskReleaseDispatchFailedPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => {
          const task = nextBase.tasks.find((entry) => entry.id === payload.taskId);
          return task?.releaseDispatch == null
            ? nextBase
            : {
                ...nextBase,
                tasks: updateTask(nextBase.tasks, payload.taskId, {
                  releaseDispatch: {
                    ...task.releaseDispatch,
                    status: "failed",
                    failureMessage: payload.message,
                    updatedAt: payload.updatedAt,
                  },
                  updatedAt: payload.updatedAt,
                }),
              };
        }),
      );

    case "task.cancellation-requested":
      return decodeForEvent(
        TaskCancellationRequestedPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => ({
          ...nextBase,
          tasks: updateTask(nextBase.tasks, payload.taskId, {
            cancellation: {
              requestedAt: payload.requestedAt,
              completedPhases: [],
              failurePhase: null,
              failureMessage: null,
              failedAt: null,
            },
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "task.cancellation-failed":
      return decodeForEvent(
        TaskCancellationFailedPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => {
          const task = nextBase.tasks.find((entry) => entry.id === payload.taskId);
          if (task?.cancellation == null) return nextBase;
          return {
            ...nextBase,
            tasks: updateTask(nextBase.tasks, payload.taskId, {
              cancellation: {
                ...task.cancellation,
                failurePhase: payload.phase,
                failureMessage: payload.message,
                failedAt: payload.failedAt,
              },
              updatedAt: payload.updatedAt,
            }),
          };
        }),
      );

    case "task.cancellation-phase-completed":
      return decodeForEvent(
        TaskCancellationPhaseCompletedPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => {
          const task = nextBase.tasks.find((entry) => entry.id === payload.taskId);
          if (task?.cancellation == null) return nextBase;
          return {
            ...nextBase,
            tasks: updateTask(nextBase.tasks, payload.taskId, {
              cancellation: {
                ...task.cancellation,
                completedPhases: Array.from(
                  new Set([...(task.cancellation.completedPhases ?? []), payload.phase]),
                ),
                failurePhase: null,
                failureMessage: null,
                failedAt: null,
              },
              updatedAt: payload.updatedAt,
            }),
          };
        }),
      );

    case "task.pr-opened":
      return decodeForEvent(TaskPrOpenedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          tasks: updateTask(nextBase.tasks, payload.taskId, {
            prUrl: payload.prUrl,
            landing: {
              status: "completed",
              failureMessage: null,
              branchPushed: true,
              updatedAt: payload.updatedAt,
            },
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "task.pr-open-failed":
      return decodeForEvent(TaskPrOpenFailedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          tasks: updateTask(nextBase.tasks, payload.taskId, {
            landing: {
              status: "failed",
              failureMessage: payload.message,
              branchPushed: payload.branchPushed,
              updatedAt: payload.updatedAt,
            },
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "task.abandoned":
      // `task.abandoned → abandoned` (terminal).
      return decodeForEvent(TaskAbandonedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => {
          const cancellation = nextBase.tasks.find(
            (task) => task.id === payload.taskId,
          )?.cancellation;
          return {
            ...nextBase,
            tasks: updateTask(nextBase.tasks, payload.taskId, {
              status: "abandoned",
              currentStageThreadId: null,
              ...(cancellation === undefined
                ? {}
                : {
                    cancellation:
                      cancellation === null
                        ? null
                        : {
                            ...cancellation,
                            failurePhase: null,
                            failureMessage: null,
                            failedAt: null,
                          },
                  }),
              updatedAt: payload.updatedAt,
            }),
            pendingGates: (nextBase.pendingGates ?? []).filter(
              (gate) => gate.taskId !== payload.taskId,
            ),
          };
        }),
      );

    default:
      return Effect.succeed(nextBase);
  }
}
