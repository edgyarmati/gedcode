import type {
  OrchestrationEvent,
  OrchestrationPendingGate,
  OrchestrationReadModel,
  OrchestrationTask,
  OrchestrationStageHistory,
  TaskId,
  ThreadId,
} from "@t3tools/contracts";
import {
  OrchestrationCheckpointSummary,
  OrchestrationMessage,
  OrchestrationSession,
  OrchestrationThread,
  TaskAbandonedPayload,
  TaskClassifiedPayload,
  TaskCreatedPayload,
  TaskGateRequestedPayload,
  TaskGateResolvedPayload,
  TaskLandedPayload,
  TaskRoleSelectionsUpdatedPayload,
  TaskStageBlockedPayload,
  TaskStageCompletedPayload,
  TaskStageStartedPayload,
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
  ThreadCreatedPayload,
  ThreadDeletedPayload,
  ThreadInteractionModeSetPayload,
  ThreadMetaUpdatedPayload,
  ThreadProposedPlanUpsertedPayload,
  ThreadRuntimeModeSetPayload,
  ThreadUnarchivedPayload,
  ThreadRevertedPayload,
  ThreadSessionSetPayload,
  ThreadTurnDiffCompletedPayload,
} from "./Schemas.ts";

type ThreadPatch = Partial<Omit<OrchestrationThread, "id" | "projectId">>;
type TaskPatch = Partial<Omit<OrchestrationTask, "id" | "projectId">>;
type PendingGatePatch = Partial<Omit<OrchestrationPendingGate, "gateId" | "taskId">>;
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
  return tasks.map((task) => (task.id === taskId ? { ...task, ...patch } : task));
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
    case "project.created":
      return decodeForEvent(ProjectCreatedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => {
          const existing = nextBase.projects.find((entry) => entry.id === payload.projectId);
          const nextProject = {
            id: payload.projectId,
            title: payload.title,
            workspaceRoot: payload.workspaceRoot,
            defaultModelSelection: payload.defaultModelSelection,
            roleModelSelections: payload.roleModelSelections ?? {},
            rolePromptPrefixes: payload.rolePromptPrefixes ?? {},
            orchestratorConfig: payload.orchestratorConfig ?? {},
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
        Effect.map((payload) => ({
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
                  ...(payload.orchestratorConfig !== undefined
                    ? { orchestratorConfig: payload.orchestratorConfig }
                    : {}),
                  ...(payload.scripts !== undefined ? { scripts: payload.scripts } : {}),
                  updatedAt: payload.updatedAt,
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
            messages: [],
            activities: [],
            checkpoints: [],
            session: null,
          },
          event.type,
          "thread",
        );
        const existing = nextBase.threads.find((entry) => entry.id === thread.id);
        return {
          ...nextBase,
          threads: existing
            ? nextBase.threads.map((entry) => (entry.id === thread.id ? thread : entry))
            : [...nextBase.threads, thread],
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
            pmMessageId: payload.pmMessageId,
            stageThreadIds: [],
            currentStageThreadId: null,
            roleModelSelections: {},
            playbookVersion: payload.playbookVersion,
            createdAt: payload.createdAt,
            updatedAt: payload.updatedAt,
          };
          return {
            ...nextBase,
            tasks: existing
              ? nextBase.tasks.map((entry) => (entry.id === payload.taskId ? task : entry))
              : [...nextBase.tasks, task],
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

    case "task.role-selections-updated":
      return decodeForEvent(
        TaskRoleSelectionsUpdatedPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => ({
          ...nextBase,
          tasks: updateTask(nextBase.tasks, payload.taskId, {
            roleModelSelections: payload.roleModelSelections,
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
          const modelSelection =
            project === undefined
              ? null
              : resolveStageModelSelection({
                  project,
                  task,
                  role: payload.role,
                });
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
              modelSelection === null
                ? nextBase.stageHistory
                : ({
                    ...nextBase.stageHistory,
                    [payload.stageThreadId]: {
                      projectId: task.projectId,
                      taskId: payload.taskId,
                      stageThreadId: payload.stageThreadId,
                      role: payload.role,
                      providerInstanceId: modelSelection.instanceId,
                      model: modelSelection.model,
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
              ...(payload.role === "work" ? { status: "review" as const } : {}),
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
                      status: "blocked" as const,
                      endedAt: payload.updatedAt,
                    },
                  },
          };
        }),
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
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "task.abandoned":
      // `task.abandoned → abandoned` (terminal).
      return decodeForEvent(TaskAbandonedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          tasks: updateTask(nextBase.tasks, payload.taskId, {
            status: "abandoned",
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    default:
      return Effect.succeed(nextBase);
  }
}
