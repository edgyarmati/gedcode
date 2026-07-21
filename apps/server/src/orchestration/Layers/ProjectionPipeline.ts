import {
  ApprovalRequestId,
  type ChatAttachment,
  type OrchestrationEvent,
  type OrchestrationSessionStatus,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { toPersistenceSqlError, type ProjectionRepositoryError } from "../../persistence/Errors.ts";
import { withBusyRetry } from "../../persistence/retryPolicy.ts";
import { OrchestrationEventStore } from "../../persistence/Services/OrchestrationEventStore.ts";
import { ProjectionAwaitedStageRepository } from "../../persistence/Services/ProjectionAwaitedStages.ts";
import { ProjectionPendingApprovalRepository } from "../../persistence/Services/ProjectionPendingApprovals.ts";
import { ProjectionPendingGateRepository } from "../../persistence/Services/ProjectionPendingGates.ts";
import { ProjectionQuotaBlockedStageRepository } from "../../persistence/Services/ProjectionQuotaBlockedStages.ts";
import { ProjectionProjectRepository } from "../../persistence/Services/ProjectionProjects.ts";
import { ProjectionProjectContextRunRepository } from "../../persistence/Services/ProjectionProjectContextRuns.ts";
import { ProjectionStageHistoryRepository } from "../../persistence/Services/ProjectionStageHistory.ts";
import { ProjectionStateRepository } from "../../persistence/Services/ProjectionState.ts";
import { ProjectionTaskRepository } from "../../persistence/Services/ProjectionTasks.ts";
import { ProjectionHelperRunRepository } from "../../persistence/Services/ProjectionHelperRuns.ts";
import { ProjectionThreadActivityRepository } from "../../persistence/Services/ProjectionThreadActivities.ts";
import { type ProjectionThreadActivity } from "../../persistence/Services/ProjectionThreadActivities.ts";
import {
  type ProjectionThreadMessage,
  ProjectionThreadMessageRepository,
} from "../../persistence/Services/ProjectionThreadMessages.ts";
import {
  type ProjectionThreadProposedPlan,
  ProjectionThreadProposedPlanRepository,
} from "../../persistence/Services/ProjectionThreadProposedPlans.ts";
import { ProjectionThreadSessionRepository } from "../../persistence/Services/ProjectionThreadSessions.ts";
import {
  type ProjectionTurn,
  ProjectionTurnRepository,
} from "../../persistence/Services/ProjectionTurns.ts";
import { ProjectionThreadRepository } from "../../persistence/Services/ProjectionThreads.ts";
import { ProjectionAwaitedStageRepositoryLive } from "../../persistence/Layers/ProjectionAwaitedStages.ts";
import { ProjectionPendingApprovalRepositoryLive } from "../../persistence/Layers/ProjectionPendingApprovals.ts";
import { ProjectionPendingGateRepositoryLive } from "../../persistence/Layers/ProjectionPendingGates.ts";
import { ProjectionQuotaBlockedStageRepositoryLive } from "../../persistence/Layers/ProjectionQuotaBlockedStages.ts";
import { ProjectionProjectRepositoryLive } from "../../persistence/Layers/ProjectionProjects.ts";
import { ProjectionProjectContextRunRepositoryLive } from "../../persistence/Layers/ProjectionProjectContextRuns.ts";
import { ProjectionStageHistoryRepositoryLive } from "../../persistence/Layers/ProjectionStageHistory.ts";
import { ProjectionStateRepositoryLive } from "../../persistence/Layers/ProjectionState.ts";
import { ProjectionTaskRepositoryLive } from "../../persistence/Layers/ProjectionTasks.ts";
import { ProjectionHelperRunRepositoryLive } from "../../persistence/Layers/ProjectionHelperRuns.ts";
import { ProjectionThreadActivityRepositoryLive } from "../../persistence/Layers/ProjectionThreadActivities.ts";
import { ProjectionThreadMessageRepositoryLive } from "../../persistence/Layers/ProjectionThreadMessages.ts";
import { ProjectionThreadProposedPlanRepositoryLive } from "../../persistence/Layers/ProjectionThreadProposedPlans.ts";
import { ProjectionThreadSessionRepositoryLive } from "../../persistence/Layers/ProjectionThreadSessions.ts";
import { ProjectionTurnRepositoryLive } from "../../persistence/Layers/ProjectionTurns.ts";
import { ProjectionThreadRepositoryLive } from "../../persistence/Layers/ProjectionThreads.ts";
import { ServerConfig } from "../../config.ts";
import {
  OrchestrationProjectionPipeline,
  type OrchestrationProjectionPipelineShape,
} from "../Services/ProjectionPipeline.ts";
import {
  attachmentRelativePath,
  parseAttachmentIdFromRelativePath,
  parseThreadSegmentFromAttachmentId,
  toSafeThreadAttachmentSegment,
} from "../../attachmentStore.ts";
import { resolveStageModelSelection, taskStatusForStageRole } from "../stageModelSelection.ts";

export const ORCHESTRATION_PROJECTOR_NAMES = {
  projects: "projection.projects",
  threads: "projection.threads",
  threadMessages: "projection.thread-messages",
  threadProposedPlans: "projection.thread-proposed-plans",
  threadActivities: "projection.thread-activities",
  threadSessions: "projection.thread-sessions",
  threadTurns: "projection.thread-turns",
  checkpoints: "projection.checkpoints",
  pendingApprovals: "projection.pending-approvals",
  tasks: "projection.tasks",
  helperRuns: "projection.helper-runs",
  projectContextRuns: "projection.project-context-runs",
  stageHistory: "projection.stage-history",
  awaitedStages: "projection.awaited-stages",
  pendingGates: "projection.pending-gates",
  quotaBlockedStages: "projection.quota-blocked-stages",
} as const;

type ProjectorName =
  (typeof ORCHESTRATION_PROJECTOR_NAMES)[keyof typeof ORCHESTRATION_PROJECTOR_NAMES];

function settledTurnStateForSessionStatus(
  status: OrchestrationSessionStatus,
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

interface ProjectorDefinition {
  readonly name: ProjectorName;
  readonly apply: (
    event: OrchestrationEvent,
    attachmentSideEffects: AttachmentSideEffects,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

interface AttachmentSideEffects {
  readonly deletedThreadIds: Set<string>;
  readonly prunedThreadRelativePaths: Map<string, Set<string>>;
}

const materializeAttachmentsForProjection = Effect.fn("materializeAttachmentsForProjection")(
  (input: { readonly attachments: ReadonlyArray<ChatAttachment> }) =>
    Effect.succeed(input.attachments.length === 0 ? [] : input.attachments),
);

function extractActivityRequestId(payload: unknown): ApprovalRequestId | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const requestId = (payload as Record<string, unknown>).requestId;
  return typeof requestId === "string" ? ApprovalRequestId.make(requestId) : null;
}

function isStalePendingApprovalFailureDetail(detail: string | null): boolean {
  if (detail === null) {
    return false;
  }
  return (
    detail.includes("stale pending approval request") ||
    detail.includes("unknown pending approval request") ||
    detail.includes("unknown pending permission request")
  );
}

function derivePendingUserInputCountFromActivities(
  activities: ReadonlyArray<ProjectionThreadActivity>,
): number {
  const openRequestIds = new Set<string>();
  const ordered = [...activities].toSorted(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) ||
      left.activityId.localeCompare(right.activityId),
  );

  for (const activity of ordered) {
    const requestId = extractActivityRequestId(activity.payload);
    if (requestId === null) {
      continue;
    }
    const payload =
      typeof activity.payload === "object" && activity.payload !== null
        ? (activity.payload as Record<string, unknown>)
        : null;
    const detail = typeof payload?.detail === "string" ? payload.detail.toLowerCase() : null;

    if (activity.kind === "user-input.requested") {
      openRequestIds.add(requestId);
      continue;
    }

    if (activity.kind === "user-input.resolved") {
      openRequestIds.delete(requestId);
      continue;
    }

    if (
      activity.kind === "provider.user-input.respond.failed" &&
      detail !== null &&
      (detail.includes("stale pending user-input request") ||
        detail.includes("unknown pending user-input request"))
    ) {
      openRequestIds.delete(requestId);
    }
  }

  return openRequestIds.size;
}

function retainProjectionMessagesAfterRevert(
  messages: ReadonlyArray<ProjectionThreadMessage>,
  turns: ReadonlyArray<ProjectionTurn>,
  turnCount: number,
): ReadonlyArray<ProjectionThreadMessage> {
  const retainedMessageIds = new Set<string>();
  const retainedTurnIds = new Set<string>();
  const keptTurns = turns.filter(
    (turn) =>
      turn.turnId !== null &&
      turn.checkpointTurnCount !== null &&
      turn.checkpointTurnCount <= turnCount,
  );
  for (const turn of keptTurns) {
    if (turn.turnId !== null) {
      retainedTurnIds.add(turn.turnId);
    }
    if (turn.pendingMessageId !== null) {
      retainedMessageIds.add(turn.pendingMessageId);
    }
    if (turn.assistantMessageId !== null) {
      retainedMessageIds.add(turn.assistantMessageId);
    }
  }

  for (const message of messages) {
    if (message.role === "system") {
      retainedMessageIds.add(message.messageId);
      continue;
    }
    if (message.turnId !== null && retainedTurnIds.has(message.turnId)) {
      retainedMessageIds.add(message.messageId);
    }
  }

  const retainedUserCount = messages.filter(
    (message) => message.role === "user" && retainedMessageIds.has(message.messageId),
  ).length;
  const missingUserCount = Math.max(0, turnCount - retainedUserCount);
  if (missingUserCount > 0) {
    const fallbackUserMessages = messages
      .filter(
        (message) =>
          message.role === "user" &&
          !retainedMessageIds.has(message.messageId) &&
          (message.turnId === null || retainedTurnIds.has(message.turnId)),
      )
      .toSorted(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) ||
          left.messageId.localeCompare(right.messageId),
      )
      .slice(0, missingUserCount);
    for (const message of fallbackUserMessages) {
      retainedMessageIds.add(message.messageId);
    }
  }

  const retainedAssistantCount = messages.filter(
    (message) => message.role === "assistant" && retainedMessageIds.has(message.messageId),
  ).length;
  const missingAssistantCount = Math.max(0, turnCount - retainedAssistantCount);
  if (missingAssistantCount > 0) {
    const fallbackAssistantMessages = messages
      .filter(
        (message) =>
          message.role === "assistant" &&
          !retainedMessageIds.has(message.messageId) &&
          (message.turnId === null || retainedTurnIds.has(message.turnId)),
      )
      .toSorted(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) ||
          left.messageId.localeCompare(right.messageId),
      )
      .slice(0, missingAssistantCount);
    for (const message of fallbackAssistantMessages) {
      retainedMessageIds.add(message.messageId);
    }
  }

  return messages.filter((message) => retainedMessageIds.has(message.messageId));
}

function retainProjectionActivitiesAfterRevert(
  activities: ReadonlyArray<ProjectionThreadActivity>,
  turns: ReadonlyArray<ProjectionTurn>,
  turnCount: number,
): ReadonlyArray<ProjectionThreadActivity> {
  const retainedTurnIds = new Set<string>(
    turns
      .filter(
        (turn) =>
          turn.turnId !== null &&
          turn.checkpointTurnCount !== null &&
          turn.checkpointTurnCount <= turnCount,
      )
      .flatMap((turn) => (turn.turnId === null ? [] : [turn.turnId])),
  );
  return activities.filter(
    (activity) => activity.turnId === null || retainedTurnIds.has(activity.turnId),
  );
}

function retainProjectionProposedPlansAfterRevert(
  proposedPlans: ReadonlyArray<ProjectionThreadProposedPlan>,
  turns: ReadonlyArray<ProjectionTurn>,
  turnCount: number,
): ReadonlyArray<ProjectionThreadProposedPlan> {
  const retainedTurnIds = new Set<string>(
    turns
      .filter(
        (turn) =>
          turn.turnId !== null &&
          turn.checkpointTurnCount !== null &&
          turn.checkpointTurnCount <= turnCount,
      )
      .flatMap((turn) => (turn.turnId === null ? [] : [turn.turnId])),
  );
  return proposedPlans.filter(
    (proposedPlan) => proposedPlan.turnId === null || retainedTurnIds.has(proposedPlan.turnId),
  );
}

function collectThreadAttachmentRelativePaths(
  threadId: string,
  messages: ReadonlyArray<ProjectionThreadMessage>,
): Set<string> {
  const threadSegment = toSafeThreadAttachmentSegment(threadId);
  if (!threadSegment) {
    return new Set();
  }
  const relativePaths = new Set<string>();
  for (const message of messages) {
    for (const attachment of message.attachments ?? []) {
      if (attachment.type !== "image") {
        continue;
      }
      const attachmentThreadSegment = parseThreadSegmentFromAttachmentId(attachment.id);
      if (!attachmentThreadSegment || attachmentThreadSegment !== threadSegment) {
        continue;
      }
      relativePaths.add(attachmentRelativePath(attachment));
    }
  }
  return relativePaths;
}

const runAttachmentSideEffects = Effect.fn("runAttachmentSideEffects")(function* (
  sideEffects: AttachmentSideEffects,
) {
  const serverConfig = yield* Effect.service(ServerConfig);
  const fileSystem = yield* Effect.service(FileSystem.FileSystem);
  const path = yield* Effect.service(Path.Path);

  const attachmentsRootDir = serverConfig.attachmentsDir;
  const readAttachmentRootEntries = fileSystem
    .readDirectory(attachmentsRootDir, { recursive: false })
    .pipe(Effect.catch(() => Effect.succeed([] as Array<string>)));

  const removeDeletedThreadAttachmentEntry = Effect.fn("removeDeletedThreadAttachmentEntry")(
    function* (threadSegment: string, entry: string) {
      const normalizedEntry = entry.replace(/^[/\\]+/, "").replace(/\\/g, "/");
      if (normalizedEntry.length === 0 || normalizedEntry.includes("/")) {
        return;
      }
      const attachmentId = parseAttachmentIdFromRelativePath(normalizedEntry);
      if (!attachmentId) {
        return;
      }
      const attachmentThreadSegment = parseThreadSegmentFromAttachmentId(attachmentId);
      if (!attachmentThreadSegment || attachmentThreadSegment !== threadSegment) {
        return;
      }
      yield* fileSystem.remove(path.join(attachmentsRootDir, normalizedEntry), {
        force: true,
      });
    },
  );

  const deleteThreadAttachments = Effect.fn("deleteThreadAttachments")(function* (
    threadId: string,
  ) {
    const threadSegment = toSafeThreadAttachmentSegment(threadId);
    if (!threadSegment) {
      yield* Effect.logWarning("skipping attachment cleanup for unsafe thread id", {
        threadId,
      });
      return;
    }

    const entries = yield* readAttachmentRootEntries;
    yield* Effect.forEach(
      entries,
      (entry) => removeDeletedThreadAttachmentEntry(threadSegment, entry),
      {
        concurrency: 1,
      },
    );
  });

  const pruneThreadAttachmentEntry = Effect.fn("pruneThreadAttachmentEntry")(function* (
    threadSegment: string,
    keptThreadRelativePaths: Set<string>,
    entry: string,
  ) {
    const relativePath = entry.replace(/^[/\\]+/, "").replace(/\\/g, "/");
    if (relativePath.length === 0 || relativePath.includes("/")) {
      return;
    }
    const attachmentId = parseAttachmentIdFromRelativePath(relativePath);
    if (!attachmentId) {
      return;
    }
    const attachmentThreadSegment = parseThreadSegmentFromAttachmentId(attachmentId);
    if (!attachmentThreadSegment || attachmentThreadSegment !== threadSegment) {
      return;
    }

    const absolutePath = path.join(attachmentsRootDir, relativePath);
    const fileInfo = yield* fileSystem
      .stat(absolutePath)
      .pipe(Effect.catch(() => Effect.succeed(null)));
    if (!fileInfo || fileInfo.type !== "File") {
      return;
    }

    if (!keptThreadRelativePaths.has(relativePath)) {
      yield* fileSystem.remove(absolutePath, { force: true });
    }
  });

  const pruneThreadAttachments = Effect.fn("pruneThreadAttachments")(function* (
    threadId: string,
    keptThreadRelativePaths: Set<string>,
  ) {
    if (sideEffects.deletedThreadIds.has(threadId)) {
      return;
    }

    const threadSegment = toSafeThreadAttachmentSegment(threadId);
    if (!threadSegment) {
      yield* Effect.logWarning("skipping attachment prune for unsafe thread id", { threadId });
      return;
    }

    const entries = yield* readAttachmentRootEntries;
    yield* Effect.forEach(
      entries,
      (entry) => pruneThreadAttachmentEntry(threadSegment, keptThreadRelativePaths, entry),
      { concurrency: 1 },
    );
  });

  yield* Effect.forEach(sideEffects.deletedThreadIds, deleteThreadAttachments, {
    concurrency: 1,
  });

  yield* Effect.forEach(
    sideEffects.prunedThreadRelativePaths.entries(),
    ([threadId, keptThreadRelativePaths]) =>
      pruneThreadAttachments(threadId, keptThreadRelativePaths),
    { concurrency: 1 },
  );
});

const makeOrchestrationProjectionPipeline = Effect.fn("makeOrchestrationProjectionPipeline")(
  function* () {
    const sql = yield* SqlClient.SqlClient;
    const eventStore = yield* OrchestrationEventStore;
    const projectionStateRepository = yield* ProjectionStateRepository;
    const projectionProjectRepository = yield* ProjectionProjectRepository;
    const projectionProjectContextRunRepository = yield* ProjectionProjectContextRunRepository;
    const projectionThreadRepository = yield* ProjectionThreadRepository;
    const projectionThreadMessageRepository = yield* ProjectionThreadMessageRepository;
    const projectionThreadProposedPlanRepository = yield* ProjectionThreadProposedPlanRepository;
    const projectionThreadActivityRepository = yield* ProjectionThreadActivityRepository;
    const projectionThreadSessionRepository = yield* ProjectionThreadSessionRepository;
    const projectionTurnRepository = yield* ProjectionTurnRepository;
    const projectionPendingApprovalRepository = yield* ProjectionPendingApprovalRepository;
    const projectionTaskRepository = yield* ProjectionTaskRepository;
    const projectionHelperRunRepository = yield* ProjectionHelperRunRepository;
    const projectionStageHistoryRepository = yield* ProjectionStageHistoryRepository;
    const projectionAwaitedStageRepository = yield* ProjectionAwaitedStageRepository;
    const projectionPendingGateRepository = yield* ProjectionPendingGateRepository;
    const projectionQuotaBlockedStageRepository = yield* ProjectionQuotaBlockedStageRepository;

    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const serverConfig = yield* ServerConfig;

    const applyProjectsProjection: ProjectorDefinition["apply"] = Effect.fn(
      "applyProjectsProjection",
    )(function* (event, _attachmentSideEffects) {
      switch (event.type) {
        case "project.created":
          yield* projectionProjectRepository.upsert({
            projectId: event.payload.projectId,
            title: event.payload.title,
            workspaceRoot: event.payload.workspaceRoot,
            defaultModelSelection: event.payload.defaultModelSelection,
            roleModelSelections: event.payload.roleModelSelections ?? {},
            rolePromptPrefixes: event.payload.rolePromptPrefixes ?? {},
            orchestratorConfig: event.payload.orchestratorConfig ?? {},
            projectContextResolution: null,
            scripts: event.payload.scripts,
            createdAt: event.payload.createdAt,
            updatedAt: event.payload.updatedAt,
            deletedAt: null,
          });
          return;

        case "project.meta-updated": {
          const existingRow = yield* projectionProjectRepository.getById({
            projectId: event.payload.projectId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }
          yield* projectionProjectRepository.upsert({
            ...existingRow.value,
            ...(event.payload.title !== undefined ? { title: event.payload.title } : {}),
            ...(event.payload.workspaceRoot !== undefined
              ? { workspaceRoot: event.payload.workspaceRoot }
              : {}),
            ...(event.payload.defaultModelSelection !== undefined
              ? { defaultModelSelection: event.payload.defaultModelSelection }
              : {}),
            ...(event.payload.roleModelSelections !== undefined
              ? { roleModelSelections: event.payload.roleModelSelections }
              : {}),
            ...(event.payload.rolePromptPrefixes !== undefined
              ? { rolePromptPrefixes: event.payload.rolePromptPrefixes }
              : {}),
            ...(event.payload.orchestratorConfig !== undefined
              ? { orchestratorConfig: event.payload.orchestratorConfig }
              : {}),
            ...(event.payload.scripts !== undefined ? { scripts: event.payload.scripts } : {}),
            updatedAt: event.payload.updatedAt,
          });
          return;
        }

        case "project.context-dismissed":
        case "project.context-completed": {
          const existingRow = yield* projectionProjectRepository.getById({
            projectId: event.payload.projectId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }
          const dismissed = event.type === "project.context-dismissed";
          const resolvedAt = dismissed ? event.payload.dismissedAt : event.payload.completedAt;
          yield* projectionProjectRepository.upsert({
            ...existingRow.value,
            projectContextResolution: {
              schemaVersion: event.payload.schemaVersion,
              fingerprint: event.payload.fingerprint,
              outcome: dismissed ? "dismissed" : "completed",
              resolvedAt,
            },
            updatedAt: resolvedAt,
          });
          return;
        }

        case "project.deleted": {
          const existingRow = yield* projectionProjectRepository.getById({
            projectId: event.payload.projectId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }
          yield* projectionProjectRepository.upsert({
            ...existingRow.value,
            deletedAt: event.payload.deletedAt,
            updatedAt: event.payload.deletedAt,
          });
          return;
        }

        default:
          return;
      }
    });

    const refreshThreadShellSummary = Effect.fn("refreshThreadShellSummary")(function* (
      threadId: ThreadId,
    ) {
      const existingRow = yield* projectionThreadRepository.getById({
        threadId,
      });
      if (Option.isNone(existingRow)) {
        return;
      }

      const [latestUserMessageAt, pendingApprovalCount, activities, hasActionableProposedPlan] =
        yield* Effect.all([
          projectionThreadMessageRepository.latestUserMessageAt({ threadId }),
          projectionPendingApprovalRepository.countPendingByThreadId({ threadId }),
          projectionThreadActivityRepository.listByThreadId({ threadId }),
          projectionThreadProposedPlanRepository.hasActionableProposedPlan({
            threadId,
            latestTurnId: existingRow.value.latestTurnId,
          }),
        ]);

      const pendingUserInputCount = derivePendingUserInputCountFromActivities(activities);

      yield* projectionThreadRepository.upsert({
        ...existingRow.value,
        latestUserMessageAt,
        pendingApprovalCount,
        pendingUserInputCount,
        hasActionableProposedPlan: hasActionableProposedPlan ? 1 : 0,
      });
    });

    const applyThreadsProjection: ProjectorDefinition["apply"] = Effect.fn(
      "applyThreadsProjection",
    )(function* (event, attachmentSideEffects) {
      switch (event.type) {
        case "thread.created":
          yield* projectionThreadRepository.upsert({
            threadId: event.payload.threadId,
            projectId: event.payload.projectId,
            title: event.payload.title,
            modelSelection: event.payload.modelSelection,
            gedWorkflowEnabled: event.payload.gedWorkflowEnabled ?? true,
            runtimeMode: event.payload.runtimeMode,
            interactionMode: event.payload.interactionMode,
            branch: event.payload.branch,
            worktreePath: event.payload.worktreePath,
            latestTurnId: null,
            createdAt: event.payload.createdAt,
            updatedAt: event.payload.updatedAt,
            archivedAt: null,
            latestUserMessageAt: null,
            pendingApprovalCount: 0,
            pendingUserInputCount: 0,
            hasActionableProposedPlan: 0,
            lastClearedSequence: null,
            pendingPmHandoff: null,
            deletedAt: null,
          });
          return;

        case "thread.archived": {
          const existingRow = yield* projectionThreadRepository.getById({
            threadId: event.payload.threadId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }
          yield* projectionThreadRepository.upsert({
            ...existingRow.value,
            archivedAt: event.payload.archivedAt,
            updatedAt: event.payload.updatedAt,
          });
          return;
        }

        case "thread.unarchived": {
          const existingRow = yield* projectionThreadRepository.getById({
            threadId: event.payload.threadId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }
          yield* projectionThreadRepository.upsert({
            ...existingRow.value,
            archivedAt: null,
            updatedAt: event.payload.updatedAt,
          });
          return;
        }

        case "thread.meta-updated": {
          const existingRow = yield* projectionThreadRepository.getById({
            threadId: event.payload.threadId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }
          yield* projectionThreadRepository.upsert({
            ...existingRow.value,
            ...(event.payload.title !== undefined ? { title: event.payload.title } : {}),
            ...(event.payload.modelSelection !== undefined
              ? { modelSelection: event.payload.modelSelection }
              : {}),
            ...(event.payload.gedWorkflowEnabled !== undefined
              ? { gedWorkflowEnabled: event.payload.gedWorkflowEnabled }
              : {}),
            ...(event.payload.branch !== undefined ? { branch: event.payload.branch } : {}),
            ...(event.payload.worktreePath !== undefined
              ? { worktreePath: event.payload.worktreePath }
              : {}),
            updatedAt: event.payload.updatedAt,
          });
          return;
        }

        case "thread.runtime-mode-set": {
          const existingRow = yield* projectionThreadRepository.getById({
            threadId: event.payload.threadId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }
          yield* projectionThreadRepository.upsert({
            ...existingRow.value,
            runtimeMode: event.payload.runtimeMode,
            updatedAt: event.payload.updatedAt,
          });
          return;
        }

        case "thread.interaction-mode-set": {
          const existingRow = yield* projectionThreadRepository.getById({
            threadId: event.payload.threadId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }
          yield* projectionThreadRepository.upsert({
            ...existingRow.value,
            interactionMode: event.payload.interactionMode,
            updatedAt: event.payload.updatedAt,
          });
          return;
        }

        case "thread.deleted": {
          attachmentSideEffects.deletedThreadIds.add(event.payload.threadId);
          const existingRow = yield* projectionThreadRepository.getById({
            threadId: event.payload.threadId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }
          yield* projectionThreadRepository.upsert({
            ...existingRow.value,
            deletedAt: event.payload.deletedAt,
            updatedAt: event.payload.deletedAt,
          });
          return;
        }

        case "thread.message-sent":
        case "thread.proposed-plan-upserted":
        case "thread.activity-appended":
        case "thread.cleared":
        case "thread.pm-handoff-requested":
        case "thread.pm-handoff-completed":
        case "thread.approval-response-requested":
        case "thread.user-input-response-requested": {
          const existingRow = yield* projectionThreadRepository.getById({
            threadId: event.payload.threadId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }
          yield* projectionThreadRepository.upsert({
            ...existingRow.value,
            latestTurnId: event.type === "thread.cleared" ? null : existingRow.value.latestTurnId,
            latestUserMessageAt:
              event.type === "thread.cleared" ? null : existingRow.value.latestUserMessageAt,
            pendingApprovalCount:
              event.type === "thread.cleared" ? 0 : existingRow.value.pendingApprovalCount,
            pendingUserInputCount:
              event.type === "thread.cleared" ? 0 : existingRow.value.pendingUserInputCount,
            hasActionableProposedPlan:
              event.type === "thread.cleared" ? 0 : existingRow.value.hasActionableProposedPlan,
            lastClearedSequence:
              event.type === "thread.cleared"
                ? event.sequence
                : existingRow.value.lastClearedSequence,
            pendingPmHandoff:
              event.type === "thread.cleared" || event.type === "thread.pm-handoff-completed"
                ? null
                : event.type === "thread.pm-handoff-requested"
                  ? {
                      mode: event.payload.mode,
                      ...(event.payload.brief !== undefined ? { brief: event.payload.brief } : {}),
                      requestedAt: event.payload.createdAt,
                    }
                  : existingRow.value.pendingPmHandoff,
            updatedAt: event.type === "thread.cleared" ? event.payload.clearedAt : event.occurredAt,
          });
          if (
            event.type === "thread.cleared" ||
            event.type === "thread.pm-handoff-requested" ||
            event.type === "thread.pm-handoff-completed"
          ) {
            return;
          }
          yield* refreshThreadShellSummary(event.payload.threadId);
          return;
        }

        case "thread.session-set": {
          const existingRow = yield* projectionThreadRepository.getById({
            threadId: event.payload.threadId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }
          yield* projectionThreadRepository.upsert({
            ...existingRow.value,
            latestTurnId: event.payload.session.activeTurnId,
            updatedAt: event.occurredAt,
          });
          yield* refreshThreadShellSummary(event.payload.threadId);
          return;
        }

        case "thread.turn-diff-completed": {
          const existingRow = yield* projectionThreadRepository.getById({
            threadId: event.payload.threadId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }
          yield* projectionThreadRepository.upsert({
            ...existingRow.value,
            latestTurnId: event.payload.turnId,
            updatedAt: event.occurredAt,
          });
          yield* refreshThreadShellSummary(event.payload.threadId);
          return;
        }

        case "thread.reverted": {
          const existingRow = yield* projectionThreadRepository.getById({
            threadId: event.payload.threadId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }

          const retainedTurns = yield* projectionTurnRepository.listByThreadId({
            threadId: event.payload.threadId,
          });
          let latestTurnId: ProjectionTurn["turnId"] = null;
          let latestCheckpointTurnCount = -1;
          for (let index = 0; index < retainedTurns.length; index += 1) {
            const turn = retainedTurns[index];
            if (
              !turn ||
              turn.turnId === null ||
              turn.checkpointTurnCount === null ||
              turn.checkpointTurnCount > event.payload.turnCount
            ) {
              continue;
            }
            if (turn.checkpointTurnCount > latestCheckpointTurnCount) {
              latestCheckpointTurnCount = turn.checkpointTurnCount;
              latestTurnId = turn.turnId;
            }
          }

          yield* projectionThreadRepository.upsert({
            ...existingRow.value,
            latestTurnId,
            updatedAt: event.occurredAt,
          });
          yield* refreshThreadShellSummary(event.payload.threadId);
          return;
        }

        default:
          return;
      }
    });

    const applyThreadMessagesProjection: ProjectorDefinition["apply"] = Effect.fn(
      "applyThreadMessagesProjection",
    )(function* (event, attachmentSideEffects) {
      switch (event.type) {
        case "thread.message-sent": {
          const existingMessage = yield* projectionThreadMessageRepository.getByMessageId({
            messageId: event.payload.messageId,
          });
          const previousMessage = Option.getOrUndefined(existingMessage);
          const nextText = Option.match(existingMessage, {
            onNone: () => event.payload.text,
            onSome: (message) => {
              if (event.payload.streaming) {
                return `${message.text}${event.payload.text}`;
              }
              if (event.payload.text.length === 0) {
                return message.text;
              }
              return event.payload.text;
            },
          });
          const nextAttachments =
            event.payload.attachments !== undefined
              ? yield* materializeAttachmentsForProjection({
                  attachments: event.payload.attachments,
                })
              : previousMessage?.attachments;
          yield* projectionThreadMessageRepository.upsert({
            messageId: event.payload.messageId,
            threadId: event.payload.threadId,
            turnId: event.payload.turnId,
            role: event.payload.role,
            text: nextText,
            ...(nextAttachments !== undefined ? { attachments: [...nextAttachments] } : {}),
            isStreaming: event.payload.streaming,
            createdAt: previousMessage?.createdAt ?? event.payload.createdAt,
            updatedAt: event.payload.updatedAt,
          });
          return;
        }

        case "thread.cleared":
          yield* projectionThreadMessageRepository.deleteByThreadId({
            threadId: event.payload.threadId,
          });
          attachmentSideEffects.prunedThreadRelativePaths.set(event.payload.threadId, new Set());
          return;

        case "thread.reverted": {
          const existingRows = yield* projectionThreadMessageRepository.listByThreadId({
            threadId: event.payload.threadId,
          });
          if (existingRows.length === 0) {
            return;
          }

          const existingTurns = yield* projectionTurnRepository.listByThreadId({
            threadId: event.payload.threadId,
          });
          const keptRows = retainProjectionMessagesAfterRevert(
            existingRows,
            existingTurns,
            event.payload.turnCount,
          );
          if (keptRows.length === existingRows.length) {
            return;
          }

          yield* projectionThreadMessageRepository.deleteByThreadId({
            threadId: event.payload.threadId,
          });
          yield* Effect.forEach(keptRows, projectionThreadMessageRepository.upsert, {
            concurrency: 1,
          }).pipe(Effect.asVoid);
          attachmentSideEffects.prunedThreadRelativePaths.set(
            event.payload.threadId,
            collectThreadAttachmentRelativePaths(event.payload.threadId, keptRows),
          );
          return;
        }

        default:
          return;
      }
    });

    const applyThreadProposedPlansProjection: ProjectorDefinition["apply"] = Effect.fn(
      "applyThreadProposedPlansProjection",
    )(function* (event, _attachmentSideEffects) {
      switch (event.type) {
        case "thread.proposed-plan-upserted":
          yield* projectionThreadProposedPlanRepository.upsert({
            planId: event.payload.proposedPlan.id,
            threadId: event.payload.threadId,
            turnId: event.payload.proposedPlan.turnId,
            planMarkdown: event.payload.proposedPlan.planMarkdown,
            implementedAt: event.payload.proposedPlan.implementedAt,
            implementationThreadId: event.payload.proposedPlan.implementationThreadId,
            createdAt: event.payload.proposedPlan.createdAt,
            updatedAt: event.payload.proposedPlan.updatedAt,
          });
          return;

        case "thread.cleared":
          yield* projectionThreadProposedPlanRepository.deleteByThreadId({
            threadId: event.payload.threadId,
          });
          return;

        case "thread.reverted": {
          const existingRows = yield* projectionThreadProposedPlanRepository.listByThreadId({
            threadId: event.payload.threadId,
          });
          if (existingRows.length === 0) {
            return;
          }

          const existingTurns = yield* projectionTurnRepository.listByThreadId({
            threadId: event.payload.threadId,
          });
          const keptRows = retainProjectionProposedPlansAfterRevert(
            existingRows,
            existingTurns,
            event.payload.turnCount,
          );
          if (keptRows.length === existingRows.length) {
            return;
          }

          yield* projectionThreadProposedPlanRepository.deleteByThreadId({
            threadId: event.payload.threadId,
          });
          yield* Effect.forEach(keptRows, projectionThreadProposedPlanRepository.upsert, {
            concurrency: 1,
          }).pipe(Effect.asVoid);
          return;
        }

        default:
          return;
      }
    });

    const applyThreadActivitiesProjection: ProjectorDefinition["apply"] = Effect.fn(
      "applyThreadActivitiesProjection",
    )(function* (event, _attachmentSideEffects) {
      switch (event.type) {
        case "thread.activity-appended":
          yield* projectionThreadActivityRepository.upsert({
            activityId: event.payload.activity.id,
            threadId: event.payload.threadId,
            turnId: event.payload.activity.turnId,
            tone: event.payload.activity.tone,
            kind: event.payload.activity.kind,
            summary: event.payload.activity.summary,
            payload: event.payload.activity.payload,
            ...(event.payload.activity.sequence !== undefined
              ? { sequence: event.payload.activity.sequence }
              : {}),
            createdAt: event.payload.activity.createdAt,
          });
          return;

        case "thread.cleared":
          yield* projectionThreadActivityRepository.deleteByThreadId({
            threadId: event.payload.threadId,
          });
          return;

        case "thread.reverted": {
          const existingRows = yield* projectionThreadActivityRepository.listByThreadId({
            threadId: event.payload.threadId,
          });
          if (existingRows.length === 0) {
            return;
          }
          const existingTurns = yield* projectionTurnRepository.listByThreadId({
            threadId: event.payload.threadId,
          });
          const keptRows = retainProjectionActivitiesAfterRevert(
            existingRows,
            existingTurns,
            event.payload.turnCount,
          );
          if (keptRows.length === existingRows.length) {
            return;
          }
          yield* projectionThreadActivityRepository.deleteByThreadId({
            threadId: event.payload.threadId,
          });
          yield* Effect.forEach(keptRows, projectionThreadActivityRepository.upsert, {
            concurrency: 1,
          }).pipe(Effect.asVoid);
          return;
        }

        default:
          return;
      }
    });

    const applyThreadSessionsProjection: ProjectorDefinition["apply"] = Effect.fn(
      "applyThreadSessionsProjection",
    )(function* (event, _attachmentSideEffects) {
      if (event.type === "thread.cleared") {
        yield* projectionThreadSessionRepository.deleteByThreadId({
          threadId: event.payload.threadId,
        });
        return;
      }
      if (event.type !== "thread.session-set") return;
      yield* projectionThreadSessionRepository.upsert({
        threadId: event.payload.threadId,
        status: event.payload.session.status,
        providerName: event.payload.session.providerName,
        providerInstanceId: event.payload.session.providerInstanceId ?? null,
        runtimeMode: event.payload.session.runtimeMode,
        activeTurnId: event.payload.session.activeTurnId,
        lastError: event.payload.session.lastError,
        updatedAt: event.payload.session.updatedAt,
      });
    });

    const applyThreadTurnsProjection: ProjectorDefinition["apply"] = Effect.fn(
      "applyThreadTurnsProjection",
    )(function* (event, _attachmentSideEffects) {
      switch (event.type) {
        case "thread.turn-start-requested": {
          yield* projectionTurnRepository.replacePendingTurnStart({
            threadId: event.payload.threadId,
            messageId: event.payload.messageId,
            sourceProposedPlanThreadId: event.payload.sourceProposedPlan?.threadId ?? null,
            sourceProposedPlanId: event.payload.sourceProposedPlan?.planId ?? null,
            requestedAt: event.payload.createdAt,
          });
          return;
        }

        case "thread.session-set": {
          const turnId = event.payload.session.activeTurnId;
          if (turnId === null || event.payload.session.status !== "running") {
            const settledTurnState = settledTurnStateForSessionStatus(event.payload.session.status);
            if (settledTurnState === null) {
              return;
            }
            const existingTurns = yield* projectionTurnRepository.listByThreadId({
              threadId: event.payload.threadId,
            });
            yield* Effect.forEach(
              existingTurns.filter((turn) => turn.turnId !== null && turn.state === "running"),
              (turn) =>
                turn.turnId === null
                  ? Effect.void
                  : projectionTurnRepository.upsertByTurnId({
                      ...turn,
                      turnId: turn.turnId,
                      state: settledTurnState,
                      completedAt: event.payload.session.updatedAt,
                    }),
              { concurrency: 1 },
            );
            return;
          }

          const existingTurns = yield* projectionTurnRepository.listByThreadId({
            threadId: event.payload.threadId,
          });
          yield* Effect.forEach(
            existingTurns.filter(
              (turn) => turn.turnId !== null && turn.turnId !== turnId && turn.state === "running",
            ),
            (turn) =>
              turn.turnId === null
                ? Effect.void
                : projectionTurnRepository.upsertByTurnId({
                    ...turn,
                    turnId: turn.turnId,
                    state: "completed",
                    completedAt: event.payload.session.updatedAt,
                  }),
            { concurrency: 1 },
          );

          const existingTurn = yield* projectionTurnRepository.getByTurnId({
            threadId: event.payload.threadId,
            turnId,
          });
          const pendingTurnStart = yield* projectionTurnRepository.getPendingTurnStartByThreadId({
            threadId: event.payload.threadId,
          });
          if (Option.isSome(existingTurn)) {
            const nextState =
              existingTurn.value.state === "completed" || existingTurn.value.state === "error"
                ? existingTurn.value.state
                : "running";
            yield* projectionTurnRepository.upsertByTurnId({
              ...existingTurn.value,
              state: nextState,
              pendingMessageId:
                existingTurn.value.pendingMessageId ??
                (Option.isSome(pendingTurnStart) ? pendingTurnStart.value.messageId : null),
              sourceProposedPlanThreadId:
                existingTurn.value.sourceProposedPlanThreadId ??
                (Option.isSome(pendingTurnStart)
                  ? pendingTurnStart.value.sourceProposedPlanThreadId
                  : null),
              sourceProposedPlanId:
                existingTurn.value.sourceProposedPlanId ??
                (Option.isSome(pendingTurnStart)
                  ? pendingTurnStart.value.sourceProposedPlanId
                  : null),
              startedAt:
                existingTurn.value.startedAt ??
                (Option.isSome(pendingTurnStart)
                  ? pendingTurnStart.value.requestedAt
                  : event.occurredAt),
              requestedAt:
                existingTurn.value.requestedAt ??
                (Option.isSome(pendingTurnStart)
                  ? pendingTurnStart.value.requestedAt
                  : event.occurredAt),
            });
          } else {
            yield* projectionTurnRepository.upsertByTurnId({
              turnId,
              threadId: event.payload.threadId,
              pendingMessageId: Option.isSome(pendingTurnStart)
                ? pendingTurnStart.value.messageId
                : null,
              sourceProposedPlanThreadId: Option.isSome(pendingTurnStart)
                ? pendingTurnStart.value.sourceProposedPlanThreadId
                : null,
              sourceProposedPlanId: Option.isSome(pendingTurnStart)
                ? pendingTurnStart.value.sourceProposedPlanId
                : null,
              assistantMessageId: null,
              state: "running",
              requestedAt: Option.isSome(pendingTurnStart)
                ? pendingTurnStart.value.requestedAt
                : event.occurredAt,
              startedAt: Option.isSome(pendingTurnStart)
                ? pendingTurnStart.value.requestedAt
                : event.occurredAt,
              completedAt: null,
              checkpointTurnCount: null,
              checkpointRef: null,
              checkpointStatus: null,
              checkpointFiles: [],
            });
          }

          yield* projectionTurnRepository.deletePendingTurnStartByThreadId({
            threadId: event.payload.threadId,
          });
          return;
        }

        case "thread.message-sent": {
          if (event.payload.turnId === null || event.payload.role !== "assistant") {
            return;
          }
          const session = yield* projectionThreadSessionRepository.getByThreadId({
            threadId: event.payload.threadId,
          });
          const turnStillRunning =
            Option.isSome(session) &&
            session.value.status === "running" &&
            session.value.activeTurnId === event.payload.turnId;
          const settlesTurn = !event.payload.streaming && !turnStillRunning;
          const existingTurn = yield* projectionTurnRepository.getByTurnId({
            threadId: event.payload.threadId,
            turnId: event.payload.turnId,
          });
          if (Option.isSome(existingTurn)) {
            yield* projectionTurnRepository.upsertByTurnId({
              ...existingTurn.value,
              assistantMessageId: event.payload.messageId,
              state: settlesTurn
                ? existingTurn.value.state === "interrupted"
                  ? "interrupted"
                  : existingTurn.value.state === "error"
                    ? "error"
                    : "completed"
                : existingTurn.value.state,
              completedAt: settlesTurn
                ? (existingTurn.value.completedAt ?? event.payload.updatedAt)
                : existingTurn.value.completedAt,
              startedAt: existingTurn.value.startedAt ?? event.payload.createdAt,
              requestedAt: existingTurn.value.requestedAt ?? event.payload.createdAt,
            });
            return;
          }
          yield* projectionTurnRepository.upsertByTurnId({
            turnId: event.payload.turnId,
            threadId: event.payload.threadId,
            pendingMessageId: null,
            sourceProposedPlanThreadId: null,
            sourceProposedPlanId: null,
            assistantMessageId: event.payload.messageId,
            state: settlesTurn ? "completed" : "running",
            requestedAt: event.payload.createdAt,
            startedAt: event.payload.createdAt,
            completedAt: settlesTurn ? event.payload.updatedAt : null,
            checkpointTurnCount: null,
            checkpointRef: null,
            checkpointStatus: null,
            checkpointFiles: [],
          });
          return;
        }

        case "thread.turn-interrupt-requested": {
          if (event.payload.turnId === undefined) {
            return;
          }
          const existingTurn = yield* projectionTurnRepository.getByTurnId({
            threadId: event.payload.threadId,
            turnId: event.payload.turnId,
          });
          if (Option.isSome(existingTurn)) {
            yield* projectionTurnRepository.upsertByTurnId({
              ...existingTurn.value,
              state: "interrupted",
              completedAt: existingTurn.value.completedAt ?? event.payload.createdAt,
              startedAt: existingTurn.value.startedAt ?? event.payload.createdAt,
              requestedAt: existingTurn.value.requestedAt ?? event.payload.createdAt,
            });
            return;
          }
          yield* projectionTurnRepository.upsertByTurnId({
            turnId: event.payload.turnId,
            threadId: event.payload.threadId,
            pendingMessageId: null,
            sourceProposedPlanThreadId: null,
            sourceProposedPlanId: null,
            assistantMessageId: null,
            state: "interrupted",
            requestedAt: event.payload.createdAt,
            startedAt: event.payload.createdAt,
            completedAt: event.payload.createdAt,
            checkpointTurnCount: null,
            checkpointRef: null,
            checkpointStatus: null,
            checkpointFiles: [],
          });
          return;
        }

        case "thread.turn-diff-completed": {
          const session = yield* projectionThreadSessionRepository.getByThreadId({
            threadId: event.payload.threadId,
          });
          const turnStillRunning =
            Option.isSome(session) &&
            session.value.status === "running" &&
            session.value.activeTurnId === event.payload.turnId;
          const existingTurn = yield* projectionTurnRepository.getByTurnId({
            threadId: event.payload.threadId,
            turnId: event.payload.turnId,
          });
          const nextState = event.payload.status === "error" ? "error" : "completed";
          yield* projectionTurnRepository.clearCheckpointTurnConflict({
            threadId: event.payload.threadId,
            turnId: event.payload.turnId,
            checkpointTurnCount: event.payload.checkpointTurnCount,
          });

          if (Option.isSome(existingTurn)) {
            yield* projectionTurnRepository.upsertByTurnId({
              ...existingTurn.value,
              assistantMessageId: event.payload.assistantMessageId,
              state: turnStillRunning ? existingTurn.value.state : nextState,
              checkpointTurnCount: event.payload.checkpointTurnCount,
              checkpointRef: event.payload.checkpointRef,
              checkpointStatus: event.payload.status,
              checkpointFiles: event.payload.files,
              startedAt: existingTurn.value.startedAt ?? event.payload.completedAt,
              requestedAt: existingTurn.value.requestedAt ?? event.payload.completedAt,
              completedAt: event.payload.completedAt,
            });
            return;
          }
          yield* projectionTurnRepository.upsertByTurnId({
            turnId: event.payload.turnId,
            threadId: event.payload.threadId,
            pendingMessageId: null,
            sourceProposedPlanThreadId: null,
            sourceProposedPlanId: null,
            assistantMessageId: event.payload.assistantMessageId,
            state: turnStillRunning ? "running" : nextState,
            requestedAt: event.payload.completedAt,
            startedAt: event.payload.completedAt,
            completedAt: event.payload.completedAt,
            checkpointTurnCount: event.payload.checkpointTurnCount,
            checkpointRef: event.payload.checkpointRef,
            checkpointStatus: event.payload.status,
            checkpointFiles: event.payload.files,
          });
          return;
        }

        case "thread.reverted": {
          const existingTurns = yield* projectionTurnRepository.listByThreadId({
            threadId: event.payload.threadId,
          });
          const keptTurns = existingTurns.filter(
            (turn) =>
              turn.turnId !== null &&
              turn.checkpointTurnCount !== null &&
              turn.checkpointTurnCount <= event.payload.turnCount,
          );
          yield* projectionTurnRepository.deleteByThreadId({
            threadId: event.payload.threadId,
          });
          yield* Effect.forEach(
            keptTurns,
            (turn) =>
              turn.turnId === null
                ? Effect.void
                : projectionTurnRepository.upsertByTurnId({
                    ...turn,
                    turnId: turn.turnId,
                  }),
            { concurrency: 1 },
          ).pipe(Effect.asVoid);
          return;
        }

        case "thread.cleared":
          yield* projectionTurnRepository.deleteByThreadId({
            threadId: event.payload.threadId,
          });
          return;

        default:
          return;
      }
    });

    const applyCheckpointsProjection: ProjectorDefinition["apply"] = () => Effect.void;

    const applyPendingApprovalsProjection: ProjectorDefinition["apply"] = Effect.fn(
      "applyPendingApprovalsProjection",
    )(function* (event, _attachmentSideEffects) {
      switch (event.type) {
        case "thread.activity-appended": {
          const requestId =
            extractActivityRequestId(event.payload.activity.payload) ??
            event.metadata.requestId ??
            null;
          if (requestId === null) {
            return;
          }
          const existingRow = yield* projectionPendingApprovalRepository.getByRequestId({
            requestId,
          });
          if (event.payload.activity.kind === "approval.resolved") {
            const resolvedDecisionRaw =
              typeof event.payload.activity.payload === "object" &&
              event.payload.activity.payload !== null &&
              "decision" in event.payload.activity.payload
                ? (event.payload.activity.payload as { decision?: unknown }).decision
                : null;
            const resolvedDecision =
              resolvedDecisionRaw === "accept" ||
              resolvedDecisionRaw === "acceptForSession" ||
              resolvedDecisionRaw === "decline" ||
              resolvedDecisionRaw === "cancel"
                ? resolvedDecisionRaw
                : null;
            yield* projectionPendingApprovalRepository.upsert({
              requestId,
              threadId: Option.isSome(existingRow)
                ? existingRow.value.threadId
                : event.payload.threadId,
              turnId: Option.isSome(existingRow)
                ? existingRow.value.turnId
                : event.payload.activity.turnId,
              status: "resolved",
              decision: resolvedDecision,
              createdAt: Option.isSome(existingRow)
                ? existingRow.value.createdAt
                : event.payload.activity.createdAt,
              resolvedAt: event.payload.activity.createdAt,
            });
            return;
          }
          if (event.payload.activity.kind === "provider.approval.respond.failed") {
            const payload =
              typeof event.payload.activity.payload === "object" &&
              event.payload.activity.payload !== null
                ? (event.payload.activity.payload as Record<string, unknown>)
                : null;
            const detail =
              typeof payload?.detail === "string" ? payload.detail.toLowerCase() : null;
            if (isStalePendingApprovalFailureDetail(detail)) {
              if (Option.isNone(existingRow)) {
                return;
              }
              if (existingRow.value.status === "resolved") {
                return;
              }
              yield* projectionPendingApprovalRepository.upsert({
                requestId,
                threadId: existingRow.value.threadId,
                turnId: existingRow.value.turnId,
                status: "resolved",
                decision: null,
                createdAt: existingRow.value.createdAt,
                resolvedAt: event.payload.activity.createdAt,
              });
              return;
            }
            return;
          }
          // Only approval-requested activities should create pending-approval
          // rows.  Other activity kinds that happen to carry a requestId
          // (e.g. user-input.requested / user-input.resolved) must not
          // pollute this projection — they have their own accounting via
          // derivePendingUserInputCountFromActivities.
          if (event.payload.activity.kind !== "approval.requested") {
            return;
          }
          if (Option.isSome(existingRow) && existingRow.value.status === "resolved") {
            return;
          }
          yield* projectionPendingApprovalRepository.upsert({
            requestId,
            threadId: event.payload.threadId,
            turnId: event.payload.activity.turnId,
            status: "pending",
            decision: null,
            createdAt: Option.isSome(existingRow)
              ? existingRow.value.createdAt
              : event.payload.activity.createdAt,
            resolvedAt: null,
          });
          return;
        }

        case "thread.approval-response-requested": {
          const existingRow = yield* projectionPendingApprovalRepository.getByRequestId({
            requestId: event.payload.requestId,
          });
          yield* projectionPendingApprovalRepository.upsert({
            requestId: event.payload.requestId,
            threadId: Option.isSome(existingRow)
              ? existingRow.value.threadId
              : event.payload.threadId,
            turnId: Option.isSome(existingRow) ? existingRow.value.turnId : null,
            status: "resolved",
            decision: event.payload.decision,
            createdAt: Option.isSome(existingRow)
              ? existingRow.value.createdAt
              : event.payload.createdAt,
            resolvedAt: event.payload.createdAt,
          });
          return;
        }

        case "thread.cleared": {
          const existingRows = yield* projectionPendingApprovalRepository.listByThreadId({
            threadId: event.payload.threadId,
          });
          yield* Effect.forEach(
            existingRows,
            (row) =>
              projectionPendingApprovalRepository.deleteByRequestId({ requestId: row.requestId }),
            { concurrency: 1 },
          ).pipe(Effect.asVoid);
          return;
        }

        default:
          return;
      }
    });

    const applyHelperRunsProjection: ProjectorDefinition["apply"] = Effect.fn(
      "applyHelperRunsProjection",
    )(function* (event, _attachmentSideEffects) {
      if (event.type === "helper.run-requested") {
        yield* projectionHelperRunRepository.upsert({
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
        });
        return;
      }
      if (
        event.type !== "helper.run-started" &&
        event.type !== "helper.run-completed" &&
        event.type !== "helper.run-failed" &&
        event.type !== "helper.run-interrupted"
      ) {
        return;
      }
      const existing = yield* projectionHelperRunRepository.getById({
        helperRunId: event.payload.helperRunId,
      });
      if (Option.isNone(existing)) return;
      if (event.type === "helper.run-started") {
        yield* projectionHelperRunRepository.upsert({
          ...existing.value,
          status: "running",
          providerThreadId: event.payload.providerThreadId,
          startedAt: event.payload.startedAt,
          updatedAt: event.payload.updatedAt,
        });
        return;
      }
      if (event.type === "helper.run-completed") {
        yield* projectionHelperRunRepository.upsert({
          ...existing.value,
          status: "completed",
          result: event.payload.result,
          failureMessage: null,
          completedAt: event.payload.completedAt,
          updatedAt: event.payload.updatedAt,
        });
        return;
      }
      if (event.type === "helper.run-failed") {
        yield* projectionHelperRunRepository.upsert({
          ...existing.value,
          status: "failed",
          failureMessage: event.payload.message,
          completedAt: event.payload.failedAt,
          updatedAt: event.payload.updatedAt,
        });
        return;
      }
      yield* projectionHelperRunRepository.upsert({
        ...existing.value,
        status: "interrupted",
        completedAt: event.payload.interruptedAt,
        updatedAt: event.payload.updatedAt,
      });
    });

    const applyProjectContextRunsProjection: ProjectorDefinition["apply"] = Effect.fn(
      "applyProjectContextRunsProjection",
    )(function* (event, _attachmentSideEffects) {
      if (event.type === "project.context-run-requested") {
        yield* projectionProjectContextRunRepository.upsert({
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
        });
        return;
      }
      if (
        event.type !== "project.context-run-started" &&
        event.type !== "project.context-run-start-prepared" &&
        event.type !== "project.context-run-baseline-refreshed" &&
        event.type !== "project.context-run-pending-review" &&
        event.type !== "project.context-run-revised" &&
        event.type !== "project.context-run-committed" &&
        event.type !== "project.context-run-discarded" &&
        event.type !== "project.context-run-failed" &&
        event.type !== "project.context-run-interrupted"
      ) {
        return;
      }
      const existing = yield* projectionProjectContextRunRepository.getById({
        projectContextRunId: event.payload.projectContextRunId,
      });
      if (Option.isNone(existing)) return;
      if (event.type === "project.context-run-start-prepared") {
        yield* projectionProjectContextRunRepository.upsert({
          ...existing.value,
          pmStartState: event.payload.pmStartState,
          updatedAt: event.payload.updatedAt,
        });
        return;
      }
      if (event.type === "project.context-run-baseline-refreshed") {
        yield* projectionProjectContextRunRepository.upsert({
          ...existing.value,
          schemaVersion: event.payload.schemaVersion,
          fingerprint: event.payload.fingerprint,
          baselineManifest: event.payload.baselineManifest,
          workspaceStatusManifest: event.payload.workspaceStatusManifest,
          gitState: event.payload.gitState,
          pmStartState: "ready",
          updatedAt: event.payload.updatedAt,
        });
        return;
      }
      if (event.type === "project.context-run-started") {
        yield* projectionProjectContextRunRepository.upsert({
          ...existing.value,
          status: "running",
          providerThreadId: event.payload.providerThreadId,
          startedAt: event.payload.startedAt,
          updatedAt: event.payload.updatedAt,
        });
        return;
      }
      if (event.type === "project.context-run-pending-review") {
        yield* projectionProjectContextRunRepository.upsert({
          ...existing.value,
          status: "pending-review",
          result: event.payload.result,
          failureMessage: null,
          changes: event.payload.changes,
          scopeViolationPaths: event.payload.scopeViolationPaths,
          pendingReviewAt: event.payload.pendingReviewAt,
          updatedAt: event.payload.updatedAt,
        });
        return;
      }
      if (event.type === "project.context-run-revised") {
        yield* projectionProjectContextRunRepository.upsert({
          ...existing.value,
          status: "pending",
          pmStartState: "ready",
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
        });
        return;
      }
      if (event.type === "project.context-run-committed") {
        yield* projectionProjectContextRunRepository.upsert({
          ...existing.value,
          status: "completed",
          resolution: "committed",
          commitHash: event.payload.commitHash,
          resultSchemaVersion: event.payload.resultSchemaVersion,
          resultFingerprint: event.payload.resultFingerprint,
          resolvedAt: event.payload.resolvedAt,
          updatedAt: event.payload.updatedAt,
        });
        return;
      }
      if (event.type === "project.context-run-discarded") {
        yield* projectionProjectContextRunRepository.upsert({
          ...existing.value,
          status: "discarded",
          resolution: "discarded",
          commitHash: null,
          resultSchemaVersion: event.payload.resultSchemaVersion,
          resultFingerprint: event.payload.resultFingerprint,
          resolvedAt: event.payload.resolvedAt,
          updatedAt: event.payload.updatedAt,
        });
        return;
      }
      if (event.type === "project.context-run-failed") {
        yield* projectionProjectContextRunRepository.upsert({
          ...existing.value,
          status: "failed",
          failureMessage: event.payload.message,
          failedAt: event.payload.failedAt,
          updatedAt: event.payload.updatedAt,
        });
        return;
      }
      yield* projectionProjectContextRunRepository.upsert({
        ...existing.value,
        status: "interrupted",
        interruptedAt: event.payload.interruptedAt,
        updatedAt: event.payload.updatedAt,
      });
    });

    // Task aggregate projector (Plan 018 WP-D). `status` is computed here from
    // the event being applied + the current row — never taken from a command or
    // payload status field. The derivation is the same deterministic left-fold
    // implemented in the in-memory `projector.ts` (design §5):
    //   created → draft; classified → classified;
    //   stage-started(classify) → classified; stage-started(plan) → planning;
    //   stage-started(review) → reviewing; stage-started(work) → working;
    //   stage-started(verify) → verifying; stage-completed(work) → review;
    //   gate-requested(plan) → plan-review; gate-requested(land) → review;
    //   gate-resolved(plan, approved) → planning;
    //   gate-resolved(plan, rejected) → blocked;
    //   gate-resolved(land, rejected) → blocked;
    //   landed → landed; abandoned → abandoned.
    const applyTasksProjection: ProjectorDefinition["apply"] = Effect.fn("applyTasksProjection")(
      function* (event, _attachmentSideEffects) {
        switch (event.type) {
          case "task.created":
            yield* projectionTaskRepository.upsert({
              taskId: event.payload.taskId,
              projectId: event.payload.projectId,
              type: event.payload.taskType,
              title: event.payload.title,
              status: "draft",
              branch: event.payload.branch,
              worktreePath: event.payload.worktreePath,
              prUrl: null,
              pmMessageId: event.payload.pmMessageId,
              stageThreadIds: [],
              currentStageThreadId: null,
              parentTaskId: event.payload.parentTaskId ?? null,
              childOrder: event.payload.childOrder ?? null,
              aggregateProgress: null,
              acceptanceCriteria: event.payload.acceptanceCriteria ?? [],
              dependsOnTaskIds: event.payload.dependsOnTaskIds ?? [],
              supersedesTaskId: event.payload.supersedesTaskId ?? null,
              supersededByTaskId: null,
              cancellation: null,
              changeReview: null,
              verification: null,
              noChangesNeeded: null,
              landing: null,
              releaseDispatch: null,
              roleCapabilityTiers: {},
              playbookVersion: event.payload.playbookVersion,
              createdAt: event.payload.createdAt,
              updatedAt: event.payload.updatedAt,
              archivedAt: null,
              deletedAt: null,
            });
            if (event.payload.supersedesTaskId) {
              const predecessor = yield* projectionTaskRepository.getById({
                taskId: event.payload.supersedesTaskId,
              });
              if (Option.isSome(predecessor)) {
                yield* projectionTaskRepository.upsert({
                  ...predecessor.value,
                  supersededByTaskId: event.payload.taskId,
                  updatedAt: event.payload.updatedAt,
                });
              }
            }
            return;

          case "task.classified": {
            const existingRow = yield* projectionTaskRepository.getById({
              taskId: event.payload.taskId,
            });
            if (Option.isNone(existingRow)) {
              return;
            }
            yield* projectionTaskRepository.upsert({
              ...existingRow.value,
              status: "classified",
              type: event.payload.taskType,
              playbookVersion: event.payload.playbookVersion,
              updatedAt: event.payload.updatedAt,
            });
            return;
          }

          case "task.split": {
            const existingRow = yield* projectionTaskRepository.getById({
              taskId: event.payload.taskId,
            });
            if (Option.isNone(existingRow)) return;
            yield* projectionTaskRepository.upsert({
              ...existingRow.value,
              branch: null,
              worktreePath: null,
              updatedAt: event.payload.updatedAt,
            });
            return;
          }

          case "task.capability-tiers-updated": {
            const existingRow = yield* projectionTaskRepository.getById({
              taskId: event.payload.taskId,
            });
            if (Option.isNone(existingRow)) {
              return;
            }
            yield* projectionTaskRepository.upsert({
              ...existingRow.value,
              roleCapabilityTiers: event.payload.roleCapabilityTiers,
              updatedAt: event.payload.updatedAt,
            });
            return;
          }

          case "task.archived": {
            const existingRow = yield* projectionTaskRepository.getById({
              taskId: event.payload.taskId,
            });
            if (Option.isNone(existingRow)) {
              return;
            }
            yield* projectionTaskRepository.upsert({
              ...existingRow.value,
              archivedAt: event.payload.archivedAt,
              updatedAt: event.payload.updatedAt,
            });
            return;
          }

          case "task.restored": {
            const existingRow = yield* projectionTaskRepository.getById({
              taskId: event.payload.taskId,
            });
            if (Option.isNone(existingRow)) {
              return;
            }
            yield* projectionTaskRepository.upsert({
              ...existingRow.value,
              archivedAt: null,
              updatedAt: event.payload.updatedAt,
            });
            return;
          }

          case "task.deleted": {
            const existingRow = yield* projectionTaskRepository.getById({
              taskId: event.payload.taskId,
            });
            if (Option.isNone(existingRow)) {
              return;
            }
            yield* projectionTaskRepository.upsert({
              ...existingRow.value,
              deletedAt: event.payload.deletedAt,
              updatedAt: event.payload.updatedAt,
            });
            return;
          }

          case "task.stage-started": {
            const existingRow = yield* projectionTaskRepository.getById({
              taskId: event.payload.taskId,
            });
            if (Option.isNone(existingRow)) {
              return;
            }
            const status = taskStatusForStageRole(event.payload.role);
            const stageThreadIds = existingRow.value.stageThreadIds.includes(
              event.payload.stageThreadId,
            )
              ? existingRow.value.stageThreadIds
              : [...existingRow.value.stageThreadIds, event.payload.stageThreadId];
            yield* projectionTaskRepository.upsert({
              ...existingRow.value,
              status,
              stageThreadIds,
              currentStageThreadId: event.payload.stageThreadId,
              ...(event.payload.role === "work" ? { verification: null } : {}),
              updatedAt: event.payload.updatedAt,
            });
            return;
          }

          case "task.stage-completed": {
            const existingRow = yield* projectionTaskRepository.getById({
              taskId: event.payload.taskId,
            });
            if (Option.isNone(existingRow)) {
              return;
            }
            yield* projectionTaskRepository.upsert({
              ...existingRow.value,
              ...(event.payload.role === "work" ? { status: "review" as const } : {}),
              currentStageThreadId: null,
              updatedAt: event.payload.updatedAt,
            });
            return;
          }

          case "task.change-review-requested": {
            const existingRow = yield* projectionTaskRepository.getById({
              taskId: event.payload.taskId,
            });
            if (Option.isNone(existingRow)) return;
            yield* projectionTaskRepository.upsert({
              ...existingRow.value,
              status: "change-review",
              changeReview: {
                status: "pending",
                workStageThreadId: event.payload.workStageThreadId,
                detectedHead: event.payload.detectedHead,
                resolution: null,
                requestedAt: event.payload.requestedAt,
                resolvedAt: null,
              },
              verification: null,
              updatedAt: event.payload.updatedAt,
            });
            return;
          }

          case "task.change-review-resolved": {
            const existingRow = yield* projectionTaskRepository.getById({
              taskId: event.payload.taskId,
            });
            if (Option.isNone(existingRow) || existingRow.value.changeReview === null) return;
            yield* projectionTaskRepository.upsert({
              ...existingRow.value,
              status:
                existingRow.value.currentStageThreadId === null
                  ? "review"
                  : existingRow.value.status,
              changeReview: {
                ...existingRow.value.changeReview,
                status: "resolved",
                resolution: event.payload.resolution,
                resolvedAt: event.payload.resolvedAt,
              },
              verification: null,
              updatedAt: event.payload.updatedAt,
            });
            return;
          }

          case "task.verification-recorded": {
            const existingRow = yield* projectionTaskRepository.getById({
              taskId: event.payload.taskId,
            });
            if (Option.isNone(existingRow)) return;
            yield* projectionTaskRepository.upsert({
              ...existingRow.value,
              status: "review",
              verification: {
                stageThreadId: event.payload.stageThreadId,
                head: event.payload.head,
                verifiedAt: event.payload.verifiedAt,
              },
              updatedAt: event.payload.updatedAt,
            });
            return;
          }

          case "task.no-changes-needed": {
            const existingRow = yield* projectionTaskRepository.getById({
              taskId: event.payload.taskId,
            });
            if (Option.isNone(existingRow)) return;
            yield* projectionTaskRepository.upsert({
              ...existingRow.value,
              status: "no-changes-needed",
              currentStageThreadId: null,
              noChangesNeeded: {
                baseHead: event.payload.baseHead,
                head: event.payload.head,
                completedAt: event.payload.completedAt,
              },
              updatedAt: event.payload.updatedAt,
            });
            return;
          }

          case "task.stage-blocked": {
            const existingRow = yield* projectionTaskRepository.getById({
              taskId: event.payload.taskId,
            });
            if (Option.isNone(existingRow)) {
              return;
            }
            yield* projectionTaskRepository.upsert({
              ...existingRow.value,
              status: "blocked-on-quota",
              currentStageThreadId: null,
              updatedAt: event.payload.updatedAt,
            });
            return;
          }

          case "task.stage-interrupted": {
            const existingRow = yield* projectionTaskRepository.getById({
              taskId: event.payload.taskId,
            });
            if (Option.isNone(existingRow)) {
              return;
            }
            yield* projectionTaskRepository.upsert({
              ...existingRow.value,
              status: "blocked",
              currentStageThreadId: null,
              updatedAt: event.payload.updatedAt,
            });
            return;
          }

          case "task.gate-requested": {
            const existingRow = yield* projectionTaskRepository.getById({
              taskId: event.payload.taskId,
            });
            if (Option.isNone(existingRow)) {
              return;
            }
            yield* projectionTaskRepository.upsert({
              ...existingRow.value,
              ...(event.payload.gate === "plan"
                ? { status: "plan-review" as const }
                : event.payload.gate === "land"
                  ? { status: "review" as const }
                  : {}),
              updatedAt: event.payload.updatedAt,
            });
            return;
          }

          case "task.gate-resolved": {
            const existingRow = yield* projectionTaskRepository.getById({
              taskId: event.payload.taskId,
            });
            if (Option.isNone(existingRow)) {
              return;
            }
            const nextStatus =
              event.payload.gate === "plan"
                ? event.payload.decision === "approved"
                  ? ("planning" as const)
                  : ("blocked" as const)
                : event.payload.gate === "land" && event.payload.decision === "rejected"
                  ? ("blocked" as const)
                  : null;
            yield* projectionTaskRepository.upsert({
              ...existingRow.value,
              ...(nextStatus !== null ? { status: nextStatus } : {}),
              updatedAt: event.payload.updatedAt,
            });
            return;
          }

          case "task.landed": {
            const existingRow = yield* projectionTaskRepository.getById({
              taskId: event.payload.taskId,
            });
            if (Option.isNone(existingRow)) {
              return;
            }
            yield* projectionTaskRepository.upsert({
              ...existingRow.value,
              status: "landed",
              landing: {
                status: "opening-pr",
                failureMessage: null,
                branchPushed: false,
                updatedAt: event.payload.updatedAt,
              },
              updatedAt: event.payload.updatedAt,
            });
            return;
          }

          case "task.landing-retry-requested": {
            const existingRow = yield* projectionTaskRepository.getById({
              taskId: event.payload.taskId,
            });
            if (Option.isNone(existingRow)) {
              return;
            }
            yield* projectionTaskRepository.upsert({
              ...existingRow.value,
              landing: {
                status: "opening-pr",
                failureMessage: null,
                branchPushed: false,
                updatedAt: event.payload.updatedAt,
              },
              updatedAt: event.payload.updatedAt,
            });
            return;
          }

          case "task.release-dispatch-requested": {
            const existingRow = yield* projectionTaskRepository.getById({
              taskId: event.payload.taskId,
            });
            if (Option.isNone(existingRow)) return;
            yield* projectionTaskRepository.upsert({
              ...existingRow.value,
              releaseDispatch: {
                status: "dispatching",
                workflow: event.payload.workflow,
                ref: event.payload.ref,
                inputs: event.payload.inputs,
                contentHash: event.payload.contentHash,
                workflowUrl: null,
                failureMessage: null,
                requestedAt: event.payload.requestedAt,
                updatedAt: event.payload.updatedAt,
              },
              updatedAt: event.payload.updatedAt,
            });
            return;
          }

          case "task.release-dispatched":
          case "task.release-dispatch-failed": {
            const existingRow = yield* projectionTaskRepository.getById({
              taskId: event.payload.taskId,
            });
            if (Option.isNone(existingRow) || existingRow.value.releaseDispatch === null) return;
            yield* projectionTaskRepository.upsert({
              ...existingRow.value,
              releaseDispatch: {
                ...existingRow.value.releaseDispatch,
                status: event.type === "task.release-dispatched" ? "dispatched" : "failed",
                workflowUrl:
                  event.type === "task.release-dispatched"
                    ? event.payload.workflowUrl
                    : existingRow.value.releaseDispatch.workflowUrl,
                failureMessage:
                  event.type === "task.release-dispatch-failed" ? event.payload.message : null,
                updatedAt: event.payload.updatedAt,
              },
              updatedAt: event.payload.updatedAt,
            });
            return;
          }

          case "task.cancellation-requested": {
            const existingRow = yield* projectionTaskRepository.getById({
              taskId: event.payload.taskId,
            });
            if (Option.isNone(existingRow)) return;
            yield* projectionTaskRepository.upsert({
              ...existingRow.value,
              cancellation: {
                requestedAt: event.payload.requestedAt,
                completedPhases: [],
                failurePhase: null,
                failureMessage: null,
                failedAt: null,
              },
              updatedAt: event.payload.updatedAt,
            });
            return;
          }

          case "task.cancellation-failed": {
            const existingRow = yield* projectionTaskRepository.getById({
              taskId: event.payload.taskId,
            });
            if (Option.isNone(existingRow) || existingRow.value.cancellation === null) return;
            yield* projectionTaskRepository.upsert({
              ...existingRow.value,
              cancellation: {
                ...existingRow.value.cancellation,
                failurePhase: event.payload.phase,
                failureMessage: event.payload.message,
                failedAt: event.payload.failedAt,
              },
              updatedAt: event.payload.updatedAt,
            });
            return;
          }

          case "task.cancellation-phase-completed": {
            const existingRow = yield* projectionTaskRepository.getById({
              taskId: event.payload.taskId,
            });
            if (Option.isNone(existingRow) || existingRow.value.cancellation === null) return;
            yield* projectionTaskRepository.upsert({
              ...existingRow.value,
              cancellation: {
                ...existingRow.value.cancellation,
                completedPhases: Array.from(
                  new Set([
                    ...(existingRow.value.cancellation.completedPhases ?? []),
                    event.payload.phase,
                  ]),
                ),
                failurePhase: null,
                failureMessage: null,
                failedAt: null,
              },
              updatedAt: event.payload.updatedAt,
            });
            return;
          }

          case "task.pr-opened": {
            const existingRow = yield* projectionTaskRepository.getById({
              taskId: event.payload.taskId,
            });
            if (Option.isNone(existingRow)) {
              return;
            }
            yield* projectionTaskRepository.upsert({
              ...existingRow.value,
              prUrl: event.payload.prUrl,
              landing: {
                status: "completed",
                failureMessage: null,
                branchPushed: true,
                updatedAt: event.payload.updatedAt,
              },
              updatedAt: event.payload.updatedAt,
            });
            return;
          }

          case "task.pr-open-failed": {
            const existingRow = yield* projectionTaskRepository.getById({
              taskId: event.payload.taskId,
            });
            if (Option.isNone(existingRow)) {
              return;
            }
            yield* projectionTaskRepository.upsert({
              ...existingRow.value,
              landing: {
                status: "failed",
                failureMessage: event.payload.message,
                branchPushed: event.payload.branchPushed,
                updatedAt: event.payload.updatedAt,
              },
              updatedAt: event.payload.updatedAt,
            });
            return;
          }

          case "task.abandoned": {
            const existingRow = yield* projectionTaskRepository.getById({
              taskId: event.payload.taskId,
            });
            if (Option.isNone(existingRow)) {
              return;
            }
            yield* projectionTaskRepository.upsert({
              ...existingRow.value,
              status: "abandoned",
              currentStageThreadId: null,
              cancellation:
                existingRow.value.cancellation === null
                  ? null
                  : {
                      ...existingRow.value.cancellation,
                      failurePhase: null,
                      failureMessage: null,
                      failedAt: null,
                    },
              updatedAt: event.payload.updatedAt,
            });
            return;
          }

          default:
            return;
        }
      },
    );

    const applyStageHistoryProjection: ProjectorDefinition["apply"] = Effect.fn(
      "applyStageHistoryProjection",
    )(function* (event, _attachmentSideEffects) {
      switch (event.type) {
        case "task.stage-started": {
          const task = yield* projectionTaskRepository.getById({
            taskId: event.payload.taskId,
          });
          if (Option.isNone(task)) {
            return;
          }
          // Prefer the backend/model stamped on the event; fall back to
          // re-deriving from config for events appended before the payload
          // carried them (append-only compatibility).
          const project = yield* projectionProjectRepository.getById({
            projectId: task.value.projectId,
          });
          const fallbackSelection = Option.isNone(project)
            ? null
            : resolveStageModelSelection({
                project: project.value,
                role: event.payload.role,
              });
          const providerInstanceId =
            event.payload.providerInstanceId ?? fallbackSelection?.instanceId;
          const model = event.payload.model ?? fallbackSelection?.model;
          const modelOptions = event.payload.modelOptions ?? fallbackSelection?.options ?? null;
          if (providerInstanceId === undefined || model === undefined) {
            return;
          }
          yield* projectionStageHistoryRepository.upsert({
            projectId: task.value.projectId,
            taskId: event.payload.taskId,
            stageThreadId: event.payload.stageThreadId,
            role: event.payload.role,
            capabilityTier: event.payload.capabilityTier ?? null,
            providerInstanceId,
            model,
            modelOptions,
            ...(event.payload.runtimeMode === undefined
              ? {}
              : { runtimeMode: event.payload.runtimeMode }),
            status: "running",
            startedAt: event.payload.updatedAt,
            endedAt: null,
          });
          return;
        }

        case "thread.created": {
          const existing = yield* projectionStageHistoryRepository.getByStageThreadId({
            stageThreadId: event.payload.threadId,
          });
          if (Option.isNone(existing)) {
            return;
          }
          yield* projectionStageHistoryRepository.upsert({
            ...existing.value,
            runtimeMode: event.payload.runtimeMode,
          });
          return;
        }

        case "task.stage-completed": {
          const existing = yield* projectionStageHistoryRepository.getByStageThreadId({
            stageThreadId: event.payload.stageThreadId,
          });
          if (Option.isNone(existing)) {
            return;
          }
          yield* projectionStageHistoryRepository.upsert({
            ...existing.value,
            status: "completed",
            endedAt: event.payload.updatedAt,
          });
          return;
        }

        case "task.stage-blocked": {
          const existing = yield* projectionStageHistoryRepository.getByStageThreadId({
            stageThreadId: event.payload.stageThreadId,
          });
          if (Option.isNone(existing)) {
            return;
          }
          yield* projectionStageHistoryRepository.upsert({
            ...existing.value,
            providerInstanceId: event.payload.providerInstanceId,
            status: "blocked",
            endedAt: event.payload.updatedAt,
          });
          return;
        }

        case "task.stage-interrupted": {
          const existing = yield* projectionStageHistoryRepository.getByStageThreadId({
            stageThreadId: event.payload.stageThreadId,
          });
          if (Option.isNone(existing)) {
            return;
          }
          yield* projectionStageHistoryRepository.upsert({
            ...existing.value,
            status: "interrupted",
            endedAt: event.payload.updatedAt,
          });
          return;
        }

        default:
          return;
      }
    });

    // Awaited-stages reconciliation source (migration 034). A stage-started
    // with a non-null `awaitedTurnId` opens an `awaited` row; the matching
    // stage-completed marks it `completed`; quota blocking and orphan recovery
    // settle it as `blocked` or `interrupted`. Stages started without an awaited
    // turn (nothing to reconcile) are not recorded.
    const applyAwaitedStagesProjection: ProjectorDefinition["apply"] = Effect.fn(
      "applyAwaitedStagesProjection",
    )(function* (event, _attachmentSideEffects) {
      switch (event.type) {
        case "task.stage-started": {
          if (event.payload.awaitedTurnId === null) {
            return;
          }
          yield* projectionAwaitedStageRepository.upsert({
            taskId: event.payload.taskId,
            stageThreadId: event.payload.stageThreadId,
            role: event.payload.role,
            awaitedTurnId: event.payload.awaitedTurnId,
            status: "awaited",
            startedAt: event.payload.updatedAt,
            completedAt: null,
          });
          return;
        }

        case "task.stage-completed": {
          const rows = yield* projectionAwaitedStageRepository.listByTaskId({
            taskId: event.payload.taskId,
          });
          const existing = rows.find((row) => row.stageThreadId === event.payload.stageThreadId);
          if (!existing) {
            return;
          }
          yield* projectionAwaitedStageRepository.upsert({
            ...existing,
            status: "completed",
            completedAt: event.payload.updatedAt,
          });
          return;
        }

        case "task.stage-blocked": {
          const rows = yield* projectionAwaitedStageRepository.listByTaskId({
            taskId: event.payload.taskId,
          });
          const existing = rows.find((row) => row.stageThreadId === event.payload.stageThreadId);
          if (!existing) {
            return;
          }
          yield* projectionAwaitedStageRepository.upsert({
            ...existing,
            status: "blocked",
            completedAt: event.payload.updatedAt,
          });
          return;
        }

        case "task.stage-interrupted": {
          const rows = yield* projectionAwaitedStageRepository.listByTaskId({
            taskId: event.payload.taskId,
          });
          const existing = rows.find((row) => row.stageThreadId === event.payload.stageThreadId);
          if (!existing) {
            return;
          }
          yield* projectionAwaitedStageRepository.upsert({
            ...existing,
            status: "interrupted",
            completedAt: event.payload.updatedAt,
          });
          return;
        }

        default:
          return;
      }
    });

    const applyQuotaBlockedStagesProjection: ProjectorDefinition["apply"] = Effect.fn(
      "applyQuotaBlockedStagesProjection",
    )(function* (event, _attachmentSideEffects) {
      switch (event.type) {
        case "task.stage-blocked": {
          const rows = yield* projectionQuotaBlockedStageRepository.listByTaskId({
            taskId: event.payload.taskId,
          });
          const retryCount = rows.filter((row) => row.role === event.payload.role).length + 1;
          yield* projectionQuotaBlockedStageRepository.upsert({
            taskId: event.payload.taskId,
            stageThreadId: event.payload.stageThreadId,
            role: event.payload.role,
            providerInstanceId: event.payload.providerInstanceId,
            resetAt: event.payload.resetAt ?? null,
            status: "blocked",
            retryCount,
            blockedAt: event.payload.updatedAt,
            resumedAt: null,
          });
          return;
        }

        case "task.stage-started": {
          const rows = yield* projectionQuotaBlockedStageRepository.listByTaskId({
            taskId: event.payload.taskId,
          });
          const blocked = rows
            .filter((row) => row.role === event.payload.role && row.status === "blocked")
            .toSorted(
              (left, right) =>
                right.blockedAt.localeCompare(left.blockedAt) ||
                right.stageThreadId.localeCompare(left.stageThreadId),
            )[0];
          if (!blocked) {
            return;
          }
          yield* projectionQuotaBlockedStageRepository.upsert({
            ...blocked,
            status: "resumed",
            resumedAt: event.payload.updatedAt,
          });
          return;
        }

        default:
          return;
      }
    });

    // Pending-gates reconciliation source (migration 034). A gate-requested
    // opens a `pending` row; a gate-resolved settles it to `resolved`,
    // recording the decision/origin/approvedHash. The decider rejects
    // PM-runtime origin (WP-E); the projector trusts the validated event.
    const applyPendingGatesProjection: ProjectorDefinition["apply"] = Effect.fn(
      "applyPendingGatesProjection",
    )(function* (event, _attachmentSideEffects) {
      switch (event.type) {
        case "task.gate-requested": {
          const existingRow = yield* projectionPendingGateRepository.getByGateId({
            gateId: event.payload.gateId,
          });
          yield* projectionPendingGateRepository.upsert({
            gateId: event.payload.gateId,
            taskId: event.payload.taskId,
            gate: event.payload.gate,
            contentHash: event.payload.contentHash,
            stageThreadId: event.payload.stageThreadId,
            status: "pending",
            approvedHash: Option.isSome(existingRow) ? existingRow.value.approvedHash : null,
            decision: Option.isSome(existingRow) ? existingRow.value.decision : null,
            origin: Option.isSome(existingRow) ? existingRow.value.origin : null,
            requestedAt: Option.isSome(existingRow)
              ? existingRow.value.requestedAt
              : event.payload.updatedAt,
            resolvedAt: Option.isSome(existingRow) ? existingRow.value.resolvedAt : null,
          });
          return;
        }

        case "task.gate-resolved": {
          const existingRow = yield* projectionPendingGateRepository.getByGateId({
            gateId: event.payload.gateId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }
          yield* projectionPendingGateRepository.upsert({
            ...existingRow.value,
            status: "resolved",
            approvedHash: event.payload.approvedHash,
            decision: event.payload.decision,
            origin: event.payload.origin,
            resolvedAt: event.payload.updatedAt,
          });
          return;
        }

        default:
          return;
      }
    });

    const projectors: ReadonlyArray<ProjectorDefinition> = [
      {
        name: ORCHESTRATION_PROJECTOR_NAMES.projects,
        apply: applyProjectsProjection,
      },
      {
        name: ORCHESTRATION_PROJECTOR_NAMES.threadMessages,
        apply: applyThreadMessagesProjection,
      },
      {
        name: ORCHESTRATION_PROJECTOR_NAMES.threadProposedPlans,
        apply: applyThreadProposedPlansProjection,
      },
      {
        name: ORCHESTRATION_PROJECTOR_NAMES.threadActivities,
        apply: applyThreadActivitiesProjection,
      },
      {
        name: ORCHESTRATION_PROJECTOR_NAMES.threadSessions,
        apply: applyThreadSessionsProjection,
      },
      {
        name: ORCHESTRATION_PROJECTOR_NAMES.threadTurns,
        apply: applyThreadTurnsProjection,
      },
      {
        name: ORCHESTRATION_PROJECTOR_NAMES.checkpoints,
        apply: applyCheckpointsProjection,
      },
      {
        name: ORCHESTRATION_PROJECTOR_NAMES.pendingApprovals,
        apply: applyPendingApprovalsProjection,
      },
      {
        name: ORCHESTRATION_PROJECTOR_NAMES.tasks,
        apply: applyTasksProjection,
      },
      {
        name: ORCHESTRATION_PROJECTOR_NAMES.helperRuns,
        apply: applyHelperRunsProjection,
      },
      {
        name: ORCHESTRATION_PROJECTOR_NAMES.projectContextRuns,
        apply: applyProjectContextRunsProjection,
      },
      {
        name: ORCHESTRATION_PROJECTOR_NAMES.stageHistory,
        apply: applyStageHistoryProjection,
      },
      {
        name: ORCHESTRATION_PROJECTOR_NAMES.awaitedStages,
        apply: applyAwaitedStagesProjection,
      },
      {
        name: ORCHESTRATION_PROJECTOR_NAMES.quotaBlockedStages,
        apply: applyQuotaBlockedStagesProjection,
      },
      {
        name: ORCHESTRATION_PROJECTOR_NAMES.pendingGates,
        apply: applyPendingGatesProjection,
      },
      {
        name: ORCHESTRATION_PROJECTOR_NAMES.threads,
        apply: applyThreadsProjection,
      },
    ];

    const runProjectorForEvent = Effect.fn("runProjectorForEvent")(function* (
      projector: ProjectorDefinition,
      event: OrchestrationEvent,
    ) {
      const attachmentSideEffects: AttachmentSideEffects = {
        deletedThreadIds: new Set<string>(),
        prunedThreadRelativePaths: new Map<string, Set<string>>(),
      };

      yield* withBusyRetry(
        sql.withTransaction(
          projector.apply(event, attachmentSideEffects).pipe(
            Effect.flatMap(() =>
              projectionStateRepository.upsert({
                projector: projector.name,
                lastAppliedSequence: event.sequence,
                updatedAt: event.occurredAt,
              }),
            ),
          ),
        ),
      );

      yield* runAttachmentSideEffects(attachmentSideEffects).pipe(
        Effect.catch((cause) =>
          Effect.logWarning("failed to apply projected attachment side-effects", {
            projector: projector.name,
            sequence: event.sequence,
            eventType: event.type,
            cause,
          }),
        ),
      );
    });

    const bootstrapProjector = (projector: ProjectorDefinition) =>
      projectionStateRepository
        .getByProjector({
          projector: projector.name,
        })
        .pipe(
          Effect.flatMap((stateRow) =>
            Stream.runForEach(
              eventStore.readFromSequence(
                Option.isSome(stateRow) ? stateRow.value.lastAppliedSequence : 0,
              ),
              (event) => runProjectorForEvent(projector, event),
            ),
          ),
        );

    const projectEvent: OrchestrationProjectionPipelineShape["projectEvent"] = (event) =>
      Effect.forEach(projectors, (projector) => runProjectorForEvent(projector, event), {
        concurrency: 1,
      }).pipe(
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.provideService(Path.Path, path),
        Effect.provideService(ServerConfig, serverConfig),
        Effect.asVoid,
        Effect.catchTag("SqlError", (sqlError) =>
          Effect.fail(toPersistenceSqlError("ProjectionPipeline.projectEvent:query")(sqlError)),
        ),
      );

    const bootstrap: OrchestrationProjectionPipelineShape["bootstrap"] = Effect.forEach(
      projectors,
      bootstrapProjector,
      { concurrency: 1 },
    ).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
      Effect.provideService(ServerConfig, serverConfig),
      Effect.asVoid,
      Effect.tap(() =>
        Effect.logDebug("orchestration projection pipeline bootstrapped").pipe(
          Effect.annotateLogs({ projectors: projectors.length }),
        ),
      ),
      Effect.catchTag("SqlError", (sqlError) =>
        Effect.fail(toPersistenceSqlError("ProjectionPipeline.bootstrap:query")(sqlError)),
      ),
    );

    return {
      bootstrap,
      projectEvent,
    } satisfies OrchestrationProjectionPipelineShape;
  },
);

export const OrchestrationProjectionPipelineLive = Layer.effect(
  OrchestrationProjectionPipeline,
  makeOrchestrationProjectionPipeline(),
).pipe(
  Layer.provideMerge(ProjectionProjectRepositoryLive),
  Layer.provideMerge(ProjectionThreadRepositoryLive),
  Layer.provideMerge(ProjectionThreadMessageRepositoryLive),
  Layer.provideMerge(ProjectionThreadProposedPlanRepositoryLive),
  Layer.provideMerge(ProjectionThreadActivityRepositoryLive),
  Layer.provideMerge(ProjectionThreadSessionRepositoryLive),
  Layer.provideMerge(ProjectionTurnRepositoryLive),
  Layer.provideMerge(ProjectionPendingApprovalRepositoryLive),
  Layer.provideMerge(ProjectionTaskRepositoryLive),
  Layer.provideMerge(ProjectionHelperRunRepositoryLive),
  Layer.provideMerge(ProjectionProjectContextRunRepositoryLive),
  Layer.provideMerge(ProjectionStageHistoryRepositoryLive),
  Layer.provideMerge(ProjectionAwaitedStageRepositoryLive),
  Layer.provideMerge(ProjectionQuotaBlockedStageRepositoryLive),
  Layer.provideMerge(ProjectionPendingGateRepositoryLive),
  Layer.provideMerge(ProjectionStateRepositoryLive),
);
