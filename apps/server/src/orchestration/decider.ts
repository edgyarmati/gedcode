import {
  DEFAULT_PROVIDER_INTERACTION_MODE,
  EventId,
  MessageId,
  OrchestratorProjectConfig,
  ThreadId,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationProject,
  type OrchestrationReadModel,
  type OrchestrationThread,
} from "@t3tools/contracts";
import {
  resolveGatePolicy,
  resolveResourceLimit,
  resolveStages,
} from "@t3tools/shared/orchestrator";
import * as DateTime from "effect/DateTime";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";

import { OrchestrationCommandInvariantError } from "./Errors.ts";
import { defaultTaskTypeRegistry } from "./TaskTypeRegistry.ts";
import {
  listThreadsByProjectId,
  requireProject,
  requireProjectAbsent,
  requireTask,
  requireTaskAbsent,
  requireThread,
  requireThreadArchived,
  requireThreadAbsent,
  requireThreadNotArchived,
} from "./commandInvariants.ts";
import { projectEvent } from "./projector.ts";
import { resolveStageModelSelection } from "./stageModelSelection.ts";
import { activeStageRoleForTaskStatus, prepareStageInstructions } from "./stageResolution.ts";
import {
  explicitlySetProjectConfig,
  type SparseOrchestratorDefaults,
} from "./orchestratorConfigResolution.ts";
import { resolveWorkerStageRuntimeMode } from "./workerSafety.ts";

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
const decodeOrchestratorConfig = Schema.decodeUnknownOption(OrchestratorProjectConfig);
const defaultOrchestratorConfig = Option.getOrThrow(decodeOrchestratorConfig({}));

function taskWorktreePath(input: { readonly workspaceRoot: string; readonly taskId: string }) {
  return `${input.workspaceRoot.replace(/[\\/]+$/, "")}/.gedcode/orchestrator/tasks/${input.taskId}`;
}

function invariantError(commandType: string, detail: string): OrchestrationCommandInvariantError {
  return new OrchestrationCommandInvariantError({
    commandType,
    detail,
  });
}

function requirePmThread(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly threadId: OrchestrationThread["id"];
}): Effect.Effect<OrchestrationThread, OrchestrationCommandInvariantError> {
  return requireThread({
    readModel: input.readModel,
    command: input.command,
    threadId: input.threadId,
  }).pipe(
    Effect.flatMap((thread) =>
      String(thread.id) === `pm:${thread.projectId}`
        ? Effect.succeed(thread)
        : Effect.fail(
            invariantError(
              input.command.type,
              `Thread '${input.threadId}' is not a PM thread for command '${input.command.type}'.`,
            ),
          ),
    ),
  );
}

function requireOrchestratorConfig(input: {
  readonly command: OrchestrationCommand;
  readonly project: OrchestrationProject;
}): Effect.Effect<OrchestratorProjectConfig, OrchestrationCommandInvariantError> {
  const config = decodeOrchestratorConfig(input.project.orchestratorConfig ?? {});
  if (Option.isNone(config)) {
    return Effect.succeed(defaultOrchestratorConfig);
  }
  const configuredIds = new Set<string>();
  for (const taskType of config.value.taskTypes) {
    const taskTypeId = String(taskType.id);
    if (!defaultTaskTypeRegistry.has(taskTypeId)) {
      return Effect.fail(
        invariantError(
          input.command.type,
          `Unknown orchestration task type '${taskTypeId}'. Registered task types: ${defaultTaskTypeRegistry.ids().join(", ")}.`,
        ),
      );
    }
    if (configuredIds.has(taskTypeId)) {
      return Effect.fail(
        invariantError(
          input.command.type,
          `Orchestrator config contains duplicate task type '${taskTypeId}'.`,
        ),
      );
    }
    configuredIds.add(taskTypeId);
  }
  return Effect.succeed(config.value);
}

function requireRegisteredTaskType(input: {
  readonly command: OrchestrationCommand;
  readonly taskTypeId: string;
}): Effect.Effect<void, OrchestrationCommandInvariantError> {
  return defaultTaskTypeRegistry.has(input.taskTypeId)
    ? Effect.void
    : Effect.fail(
        invariantError(
          input.command.type,
          `Unknown orchestration task type '${input.taskTypeId}'. Registered task types: ${defaultTaskTypeRegistry.ids().join(", ")}.`,
        ),
      );
}

function requireReleaseSource(input: {
  readonly command: OrchestrationCommand;
  readonly readModel: OrchestrationReadModel;
  readonly projectId: OrchestrationProject["id"];
  readonly taskTypeId: string;
  readonly dependsOnTaskIds: ReadonlyArray<OrchestrationReadModel["tasks"][number]["id"]>;
}): Effect.Effect<void, OrchestrationCommandInvariantError> {
  if (input.taskTypeId !== "release") {
    return Effect.void;
  }
  if (input.dependsOnTaskIds.length !== 1) {
    return Effect.fail(
      invariantError(
        input.command.type,
        "A release task must identify exactly one landed feature task as releaseSourceTaskId.",
      ),
    );
  }
  const sourceTaskId = input.dependsOnTaskIds[0]!;
  const source = input.readModel.tasks.find((task) => task.id === sourceTaskId);
  if (source === undefined) {
    return Effect.fail(
      invariantError(input.command.type, `Release source task '${sourceTaskId}' does not exist.`),
    );
  }
  if (source.projectId !== input.projectId) {
    return Effect.fail(
      invariantError(
        input.command.type,
        `Release source task '${sourceTaskId}' belongs to a different project.`,
      ),
    );
  }
  if (source.archivedAt !== null || source.deletedAt !== null) {
    return Effect.fail(
      invariantError(input.command.type, `Release source task '${sourceTaskId}' must be visible.`),
    );
  }
  if (source.type !== "feature" || source.status !== "landed" || source.prUrl === null) {
    return Effect.fail(
      invariantError(
        input.command.type,
        `Release source task '${sourceTaskId}' must be a fully landed feature task with a pull request.`,
      ),
    );
  }
  return Effect.void;
}

function isTerminalTaskStatus(status: OrchestrationReadModel["tasks"][number]["status"]): boolean {
  return status === "landed" || status === "no-changes-needed" || status === "abandoned";
}

function requireSettledTerminalTask(input: {
  readonly command: OrchestrationCommand;
  readonly task: OrchestrationReadModel["tasks"][number];
}): Effect.Effect<void, OrchestrationCommandInvariantError> {
  if (
    input.task.currentStageThreadId === null &&
    (input.task.status === "abandoned" ||
      input.task.status === "no-changes-needed" ||
      (input.task.status === "landed" && input.task.prUrl !== null))
  ) {
    return Effect.void;
  }
  return Effect.fail(
    invariantError(
      input.command.type,
      `Task '${input.task.id}' must be abandoned or fully landed with a pull request before '${input.command.type}'.`,
    ),
  );
}

function requireTaskNotCancelling(input: {
  readonly command: OrchestrationCommand;
  readonly task: OrchestrationReadModel["tasks"][number];
}): Effect.Effect<void, OrchestrationCommandInvariantError> {
  return input.task.cancellation == null
    ? Effect.void
    : Effect.fail(
        invariantError(
          input.command.type,
          `Task '${input.task.id}' cannot process '${input.command.type}' after cancellation has been requested.`,
        ),
      );
}

function requireFreshVerification(input: {
  readonly command: OrchestrationCommand;
  readonly readModel: OrchestrationReadModel;
  readonly task: OrchestrationReadModel["tasks"][number];
}): Effect.Effect<void, OrchestrationCommandInvariantError> {
  const completedStages = Object.values(input.readModel.stageHistory).filter(
    (stage) =>
      stage.taskId === input.task.id && stage.status === "completed" && stage.endedAt !== null,
  );
  const latestCompletedAt = (role: "work" | "verify") =>
    completedStages
      .filter((stage) => stage.role === role)
      .map((stage) => stage.endedAt!)
      .toSorted((left, right) => right.localeCompare(left))[0];
  const latestWorkCompletedAt = latestCompletedAt("work");
  const latestVerifyCompletedAt = latestCompletedAt("verify");

  if (
    latestVerifyCompletedAt !== undefined &&
    (latestWorkCompletedAt === undefined || latestVerifyCompletedAt > latestWorkCompletedAt)
  ) {
    return Effect.void;
  }

  return Effect.fail(
    invariantError(
      input.command.type,
      latestVerifyCompletedAt === undefined
        ? `Task '${input.task.id}' cannot land without a successfully completed verification stage.`
        : `Task '${input.task.id}' cannot land because its latest successful verification is not newer than its latest successful work stage.`,
    ),
  );
}

function countActiveTaskWorktrees(input: {
  readonly readModel: OrchestrationReadModel;
  readonly projectId: OrchestrationProject["id"];
}): number {
  return input.readModel.tasks.filter(
    (task) =>
      task.projectId === input.projectId &&
      task.worktreePath !== null &&
      !isTerminalTaskStatus(task.status),
  ).length;
}

function withEventBase(
  input: Pick<OrchestrationCommand, "commandId"> & {
    readonly aggregateKind: OrchestrationEvent["aggregateKind"];
    readonly aggregateId: OrchestrationEvent["aggregateId"];
    readonly occurredAt: string;
    readonly metadata?: OrchestrationEvent["metadata"];
  },
): Effect.Effect<
  Omit<OrchestrationEvent, "sequence" | "type" | "payload">,
  PlatformError.PlatformError,
  Crypto.Crypto
> {
  return Crypto.Crypto.pipe(
    Effect.flatMap((crypto) =>
      crypto.randomUUIDv4.pipe(
        Effect.map((eventId) => ({
          eventId: EventId.make(eventId),
          aggregateKind: input.aggregateKind,
          aggregateId: input.aggregateId,
          occurredAt: input.occurredAt,
          commandId: input.commandId,
          causationEventId: null,
          correlationId: input.commandId,
          metadata: input.metadata ?? {},
        })),
      ),
    ),
  );
}

type PlannedOrchestrationEvent = Omit<OrchestrationEvent, "sequence">;

type DecideOrchestrationCommandResult =
  | PlannedOrchestrationEvent
  | ReadonlyArray<PlannedOrchestrationEvent>;

const decideCommandSequence = Effect.fn("decideCommandSequence")(function* ({
  commands,
  orchestratorDefaults,
  readModel,
}: {
  readonly commands: ReadonlyArray<OrchestrationCommand>;
  readonly orchestratorDefaults?: SparseOrchestratorDefaults;
  readonly readModel: OrchestrationReadModel;
}): Effect.fn.Return<
  ReadonlyArray<PlannedOrchestrationEvent>,
  OrchestrationCommandInvariantError | PlatformError.PlatformError,
  Crypto.Crypto
> {
  let nextReadModel = readModel;
  let nextSequence = readModel.snapshotSequence;
  const plannedEvents: PlannedOrchestrationEvent[] = [];

  for (const nextCommand of commands) {
    const decided = yield* decideOrchestrationCommand({
      command: nextCommand,
      readModel: nextReadModel,
      ...(orchestratorDefaults !== undefined ? { orchestratorDefaults } : {}),
    });
    const nextEvents = Array.isArray(decided) ? decided : [decided];
    for (const nextEvent of nextEvents) {
      plannedEvents.push(nextEvent);
      nextSequence += 1;
      nextReadModel = yield* projectEvent(nextReadModel, {
        ...nextEvent,
        sequence: nextSequence,
      }).pipe(Effect.orDie);
    }
  }

  return plannedEvents;
});

export const decideOrchestrationCommand = Effect.fn("decideOrchestrationCommand")(function* ({
  command,
  orchestratorDefaults = {},
  readModel,
}: {
  readonly command: OrchestrationCommand;
  readonly orchestratorDefaults?: SparseOrchestratorDefaults;
  readonly readModel: OrchestrationReadModel;
}): Effect.fn.Return<
  DecideOrchestrationCommandResult,
  OrchestrationCommandInvariantError | PlatformError.PlatformError,
  Crypto.Crypto
> {
  if (
    "taskId" in command &&
    command.type !== "task.create" &&
    command.type !== "task.archive" &&
    command.type !== "task.restore" &&
    command.type !== "task.delete"
  ) {
    const task = readModel.tasks.find((candidate) => candidate.id === command.taskId);
    if (task?.deletedAt !== null && task?.deletedAt !== undefined) {
      return yield* invariantError(
        command.type,
        `Task '${command.taskId}' was permanently deleted and cannot process '${command.type}'.`,
      );
    }
    if (task?.archivedAt !== null && task?.archivedAt !== undefined) {
      return yield* invariantError(
        command.type,
        `Task '${command.taskId}' is archived and must be restored before '${command.type}'.`,
      );
    }
  }

  switch (command.type) {
    case "project.create": {
      yield* requireProjectAbsent({
        readModel,
        command,
        projectId: command.projectId,
      });
      if (command.orchestratorConfig !== undefined) {
        yield* requireOrchestratorConfig({
          command,
          project: {
            id: command.projectId,
            title: command.title,
            workspaceRoot: command.workspaceRoot,
            defaultModelSelection: command.defaultModelSelection ?? null,
            roleModelSelections: command.roleModelSelections ?? {},
            rolePromptPrefixes: command.rolePromptPrefixes ?? {},
            orchestratorConfig: command.orchestratorConfig,
            scripts: [],
            createdAt: command.createdAt,
            updatedAt: command.createdAt,
            deletedAt: null,
          },
        });
      }

      return {
        ...(yield* withEventBase({
          aggregateKind: "project",
          aggregateId: command.projectId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "project.created",
        payload: {
          projectId: command.projectId,
          title: command.title,
          workspaceRoot: command.workspaceRoot,
          defaultModelSelection: command.defaultModelSelection ?? null,
          roleModelSelections: command.roleModelSelections ?? {},
          rolePromptPrefixes: command.rolePromptPrefixes ?? {},
          orchestratorConfig: command.orchestratorConfig ?? {},
          scripts: [],
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "project.meta.update": {
      const project = yield* requireProject({
        readModel,
        command,
        projectId: command.projectId,
      });
      if (command.orchestratorConfig !== undefined) {
        yield* requireOrchestratorConfig({
          command,
          project: {
            ...project,
            orchestratorConfig: command.orchestratorConfig,
          },
        });
      }
      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "project",
          aggregateId: command.projectId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "project.meta-updated",
        payload: {
          projectId: command.projectId,
          ...(command.title !== undefined ? { title: command.title } : {}),
          ...(command.workspaceRoot !== undefined ? { workspaceRoot: command.workspaceRoot } : {}),
          ...(command.defaultModelSelection !== undefined
            ? { defaultModelSelection: command.defaultModelSelection }
            : {}),
          ...(command.roleModelSelections !== undefined
            ? { roleModelSelections: command.roleModelSelections }
            : {}),
          ...(command.rolePromptPrefixes !== undefined
            ? { rolePromptPrefixes: command.rolePromptPrefixes }
            : {}),
          ...(command.orchestratorConfig !== undefined
            ? { orchestratorConfig: command.orchestratorConfig }
            : {}),
          ...(command.scripts !== undefined ? { scripts: command.scripts } : {}),
          updatedAt: occurredAt,
        },
      };
    }

    case "project.delete": {
      yield* requireProject({
        readModel,
        command,
        projectId: command.projectId,
      });
      const activeThreads = listThreadsByProjectId(readModel, command.projectId).filter(
        (thread) => thread.deletedAt === null,
      );
      if (activeThreads.length > 0 && command.force !== true) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Project '${command.projectId}' is not empty and cannot be deleted without force=true.`,
        });
      }
      if (activeThreads.length > 0) {
        return yield* decideCommandSequence({
          readModel,
          ...(orchestratorDefaults !== undefined ? { orchestratorDefaults } : {}),
          commands: [
            ...activeThreads.map(
              (thread): Extract<OrchestrationCommand, { type: "thread.delete" }> => ({
                type: "thread.delete",
                commandId: command.commandId,
                threadId: thread.id,
              }),
            ),
            {
              type: "project.delete",
              commandId: command.commandId,
              projectId: command.projectId,
            },
          ],
        });
      }

      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "project",
          aggregateId: command.projectId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "project.deleted" as const,
        payload: {
          projectId: command.projectId,
          deletedAt: occurredAt,
        },
      };
    }

    case "thread.create": {
      yield* requireProject({
        readModel,
        command,
        projectId: command.projectId,
      });
      yield* requireThreadAbsent({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.created",
        payload: {
          threadId: command.threadId,
          projectId: command.projectId,
          title: command.title,
          modelSelection: command.modelSelection,
          gedWorkflowEnabled: command.gedWorkflowEnabled ?? true,
          runtimeMode: command.runtimeMode,
          interactionMode: command.interactionMode,
          branch: command.branch,
          worktreePath: command.worktreePath,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "thread.fork": {
      const source = yield* requireThread({
        readModel,
        command,
        threadId: command.sourceThreadId,
      });
      yield* requireThreadAbsent({
        readModel,
        command,
        threadId: command.targetThreadId,
      });
      if (source.latestTurn?.state === "running") {
        return yield* invariantError(
          command.type,
          `Thread '${source.id}' has a running turn and cannot be forked.`,
        );
      }
      const boundaryIndex = source.messages.findIndex(
        (message) => message.id === command.sourceMessageId,
      );
      const boundary = boundaryIndex < 0 ? undefined : source.messages[boundaryIndex];
      if (boundary === undefined || boundary.role !== "assistant" || boundary.streaming) {
        return yield* invariantError(
          command.type,
          `Message '${command.sourceMessageId}' must be a completed assistant message in thread '${source.id}'.`,
        );
      }
      const sourceMessages = source.messages.slice(0, boundaryIndex + 1);
      if (command.targetMessageIds.length !== sourceMessages.length) {
        return yield* invariantError(
          command.type,
          `Fork target message id count must match the ${sourceMessages.length} visible source messages.`,
        );
      }
      if (new Set(command.targetMessageIds).size !== command.targetMessageIds.length) {
        return yield* invariantError(command.type, "Fork target message ids must be unique.");
      }
      if (command.session !== undefined && command.session.threadId !== command.targetThreadId) {
        return yield* invariantError(
          command.type,
          `Forked provider session must belong to target thread '${command.targetThreadId}'.`,
        );
      }

      const createdEvent = {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.targetThreadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.created" as const,
        payload: {
          threadId: command.targetThreadId,
          projectId: source.projectId,
          title: source.title,
          modelSelection: source.modelSelection,
          gedWorkflowEnabled: source.gedWorkflowEnabled ?? true,
          runtimeMode: source.runtimeMode,
          interactionMode: source.interactionMode,
          branch: source.branch,
          worktreePath: source.worktreePath,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
      const messageEvents: PlannedOrchestrationEvent[] = [];
      let previousEventId = createdEvent.eventId;
      for (const [index, message] of sourceMessages.entries()) {
        const messageEvent = {
          ...(yield* withEventBase({
            aggregateKind: "thread",
            aggregateId: command.targetThreadId,
            occurredAt: command.createdAt,
            commandId: command.commandId,
          })),
          causationEventId: previousEventId,
          type: "thread.message-sent" as const,
          payload: {
            ...message,
            threadId: command.targetThreadId,
            messageId: command.targetMessageIds[index]!,
          },
        };
        messageEvents.push(messageEvent);
        previousEventId = messageEvent.eventId;
      }
      if (command.session === undefined) {
        return [createdEvent, ...messageEvents];
      }
      const sessionEvent = {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.targetThreadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        causationEventId: messageEvents.at(-1)?.eventId ?? createdEvent.eventId,
        type: "thread.session-set" as const,
        payload: {
          threadId: command.targetThreadId,
          session: command.session,
        },
      };
      return [createdEvent, ...messageEvents, sessionEvent];
    }

    case "thread.delete": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "thread.deleted",
        payload: {
          threadId: command.threadId,
          deletedAt: occurredAt,
        },
      };
    }

    case "thread.archive": {
      yield* requireThreadNotArchived({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "thread.archived",
        payload: {
          threadId: command.threadId,
          archivedAt: occurredAt,
          updatedAt: occurredAt,
        },
      };
    }

    case "thread.unarchive": {
      yield* requireThreadArchived({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "thread.unarchived",
        payload: {
          threadId: command.threadId,
          updatedAt: occurredAt,
        },
      };
    }

    case "thread.meta.update": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "thread.meta-updated",
        payload: {
          threadId: command.threadId,
          ...(command.title !== undefined ? { title: command.title } : {}),
          ...(command.modelSelection !== undefined
            ? { modelSelection: command.modelSelection }
            : {}),
          ...(command.gedWorkflowEnabled !== undefined
            ? { gedWorkflowEnabled: command.gedWorkflowEnabled }
            : {}),
          ...(command.branch !== undefined ? { branch: command.branch } : {}),
          ...(command.worktreePath !== undefined ? { worktreePath: command.worktreePath } : {}),
          updatedAt: occurredAt,
        },
      };
    }

    case "thread.runtime-mode.set": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "thread.runtime-mode-set",
        payload: {
          threadId: command.threadId,
          runtimeMode: command.runtimeMode,
          updatedAt: occurredAt,
        },
      };
    }

    case "thread.interaction-mode.set": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "thread.interaction-mode-set",
        payload: {
          threadId: command.threadId,
          interactionMode: command.interactionMode,
          updatedAt: occurredAt,
        },
      };
    }

    case "thread.turn.start": {
      const targetThread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const sourceProposedPlan = command.sourceProposedPlan;
      const sourceThread = sourceProposedPlan
        ? yield* requireThread({
            readModel,
            command,
            threadId: sourceProposedPlan.threadId,
          })
        : null;
      const sourcePlan =
        sourceProposedPlan && sourceThread
          ? sourceThread.proposedPlans.find((entry) => entry.id === sourceProposedPlan.planId)
          : null;
      if (sourceProposedPlan && !sourcePlan) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Proposed plan '${sourceProposedPlan.planId}' does not exist on thread '${sourceProposedPlan.threadId}'.`,
        });
      }
      if (sourceThread && sourceThread.projectId !== targetThread.projectId) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Proposed plan '${sourceProposedPlan?.planId}' belongs to thread '${sourceThread.id}' in a different project.`,
        });
      }
      const userMessageEvent: Omit<OrchestrationEvent, "sequence"> = {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.message-sent",
        payload: {
          threadId: command.threadId,
          messageId: command.message.messageId,
          role: "user",
          text: command.message.text,
          attachments: command.message.attachments,
          turnId: null,
          streaming: false,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
      const turnStartRequestedEvent: Omit<OrchestrationEvent, "sequence"> = {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        causationEventId: userMessageEvent.eventId,
        type: "thread.turn-start-requested",
        payload: {
          threadId: command.threadId,
          messageId: command.message.messageId,
          ...(command.modelSelection !== undefined
            ? { modelSelection: command.modelSelection }
            : {}),
          gedWorkflowEnabled: command.gedWorkflowEnabled ?? targetThread.gedWorkflowEnabled ?? true,
          ...(command.titleSeed !== undefined ? { titleSeed: command.titleSeed } : {}),
          runtimeMode: targetThread.runtimeMode,
          interactionMode: targetThread.interactionMode,
          ...(sourceProposedPlan !== undefined ? { sourceProposedPlan } : {}),
          createdAt: command.createdAt,
        },
      };
      return [userMessageEvent, turnStartRequestedEvent];
    }

    case "thread.turn.interrupt": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.turn-interrupt-requested",
        payload: {
          threadId: command.threadId,
          ...(command.turnId !== undefined ? { turnId: command.turnId } : {}),
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.approval.respond": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
          metadata: {
            requestId: command.requestId,
          },
        })),
        type: "thread.approval-response-requested",
        payload: {
          threadId: command.threadId,
          requestId: command.requestId,
          decision: command.decision,
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.user-input.respond": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
          metadata: {
            requestId: command.requestId,
          },
        })),
        type: "thread.user-input-response-requested",
        payload: {
          threadId: command.threadId,
          requestId: command.requestId,
          answers: command.answers,
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.checkpoint.revert": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.checkpoint-revert-requested",
        payload: {
          threadId: command.threadId,
          turnCount: command.turnCount,
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.session.stop": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.session-stop-requested",
        payload: {
          threadId: command.threadId,
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.session.set": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
          metadata: {},
        })),
        type: "thread.session-set",
        payload: {
          threadId: command.threadId,
          session: command.session,
        },
      };
    }

    case "thread.message.user.append": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.message-sent",
        payload: {
          threadId: command.threadId,
          messageId: command.messageId,
          role: "user",
          text: command.text,
          attachments: [],
          turnId: null,
          streaming: false,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "thread.message.assistant.delta": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.message-sent",
        payload: {
          threadId: command.threadId,
          messageId: command.messageId,
          role: "assistant",
          text: command.delta,
          turnId: command.turnId ?? null,
          streaming: true,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "thread.message.assistant.complete": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.message-sent",
        payload: {
          threadId: command.threadId,
          messageId: command.messageId,
          role: "assistant",
          text: "",
          turnId: command.turnId ?? null,
          streaming: false,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "thread.clear": {
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.cleared",
        payload: {
          threadId: command.threadId,
          clearedAt: command.createdAt,
        },
      };
    }

    case "thread.pm-handoff.request": {
      yield* requirePmThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.pm-handoff-requested",
        payload: {
          threadId: command.threadId,
          mode: command.mode,
          ...(command.brief !== undefined ? { brief: command.brief } : {}),
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.pm-handoff.complete": {
      yield* requirePmThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.pm-handoff-completed",
        payload: {
          threadId: command.threadId,
          mode: command.mode,
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.proposed-plan.upsert": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.proposed-plan-upserted",
        payload: {
          threadId: command.threadId,
          proposedPlan: command.proposedPlan,
        },
      };
    }

    case "thread.turn.diff.complete": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.turn-diff-completed",
        payload: {
          threadId: command.threadId,
          turnId: command.turnId,
          checkpointTurnCount: command.checkpointTurnCount,
          checkpointRef: command.checkpointRef,
          status: command.status,
          files: command.files,
          assistantMessageId: command.assistantMessageId ?? null,
          completedAt: command.completedAt,
        },
      };
    }

    case "thread.revert.complete": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.reverted",
        payload: {
          threadId: command.threadId,
          turnCount: command.turnCount,
        },
      };
    }

    case "thread.activity.append": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const requestId =
        typeof command.activity.payload === "object" &&
        command.activity.payload !== null &&
        "requestId" in command.activity.payload &&
        typeof (command.activity.payload as { requestId?: unknown }).requestId === "string"
          ? ((command.activity.payload as { requestId: string })
              .requestId as OrchestrationEvent["metadata"]["requestId"])
          : undefined;
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
          ...(requestId !== undefined ? { metadata: { requestId } } : {}),
        })),
        type: "thread.activity-appended",
        payload: {
          threadId: command.threadId,
          activity: command.activity,
        },
      };
    }

    case "task.create": {
      const project = yield* requireProject({
        readModel,
        command,
        projectId: command.projectId,
      });
      yield* requireOrchestratorConfig({ command, project });
      yield* requireRegisteredTaskType({
        command,
        taskTypeId: command.taskType,
      });
      if (command.taskType !== "release" && (command.dependsOnTaskIds?.length ?? 0) > 0) {
        return yield* invariantError(
          command.type,
          "Only release tasks may set dependencies directly at task creation.",
        );
      }
      yield* requireReleaseSource({
        command,
        readModel,
        projectId: command.projectId,
        taskTypeId: command.taskType,
        dependsOnTaskIds: command.dependsOnTaskIds ?? [],
      });
      yield* requireTaskAbsent({
        readModel,
        command,
        taskId: command.taskId,
      });
      const supersededTask =
        command.supersedesTaskId === undefined || command.supersedesTaskId === null
          ? null
          : yield* requireTask({
              readModel,
              command,
              taskId: command.supersedesTaskId,
            });
      if (supersededTask !== null) {
        if (supersededTask.projectId !== command.projectId) {
          return yield* invariantError(
            command.type,
            `Task '${command.supersedesTaskId}' belongs to a different project.`,
          );
        }
        if (supersededTask.archivedAt !== null || supersededTask.deletedAt !== null) {
          return yield* invariantError(
            command.type,
            `Task '${command.supersedesTaskId}' must be visible before it can be superseded.`,
          );
        }
        yield* requireSettledTerminalTask({ command, task: supersededTask });
        if (
          supersededTask.supersededByTaskId !== undefined &&
          supersededTask.supersededByTaskId !== null
        ) {
          return yield* invariantError(
            command.type,
            `Task '${command.supersedesTaskId}' is already superseded by '${supersededTask.supersededByTaskId}'.`,
          );
        }
      }
      const parentTaskId = command.parentTaskId;
      const childOrder = command.childOrder;
      const hasParent = parentTaskId !== undefined && parentTaskId !== null;
      const hasChildOrder = childOrder !== undefined && childOrder !== null;
      if (hasParent !== hasChildOrder) {
        return yield* invariantError(
          command.type,
          "Child tasks must provide parentTaskId and childOrder together.",
        );
      }
      if (
        parentTaskId !== undefined &&
        parentTaskId !== null &&
        childOrder !== undefined &&
        childOrder !== null
      ) {
        const parentTask = yield* requireTask({
          readModel,
          command,
          taskId: parentTaskId,
        });
        if (parentTask.projectId !== command.projectId) {
          return yield* invariantError(
            command.type,
            `Parent task '${parentTaskId}' belongs to a different project.`,
          );
        }
        if (parentTask.archivedAt !== null || parentTask.deletedAt !== null) {
          return yield* invariantError(
            command.type,
            `Parent task '${parentTaskId}' must be visible before adding children.`,
          );
        }
        if (parentTask.parentTaskId !== undefined && parentTask.parentTaskId !== null) {
          return yield* invariantError(command.type, "Nested child tasks are not supported.");
        }
        const duplicateOrder = readModel.tasks.find(
          (task) => task.parentTaskId === parentTaskId && task.childOrder === childOrder,
        );
        if (duplicateOrder !== undefined) {
          return yield* invariantError(
            command.type,
            `Parent task '${parentTaskId}' already has child order ${childOrder}.`,
          );
        }
      }
      const projectConfig = explicitlySetProjectConfig(project.orchestratorConfig);
      const maxParallelTasks = resolveResourceLimit({
        config: projectConfig,
        defaults: orchestratorDefaults,
        key: "maxParallelTasks",
      });
      const activeTaskWorktrees = countActiveTaskWorktrees({
        readModel,
        projectId: command.projectId,
      });
      if (activeTaskWorktrees >= maxParallelTasks) {
        return yield* invariantError(
          command.type,
          `Project '${command.projectId}' already has ${activeTaskWorktrees} active task worktree(s), which meets the maxParallelTasks limit (${maxParallelTasks}).`,
        );
      }

      return {
        ...(yield* withEventBase({
          aggregateKind: "task",
          aggregateId: command.taskId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "task.created",
        payload: {
          taskId: command.taskId,
          projectId: command.projectId,
          taskType: command.taskType,
          title: command.title,
          branch: command.branch ?? `orchestrator/${String(command.taskId)}`,
          worktreePath: taskWorktreePath({
            workspaceRoot: project.workspaceRoot,
            taskId: String(command.taskId),
          }),
          pmMessageId: command.pmMessageId,
          parentTaskId: command.parentTaskId ?? null,
          childOrder: command.childOrder ?? null,
          dependsOnTaskIds: command.dependsOnTaskIds ?? [],
          supersedesTaskId: command.supersedesTaskId ?? null,
          playbookVersion: null,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "task.split": {
      const parent = yield* requireTask({
        readModel,
        command,
        taskId: command.taskId,
      });
      yield* requireTaskNotCancelling({ command, task: parent });
      const project = yield* requireProject({
        readModel,
        command,
        projectId: parent.projectId,
      });
      yield* requireOrchestratorConfig({ command, project });
      if (parent.parentTaskId !== undefined && parent.parentTaskId !== null) {
        return yield* invariantError(command.type, "Nested child tasks are not supported.");
      }
      if (parent.archivedAt !== null || parent.deletedAt !== null) {
        return yield* invariantError(
          command.type,
          "The parent task must be visible before splitting.",
        );
      }
      if (
        parent.status === "landed" ||
        parent.status === "no-changes-needed" ||
        parent.status === "abandoned"
      ) {
        return yield* invariantError(command.type, "A terminal task cannot be split.");
      }
      if (parent.currentStageThreadId !== null) {
        return yield* invariantError(
          command.type,
          "Stop the active parent stage before splitting.",
        );
      }
      if (readModel.tasks.some((task) => task.parentTaskId === parent.id)) {
        return yield* invariantError(command.type, "The parent task has already been split.");
      }
      if (command.children.length < 2 || command.children.length > 8) {
        return yield* invariantError(
          command.type,
          "A split must contain between 2 and 8 children.",
        );
      }

      const childIds = new Set(command.children.map((child) => String(child.taskId)));
      if (childIds.size !== command.children.length) {
        return yield* invariantError(command.type, "Split child task ids must be unique.");
      }
      for (const [index, child] of command.children.entries()) {
        yield* requireRegisteredTaskType({
          command,
          taskTypeId: child.taskType,
        });
        if (child.taskType === "release") {
          return yield* invariantError(
            command.type,
            "Release tasks cannot be split children; create one with releaseSourceTaskId after its feature source lands.",
          );
        }
        yield* requireTaskAbsent({ readModel, command, taskId: child.taskId });
        if (child.acceptanceCriteria.length === 0 || child.acceptanceCriteria.length > 12) {
          return yield* invariantError(
            command.type,
            `Child '${child.taskId}' must have between 1 and 12 acceptance criteria.`,
          );
        }
        const earlierChildIds = new Set(
          command.children.slice(0, index).map((candidate) => String(candidate.taskId)),
        );
        const dependencyIds = new Set(child.dependsOnTaskIds.map(String));
        if (dependencyIds.size !== child.dependsOnTaskIds.length) {
          return yield* invariantError(
            command.type,
            `Child '${child.taskId}' has duplicate dependencies.`,
          );
        }
        for (const dependencyId of dependencyIds) {
          if (!childIds.has(dependencyId) || !earlierChildIds.has(dependencyId)) {
            return yield* invariantError(
              command.type,
              `Child '${child.taskId}' may depend only on earlier children in the same split.`,
            );
          }
        }
      }

      const projectConfig = explicitlySetProjectConfig(project.orchestratorConfig);
      const maxParallelTasks = resolveResourceLimit({
        config: projectConfig,
        defaults: orchestratorDefaults,
        key: "maxParallelTasks",
      });
      const activeTaskWorktrees = countActiveTaskWorktrees({
        readModel,
        projectId: project.id,
      });
      if (Math.max(0, activeTaskWorktrees - 1) + command.children.length > maxParallelTasks) {
        return yield* invariantError(
          command.type,
          `Splitting into ${command.children.length} children would exceed the maxParallelTasks limit (${maxParallelTasks}).`,
        );
      }

      const splitEvent = {
        ...(yield* withEventBase({
          aggregateKind: "task",
          aggregateId: parent.id,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "task.split" as const,
        payload: { taskId: parent.id, updatedAt: command.createdAt },
      };
      const childEvents = yield* Effect.forEach(command.children, (child, childOrder) =>
        Effect.gen(function* () {
          return {
            ...(yield* withEventBase({
              aggregateKind: "task",
              aggregateId: child.taskId,
              occurredAt: command.createdAt,
              commandId: command.commandId,
            })),
            type: "task.created" as const,
            payload: {
              taskId: child.taskId,
              projectId: parent.projectId,
              taskType: child.taskType,
              title: child.title,
              branch: `orchestrator/${String(child.taskId)}`,
              worktreePath: taskWorktreePath({
                workspaceRoot: project.workspaceRoot,
                taskId: String(child.taskId),
              }),
              pmMessageId: parent.pmMessageId,
              parentTaskId: parent.id,
              childOrder,
              acceptanceCriteria: child.acceptanceCriteria,
              dependsOnTaskIds: child.dependsOnTaskIds,
              supersedesTaskId: null,
              playbookVersion: null,
              createdAt: command.createdAt,
              updatedAt: command.createdAt,
            },
          };
        }),
      );
      return [splitEvent, ...childEvents];
    }

    case "task.classify": {
      const task = yield* requireTask({
        readModel,
        command,
        taskId: command.taskId,
      });
      yield* requireTaskNotCancelling({ command, task });
      const project = yield* requireProject({
        readModel,
        command,
        projectId: task.projectId,
      });
      yield* requireOrchestratorConfig({ command, project });
      yield* requireRegisteredTaskType({
        command,
        taskTypeId: command.taskType,
      });
      yield* requireReleaseSource({
        command,
        readModel,
        projectId: task.projectId,
        taskTypeId: command.taskType,
        dependsOnTaskIds: task.dependsOnTaskIds ?? [],
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "task",
          aggregateId: command.taskId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "task.classified",
        payload: {
          taskId: command.taskId,
          taskType: command.taskType,
          playbookVersion: command.playbookVersion,
          updatedAt: command.createdAt,
        },
      };
    }

    case "task.role-selections.set": {
      const task = yield* requireTask({
        readModel,
        command,
        taskId: command.taskId,
      });
      yield* requireTaskNotCancelling({ command, task });
      const project = yield* requireProject({
        readModel,
        command,
        projectId: task.projectId,
      });
      yield* requireOrchestratorConfig({ command, project });
      // Model selection is not a guardrail, so the PM may set it; gates/runtime stay human-only.
      if (
        command.origin !== "human" &&
        command.origin !== "client" &&
        command.origin !== "pm-runtime"
      ) {
        return yield* invariantError(
          command.type,
          `Task role model selections can only be updated by human/client/pm-runtime origins; received '${command.origin}'.`,
        );
      }
      return {
        ...(yield* withEventBase({
          aggregateKind: "task",
          aggregateId: command.taskId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "task.role-selections-updated",
        payload: {
          taskId: command.taskId,
          roleModelSelections: command.roleModelSelections,
          origin: command.origin,
          updatedAt: command.createdAt,
        },
      };
    }

    case "task.archive": {
      const task = yield* requireTask({
        readModel,
        command,
        taskId: command.taskId,
      });
      if (task.deletedAt !== null) {
        return yield* invariantError(
          command.type,
          `Task '${command.taskId}' was permanently deleted and cannot be archived.`,
        );
      }
      if (task.archivedAt !== null) {
        return yield* invariantError(command.type, `Task '${command.taskId}' is already archived.`);
      }
      yield* requireSettledTerminalTask({ command, task });
      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "task",
          aggregateId: command.taskId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "task.archived",
        payload: {
          taskId: command.taskId,
          archivedAt: occurredAt,
          updatedAt: occurredAt,
        },
      };
    }

    case "task.restore": {
      const task = yield* requireTask({
        readModel,
        command,
        taskId: command.taskId,
      });
      if (task.deletedAt !== null) {
        return yield* invariantError(
          command.type,
          `Task '${command.taskId}' was permanently deleted and cannot be restored.`,
        );
      }
      if (task.archivedAt === null) {
        return yield* invariantError(command.type, `Task '${command.taskId}' is not archived.`);
      }
      yield* requireSettledTerminalTask({ command, task });
      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "task",
          aggregateId: command.taskId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "task.restored",
        payload: {
          taskId: command.taskId,
          task: { ...task, archivedAt: null, updatedAt: occurredAt },
          updatedAt: occurredAt,
        },
      };
    }

    case "task.delete": {
      const task = yield* requireTask({
        readModel,
        command,
        taskId: command.taskId,
      });
      if (task.deletedAt !== null) {
        return yield* invariantError(
          command.type,
          `Task '${command.taskId}' is already permanently deleted.`,
        );
      }
      yield* requireSettledTerminalTask({ command, task });
      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "task",
          aggregateId: command.taskId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "task.deleted",
        payload: {
          taskId: command.taskId,
          deletedAt: occurredAt,
          updatedAt: occurredAt,
        },
      };
    }

    case "task.stage.start": {
      const task = yield* requireTask({
        readModel,
        command,
        taskId: command.taskId,
      });
      yield* requireTaskNotCancelling({ command, task });
      if (readModel.tasks.some((candidate) => candidate.parentTaskId === task.id)) {
        return yield* invariantError(command.type, "A split parent cannot run worker stages.");
      }
      const blockingDependencyId = (task.dependsOnTaskIds ?? []).find((dependencyId) => {
        const dependency = readModel.tasks.find((candidate) => candidate.id === dependencyId);
        return dependency === undefined || dependency.status !== "landed";
      });
      if (blockingDependencyId !== undefined) {
        return yield* invariantError(
          command.type,
          `Task '${command.taskId}' is blocked until dependency '${blockingDependencyId}' lands.`,
        );
      }
      const project = yield* requireProject({
        readModel,
        command,
        projectId: task.projectId,
      });
      yield* requireOrchestratorConfig({ command, project });
      yield* requireRegisteredTaskType({ command, taskTypeId: task.type });
      yield* requireReleaseSource({
        command,
        readModel,
        projectId: task.projectId,
        taskTypeId: task.type,
        dependsOnTaskIds: task.dependsOnTaskIds ?? [],
      });
      const projectConfig = explicitlySetProjectConfig(project.orchestratorConfig);
      const allowedStages = resolveStages({
        config: projectConfig,
        defaults: orchestratorDefaults,
        taskTypeId: task.type,
      });
      if (!allowedStages.includes(command.role)) {
        return yield* invariantError(
          command.type,
          `Stage role '${command.role}' is not enabled for task type '${task.type}'.`,
        );
      }

      if (task.currentStageThreadId !== null) {
        return yield* invariantError(
          command.type,
          `Task '${command.taskId}' already has an active stage '${task.currentStageThreadId}'.`,
        );
      }
      if (command.role === "verify" && task.changeReview?.status === "pending") {
        return yield* invariantError(
          command.type,
          `Task '${command.taskId}' cannot start verification while worktree changes await PM review.`,
        );
      }
      if (task.status === "blocked-on-quota") {
        const blockedStage = (readModel.quotaBlockedStages ?? [])
          .filter(
            (stage) =>
              stage.taskId === command.taskId &&
              stage.role === command.role &&
              stage.status === "blocked",
          )
          .toSorted(
            (left, right) =>
              right.blockedAt.localeCompare(left.blockedAt) ||
              right.stageThreadId.localeCompare(left.stageThreadId),
          )[0];
        if (blockedStage === undefined) {
          return yield* invariantError(
            command.type,
            `Task '${command.taskId}' is blocked on quota but has no resumable blocked stage for role '${command.role}'.`,
          );
        }
        const maxRetriesPerStage = resolveResourceLimit({
          config: projectConfig,
          defaults: orchestratorDefaults,
          key: "maxRetriesPerStage",
        });
        if (blockedStage.retryCount > maxRetriesPerStage) {
          return yield* invariantError(
            command.type,
            `Task '${command.taskId}' exceeded the quota retry limit for role '${command.role}' (${maxRetriesPerStage}).`,
          );
        }
      }

      const modelSelection = resolveStageModelSelection({
        orchestratorDefaults,
        project,
        task,
        role: command.role,
      });
      if (modelSelection === null || modelSelection === undefined) {
        return yield* invariantError(
          command.type,
          `Project '${task.projectId}' has no model selection for task stage role '${command.role}'.`,
        );
      }

      // A stage start is a new attempt, including retries. Never reuse the
      // prior provider thread: the task projection links ordered attempts via
      // stageThreadIds/stageHistory, while steering targets an existing thread.
      const crypto = yield* Crypto.Crypto;
      const stageThreadId = ThreadId.make(yield* crypto.randomUUIDv4);
      const messageId = MessageId.make(yield* crypto.randomUUIDv4);
      const stageInstructions = prepareStageInstructions({
        instructions: command.instructions,
        role: command.role,
        rolePromptPrefixes: project.rolePromptPrefixes,
      });
      const workerRuntimeMode = resolveWorkerStageRuntimeMode();

      const stageStartedEvent: PlannedOrchestrationEvent = {
        ...(yield* withEventBase({
          aggregateKind: "task",
          aggregateId: command.taskId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "task.stage-started",
        payload: {
          taskId: command.taskId,
          role: command.role,
          stageThreadId,
          awaitedTurnId: null,
          providerInstanceId: modelSelection.instanceId,
          model: modelSelection.model,
          runtimeMode: workerRuntimeMode,
          updatedAt: command.createdAt,
        },
      };
      const threadCreatedEvent: PlannedOrchestrationEvent = {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: stageThreadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        causationEventId: stageStartedEvent.eventId,
        type: "thread.created",
        payload: {
          threadId: stageThreadId,
          projectId: task.projectId,
          title: `${task.title} (${command.role})`,
          modelSelection,
          runtimeMode: workerRuntimeMode,
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          branch: task.branch,
          worktreePath: task.worktreePath,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
      const userMessageEvent: PlannedOrchestrationEvent = {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: stageThreadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        causationEventId: threadCreatedEvent.eventId,
        type: "thread.message-sent",
        payload: {
          threadId: stageThreadId,
          messageId,
          role: "user",
          text: stageInstructions,
          attachments: [],
          turnId: null,
          streaming: false,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
      const turnStartRequestedEvent: PlannedOrchestrationEvent = {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: stageThreadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        causationEventId: userMessageEvent.eventId,
        type: "thread.turn-start-requested",
        payload: {
          threadId: stageThreadId,
          messageId,
          modelSelection,
          runtimeMode: workerRuntimeMode,
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          createdAt: command.createdAt,
        },
      };

      return [stageStartedEvent, threadCreatedEvent, userMessageEvent, turnStartRequestedEvent];
    }

    case "task.stage.complete": {
      const task = yield* requireTask({
        readModel,
        command,
        taskId: command.taskId,
      });
      yield* requireTaskNotCancelling({ command, task });
      const project = yield* requireProject({
        readModel,
        command,
        projectId: task.projectId,
      });
      yield* requireOrchestratorConfig({ command, project });

      if (!task.stageThreadIds.includes(command.stageThreadId)) {
        return yield* invariantError(
          command.type,
          `Task '${command.taskId}' does not contain stage thread '${command.stageThreadId}'.`,
        );
      }
      if (task.currentStageThreadId !== command.stageThreadId) {
        return yield* invariantError(
          command.type,
          `Task '${command.taskId}' does not have active stage thread '${command.stageThreadId}'.`,
        );
      }
      const activeRole = activeStageRoleForTaskStatus(task.status);
      const hasApprovedPlanGateForStage = (readModel.pendingGates ?? []).some(
        (gate) =>
          gate.taskId === command.taskId &&
          gate.stageThreadId === command.stageThreadId &&
          gate.gate === "plan" &&
          gate.status === "resolved" &&
          gate.decision === "approved",
      );
      if (activeRole === null) {
        return yield* invariantError(
          command.type,
          `Task '${command.taskId}' has no active stage to complete.`,
        );
      }
      if (
        activeRole !== command.role &&
        !(command.role === "work" && hasApprovedPlanGateForStage)
      ) {
        return yield* invariantError(
          command.type,
          `Task '${command.taskId}' active stage role '${activeRole}' cannot be completed as '${command.role}'.`,
        );
      }
      if (
        command.role === "work" &&
        task.worktreePath !== null &&
        command.worktreeCompletion === undefined
      ) {
        return yield* invariantError(
          command.type,
          `Task '${command.taskId}' work completion must include the inspected worktree HEAD and dirty state.`,
        );
      }

      const stageCompletedEvent: PlannedOrchestrationEvent = {
        ...(yield* withEventBase({
          aggregateKind: "task",
          aggregateId: command.taskId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "task.stage-completed",
        payload: {
          taskId: command.taskId,
          role: command.role,
          stageThreadId: command.stageThreadId,
          awaitedTurnId: command.awaitedTurnId,
          // Pass the diff-completeness marker through unchanged; absent stays
          // absent (normal completion), `false` records a fail-loud timeout.
          ...(command.diffComplete !== undefined ? { diffComplete: command.diffComplete } : {}),
          ...(command.worktreeCompletion === undefined
            ? {}
            : { worktreeCompletion: command.worktreeCompletion }),
          updatedAt: command.createdAt,
        },
      };
      if (command.role !== "work" || command.worktreeCompletion?.dirty !== true) {
        return stageCompletedEvent;
      }
      const changeReviewEvent: PlannedOrchestrationEvent = {
        ...(yield* withEventBase({
          aggregateKind: "task",
          aggregateId: command.taskId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        causationEventId: stageCompletedEvent.eventId,
        type: "task.change-review-requested",
        payload: {
          taskId: command.taskId,
          workStageThreadId: command.stageThreadId,
          detectedHead: command.worktreeCompletion.head,
          requestedAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
      return [stageCompletedEvent, changeReviewEvent];
    }

    case "task.change-review.request": {
      const task = yield* requireTask({ readModel, command, taskId: command.taskId });
      yield* requireTaskNotCancelling({ command, task });
      if (task.status !== "review" || task.currentStageThreadId !== null) {
        return yield* invariantError(
          command.type,
          `Task '${command.taskId}' must have settled work in review before remaining changes can be reviewed.`,
        );
      }
      const workStage = readModel.stageHistory[command.workStageThreadId];
      if (
        !task.stageThreadIds.includes(command.workStageThreadId) ||
        workStage?.taskId !== task.id ||
        workStage.role !== "work" ||
        workStage.status !== "completed"
      ) {
        return yield* invariantError(
          command.type,
          `Stage thread '${command.workStageThreadId}' is not completed work for task '${command.taskId}'.`,
        );
      }
      if (task.changeReview?.status === "pending") {
        return yield* invariantError(
          command.type,
          `Task '${command.taskId}' already has a pending change review.`,
        );
      }
      return {
        ...(yield* withEventBase({
          aggregateKind: "task",
          aggregateId: command.taskId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "task.change-review-requested",
        payload: {
          taskId: command.taskId,
          workStageThreadId: command.workStageThreadId,
          detectedHead: command.detectedHead,
          requestedAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "task.change-review.resolve": {
      const task = yield* requireTask({ readModel, command, taskId: command.taskId });
      yield* requireTaskNotCancelling({ command, task });
      if (task.status !== "change-review" || task.changeReview?.status !== "pending") {
        return yield* invariantError(
          command.type,
          `Task '${command.taskId}' does not have a pending change review.`,
        );
      }
      return {
        ...(yield* withEventBase({
          aggregateKind: "task",
          aggregateId: command.taskId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "task.change-review-resolved",
        payload: {
          taskId: command.taskId,
          resolution: command.resolution,
          resolvedAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "task.verification.record": {
      const task = yield* requireTask({ readModel, command, taskId: command.taskId });
      yield* requireTaskNotCancelling({ command, task });
      const verifyStage = readModel.stageHistory[command.stageThreadId];
      if (
        task.currentStageThreadId !== null ||
        !task.stageThreadIds.includes(command.stageThreadId) ||
        verifyStage?.taskId !== task.id ||
        verifyStage.role !== "verify" ||
        verifyStage.status !== "completed"
      ) {
        return yield* invariantError(
          command.type,
          `Stage thread '${command.stageThreadId}' is not completed verification for task '${command.taskId}'.`,
        );
      }
      return {
        ...(yield* withEventBase({
          aggregateKind: "task",
          aggregateId: command.taskId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "task.verification-recorded",
        payload: {
          taskId: command.taskId,
          stageThreadId: command.stageThreadId,
          head: command.head,
          verifiedAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "task.no-changes-needed": {
      const task = yield* requireTask({ readModel, command, taskId: command.taskId });
      yield* requireTaskNotCancelling({ command, task });
      if (task.status !== "review" || task.currentStageThreadId !== null) {
        return yield* invariantError(
          command.type,
          `Task '${command.taskId}' must have settled work in review before it can complete without changes.`,
        );
      }
      if (command.baseHead !== command.head) {
        return yield* invariantError(
          command.type,
          `Task '${command.taskId}' cannot complete without changes because HEAD differs from its base.`,
        );
      }
      return {
        ...(yield* withEventBase({
          aggregateKind: "task",
          aggregateId: command.taskId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "task.no-changes-needed",
        payload: {
          taskId: command.taskId,
          baseHead: command.baseHead,
          head: command.head,
          completedAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "task.stage.block": {
      const task = yield* requireTask({
        readModel,
        command,
        taskId: command.taskId,
      });
      yield* requireTaskNotCancelling({ command, task });
      const project = yield* requireProject({
        readModel,
        command,
        projectId: task.projectId,
      });
      yield* requireOrchestratorConfig({ command, project });

      if (!task.stageThreadIds.includes(command.stageThreadId)) {
        return yield* invariantError(
          command.type,
          `Task '${command.taskId}' does not contain stage thread '${command.stageThreadId}'.`,
        );
      }
      if (task.currentStageThreadId !== command.stageThreadId) {
        return yield* invariantError(
          command.type,
          `Task '${command.taskId}' does not have active stage thread '${command.stageThreadId}'.`,
        );
      }
      const activeRole = activeStageRoleForTaskStatus(task.status);
      if (activeRole === null) {
        return yield* invariantError(
          command.type,
          `Task '${command.taskId}' has no active stage to block.`,
        );
      }
      if (activeRole !== command.role) {
        return yield* invariantError(
          command.type,
          `Task '${command.taskId}' active stage role '${activeRole}' cannot be blocked as '${command.role}'.`,
        );
      }

      return {
        ...(yield* withEventBase({
          aggregateKind: "task",
          aggregateId: command.taskId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "task.stage-blocked",
        payload: {
          taskId: command.taskId,
          role: command.role,
          stageThreadId: command.stageThreadId,
          reason: command.reason,
          providerInstanceId: command.providerInstanceId,
          ...(command.resetAt !== undefined ? { resetAt: command.resetAt } : {}),
          updatedAt: command.createdAt,
        },
      };
    }

    case "task.stage.interrupt": {
      const task = yield* requireTask({
        readModel,
        command,
        taskId: command.taskId,
      });
      yield* requireTaskNotCancelling({ command, task });

      if (!task.stageThreadIds.includes(command.stageThreadId)) {
        return yield* invariantError(
          command.type,
          `Task '${command.taskId}' does not contain stage thread '${command.stageThreadId}'.`,
        );
      }
      if (task.currentStageThreadId !== command.stageThreadId) {
        return yield* invariantError(
          command.type,
          `Task '${command.taskId}' does not have active stage thread '${command.stageThreadId}'.`,
        );
      }
      const activeRole = activeStageRoleForTaskStatus(task.status);
      if (activeRole === null) {
        return yield* invariantError(
          command.type,
          `Task '${command.taskId}' has no active stage to interrupt.`,
        );
      }
      if (activeRole !== command.role) {
        return yield* invariantError(
          command.type,
          `Task '${command.taskId}' active stage role '${activeRole}' cannot be interrupted as '${command.role}'.`,
        );
      }

      return {
        ...(yield* withEventBase({
          aggregateKind: "task",
          aggregateId: command.taskId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "task.stage-interrupted",
        payload: {
          taskId: command.taskId,
          role: command.role,
          stageThreadId: command.stageThreadId,
          reason: command.reason,
          updatedAt: command.createdAt,
        },
      };
    }

    case "task.gate.request": {
      const task = yield* requireTask({
        readModel,
        command,
        taskId: command.taskId,
      });
      yield* requireTaskNotCancelling({ command, task });
      const project = yield* requireProject({
        readModel,
        command,
        projectId: task.projectId,
      });
      yield* requireOrchestratorConfig({ command, project });
      yield* requireRegisteredTaskType({ command, taskTypeId: task.type });
      if (command.gate === "release") {
        if (task.type !== "release" || task.status !== "landed" || task.prUrl === null) {
          return yield* invariantError(
            command.type,
            "Release approval requires a fully landed release task with a pull request.",
          );
        }
        yield* requireReleaseSource({
          command,
          readModel,
          projectId: task.projectId,
          taskTypeId: task.type,
          dependsOnTaskIds: task.dependsOnTaskIds ?? [],
        });
      }
      const projectConfig = explicitlySetProjectConfig(project.orchestratorConfig);
      const gatePolicy = resolveGatePolicy({
        config: projectConfig,
        defaults: orchestratorDefaults,
        taskTypeId: task.type,
        gate: command.gate,
      });
      const gateRequestedEvent: PlannedOrchestrationEvent = {
        ...(yield* withEventBase({
          aggregateKind: "task",
          aggregateId: command.taskId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "task.gate-requested",
        payload: {
          taskId: command.taskId,
          gateId: command.gateId,
          gate: command.gate,
          contentHash: command.contentHash,
          stageThreadId: command.stageThreadId,
          updatedAt: command.createdAt,
        },
      };

      if (gatePolicy !== "auto" || command.gate === "land" || command.gate === "release") {
        return [gateRequestedEvent];
      }

      const gateResolvedEvent: PlannedOrchestrationEvent = {
        ...(yield* withEventBase({
          aggregateKind: "task",
          aggregateId: command.taskId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "task.gate-resolved",
        payload: {
          taskId: command.taskId,
          gateId: command.gateId,
          gate: command.gate,
          approvedHash: command.contentHash,
          decision: "approved",
          origin: "system",
          updatedAt: command.createdAt,
        },
      };

      return [gateRequestedEvent, gateResolvedEvent];
    }

    case "task.gate.resolve": {
      const task = yield* requireTask({
        readModel,
        command,
        taskId: command.taskId,
      });
      yield* requireTaskNotCancelling({ command, task });
      const project = yield* requireProject({
        readModel,
        command,
        projectId: task.projectId,
      });
      yield* requireOrchestratorConfig({ command, project });
      if (command.origin !== "human" && command.origin !== "client") {
        return yield* invariantError(
          command.type,
          `Gate '${command.gateId}' cannot be resolved by origin '${command.origin}'.`,
        );
      }
      const pendingGate = (readModel.pendingGates ?? []).find(
        (gate) => gate.gateId === command.gateId,
      );
      if (
        !pendingGate ||
        pendingGate.taskId !== command.taskId ||
        pendingGate.gate !== command.gate
      ) {
        return yield* invariantError(
          command.type,
          `Gate '${command.gateId}' is not pending for task '${command.taskId}'.`,
        );
      }
      if (pendingGate.status !== "pending") {
        return yield* invariantError(
          command.type,
          `Gate '${command.gateId}' has already been resolved.`,
        );
      }
      if (pendingGate.contentHash !== command.approvedHash) {
        return yield* invariantError(
          command.type,
          `Gate '${command.gateId}' approved hash does not match the pending content hash.`,
        );
      }
      if (command.gate === "plan" && task.status !== "plan-review") {
        return yield* invariantError(
          command.type,
          `Plan gate '${command.gateId}' is not pending for task '${command.taskId}'.`,
        );
      }
      if (command.gate === "land" && task.status !== "review") {
        return yield* invariantError(
          command.type,
          `Land gate '${command.gateId}' is not pending for task '${command.taskId}'.`,
        );
      }
      if (
        command.gate === "release" &&
        (task.type !== "release" || task.status !== "landed" || task.prUrl === null)
      ) {
        return yield* invariantError(
          command.type,
          `Release gate '${command.gateId}' is not pending for a fully landed release task.`,
        );
      }
      return {
        ...(yield* withEventBase({
          aggregateKind: "task",
          aggregateId: command.taskId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "task.gate-resolved",
        payload: {
          taskId: command.taskId,
          gateId: command.gateId,
          gate: command.gate,
          approvedHash: command.approvedHash,
          decision: command.decision,
          origin: command.origin,
          updatedAt: command.createdAt,
        },
      };
    }

    case "task.land": {
      const task = yield* requireTask({
        readModel,
        command,
        taskId: command.taskId,
      });
      const project = yield* requireProject({
        readModel,
        command,
        projectId: task.projectId,
      });
      yield* requireOrchestratorConfig({ command, project });
      yield* requireTaskNotCancelling({ command, task });
      if (task.status !== "review") {
        return yield* invariantError(
          command.type,
          `Task '${command.taskId}' must be in review before it can land.`,
        );
      }
      if (task.currentStageThreadId !== null) {
        return yield* invariantError(
          command.type,
          `Task '${command.taskId}' cannot land while stage '${task.currentStageThreadId}' is active.`,
        );
      }
      yield* requireFreshVerification({ command, readModel, task });
      const latestLandGate = (readModel.pendingGates ?? []).findLast(
        (gate) => gate.taskId === command.taskId && gate.gate === "land",
      );
      if (
        latestLandGate === undefined ||
        latestLandGate.status !== "resolved" ||
        latestLandGate.decision !== "approved" ||
        latestLandGate.approvedHash !== latestLandGate.contentHash
      ) {
        return yield* invariantError(
          command.type,
          `Task '${command.taskId}' cannot land without a current, content-matched approved land gate.`,
        );
      }
      return {
        ...(yield* withEventBase({
          aggregateKind: "task",
          aggregateId: command.taskId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "task.landed",
        payload: {
          taskId: command.taskId,
          updatedAt: command.createdAt,
        },
      };
    }

    case "task.landing.retry": {
      const task = yield* requireTask({
        readModel,
        command,
        taskId: command.taskId,
      });
      yield* requireTaskNotCancelling({ command, task });
      if (
        task.status !== "landed" ||
        task.prUrl !== null ||
        task.worktreePath === null ||
        task.landing?.status !== "failed"
      ) {
        return yield* invariantError(
          command.type,
          `Task '${command.taskId}' must have an exhausted landing failure and a retained worktree before landing can be retried.`,
        );
      }
      return {
        ...(yield* withEventBase({
          aggregateKind: "task",
          aggregateId: command.taskId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "task.landing-retry-requested",
        payload: {
          taskId: command.taskId,
          updatedAt: command.createdAt,
        },
      };
    }

    case "task.release.dispatch.request": {
      const task = yield* requireTask({
        readModel,
        command,
        taskId: command.taskId,
      });
      yield* requireTaskNotCancelling({ command, task });
      if (task.type !== "release" || task.status !== "landed" || task.prUrl === null) {
        return yield* invariantError(
          command.type,
          `Task '${command.taskId}' must be a fully landed release task before dispatch.`,
        );
      }
      if (task.currentStageThreadId !== null) {
        return yield* invariantError(
          command.type,
          `Task '${command.taskId}' cannot dispatch while a worker stage is active.`,
        );
      }
      yield* requireReleaseSource({
        command,
        readModel,
        projectId: task.projectId,
        taskTypeId: task.type,
        dependsOnTaskIds: task.dependsOnTaskIds ?? [],
      });
      if (task.releaseDispatch !== null) {
        return yield* invariantError(
          command.type,
          `Task '${command.taskId}' already has an authoritative release dispatch attempt.`,
        );
      }
      const latestReleaseGate = (readModel.pendingGates ?? []).findLast(
        (gate) => gate.taskId === command.taskId && gate.gate === "release",
      );
      if (
        latestReleaseGate === undefined ||
        latestReleaseGate.status !== "resolved" ||
        latestReleaseGate.decision !== "approved" ||
        latestReleaseGate.approvedHash !== command.contentHash ||
        latestReleaseGate.contentHash !== command.contentHash
      ) {
        return yield* invariantError(
          command.type,
          `Task '${command.taskId}' cannot dispatch without a content-matched approved release gate.`,
        );
      }
      return {
        ...(yield* withEventBase({
          aggregateKind: "task",
          aggregateId: command.taskId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "task.release-dispatch-requested",
        payload: {
          taskId: command.taskId,
          workflow: command.workflow,
          ref: command.ref,
          inputs: command.inputs,
          contentHash: command.contentHash,
          requestedAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "task.release.dispatch.complete":
    case "task.release.dispatch.fail": {
      const task = yield* requireTask({
        readModel,
        command,
        taskId: command.taskId,
      });
      if (task.releaseDispatch?.status !== "dispatching") {
        return yield* invariantError(
          command.type,
          `Task '${command.taskId}' has no in-progress release dispatch.`,
        );
      }
      return {
        ...(yield* withEventBase({
          aggregateKind: "task",
          aggregateId: command.taskId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type:
          command.type === "task.release.dispatch.complete"
            ? "task.release-dispatched"
            : "task.release-dispatch-failed",
        payload:
          command.type === "task.release.dispatch.complete"
            ? {
                taskId: command.taskId,
                workflowUrl: command.workflowUrl,
                updatedAt: command.createdAt,
              }
            : {
                taskId: command.taskId,
                message: command.message,
                updatedAt: command.createdAt,
              },
      };
    }

    case "task.pr.opened": {
      const task = yield* requireTask({
        readModel,
        command,
        taskId: command.taskId,
      });
      yield* requireTaskNotCancelling({ command, task });
      const project = yield* requireProject({
        readModel,
        command,
        projectId: task.projectId,
      });
      yield* requireOrchestratorConfig({ command, project });

      return {
        ...(yield* withEventBase({
          aggregateKind: "task",
          aggregateId: command.taskId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "task.pr-opened",
        payload: {
          taskId: command.taskId,
          prUrl: command.prUrl,
          ...(command.prNumber !== undefined ? { prNumber: command.prNumber } : {}),
          updatedAt: command.createdAt,
        },
      };
    }

    case "task.pr.open.failed": {
      const task = yield* requireTask({
        readModel,
        command,
        taskId: command.taskId,
      });
      yield* requireTaskNotCancelling({ command, task });
      if (task.status !== "landed" || task.prUrl !== null) {
        return yield* invariantError(
          command.type,
          `Task '${command.taskId}' must be landed without an opened PR before PR failure can be recorded.`,
        );
      }
      return {
        ...(yield* withEventBase({
          aggregateKind: "task",
          aggregateId: command.taskId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "task.pr-open-failed",
        payload: {
          taskId: command.taskId,
          message: command.message,
          branchPushed: command.branchPushed,
          updatedAt: command.createdAt,
        },
      };
    }

    case "task.abandon": {
      const task = yield* requireTask({
        readModel,
        command,
        taskId: command.taskId,
      });
      const project = yield* requireProject({
        readModel,
        command,
        projectId: task.projectId,
      });
      yield* requireOrchestratorConfig({ command, project });
      if (isTerminalTaskStatus(task.status)) {
        return yield* invariantError(
          command.type,
          `Task '${command.taskId}' is already terminal with status '${task.status}'.`,
        );
      }
      if (task.cancellation == null) {
        return yield* invariantError(
          command.type,
          `Task '${command.taskId}' cannot be abandoned without a cancellation reservation.`,
        );
      }
      return {
        ...(yield* withEventBase({
          aggregateKind: "task",
          aggregateId: command.taskId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "task.abandoned",
        payload: {
          taskId: command.taskId,
          updatedAt: command.createdAt,
        },
      };
    }

    case "task.cancellation.request": {
      const task = yield* requireTask({
        readModel,
        command,
        taskId: command.taskId,
      });
      const project = yield* requireProject({
        readModel,
        command,
        projectId: task.projectId,
      });
      yield* requireOrchestratorConfig({ command, project });
      if (isTerminalTaskStatus(task.status)) {
        return yield* invariantError(
          command.type,
          `Task '${command.taskId}' is already terminal with status '${task.status}'.`,
        );
      }
      if (task.cancellation != null) {
        return yield* invariantError(
          command.type,
          `Task '${command.taskId}' already has cancellation reserved.`,
        );
      }
      return {
        ...(yield* withEventBase({
          aggregateKind: "task",
          aggregateId: command.taskId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "task.cancellation-requested",
        payload: {
          taskId: command.taskId,
          requestedAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "task.cancellation.fail": {
      const task = yield* requireTask({
        readModel,
        command,
        taskId: command.taskId,
      });
      if (task.cancellation == null) {
        return yield* invariantError(
          command.type,
          `Task '${command.taskId}' has no cancellation reservation.`,
        );
      }
      if (isTerminalTaskStatus(task.status)) {
        return yield* invariantError(
          command.type,
          `Task '${command.taskId}' is already terminal with status '${task.status}'.`,
        );
      }
      return {
        ...(yield* withEventBase({
          aggregateKind: "task",
          aggregateId: command.taskId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "task.cancellation-failed",
        payload: {
          taskId: command.taskId,
          phase: command.phase,
          message: command.message,
          failedAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "task.cancellation.phase.complete": {
      const task = yield* requireTask({
        readModel,
        command,
        taskId: command.taskId,
      });
      if (task.cancellation == null) {
        return yield* invariantError(
          command.type,
          `Task '${command.taskId}' has no cancellation reservation.`,
        );
      }
      if (isTerminalTaskStatus(task.status)) {
        return yield* invariantError(
          command.type,
          `Task '${command.taskId}' is already terminal with status '${task.status}'.`,
        );
      }
      return {
        ...(yield* withEventBase({
          aggregateKind: "task",
          aggregateId: command.taskId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "task.cancellation-phase-completed",
        payload: {
          taskId: command.taskId,
          phase: command.phase,
          updatedAt: command.createdAt,
        },
      };
    }

    default: {
      command satisfies never;
      const fallback = command as never as { type: string };
      return yield* new OrchestrationCommandInvariantError({
        commandType: fallback.type,
        detail: `Unknown command type: ${fallback.type}`,
      });
    }
  }
});
