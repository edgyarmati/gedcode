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
} from "@t3tools/contracts";
import {
  resolveAllowFullAccessWorkers,
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

function taskWorktreePath(input: { readonly workspaceRoot: string; readonly taskId: string }) {
  return `${input.workspaceRoot.replace(/[\\/]+$/, "")}/.gedcode/orchestrator/tasks/${input.taskId}`;
}

function invariantError(commandType: string, detail: string): OrchestrationCommandInvariantError {
  return new OrchestrationCommandInvariantError({
    commandType,
    detail,
  });
}

function requireOrchestratorEnabled(input: {
  readonly command: OrchestrationCommand;
  readonly project: OrchestrationProject;
}): Effect.Effect<OrchestratorProjectConfig, OrchestrationCommandInvariantError> {
  const config = decodeOrchestratorConfig(input.project.orchestratorConfig ?? {});
  if (Option.isSome(config) && config.value.enabled === true) {
    return Effect.succeed(config.value);
  }
  return Effect.fail(
    invariantError(
      input.command.type,
      `Orchestrator mode is not enabled for project '${input.project.id}'.`,
    ),
  );
}

function isTerminalTaskStatus(status: OrchestrationReadModel["tasks"][number]["status"]): boolean {
  return status === "landed" || status === "abandoned";
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
  switch (command.type) {
    case "project.create": {
      yield* requireProjectAbsent({
        readModel,
        command,
        projectId: command.projectId,
      });

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
      yield* requireProject({
        readModel,
        command,
        projectId: command.projectId,
      });
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
          runtimeMode: command.runtimeMode,
          interactionMode: command.interactionMode,
          branch: command.branch,
          worktreePath: command.worktreePath,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
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
      yield* requireOrchestratorEnabled({ command, project });
      yield* requireTaskAbsent({
        readModel,
        command,
        taskId: command.taskId,
      });
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
          playbookVersion: null,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "task.classify": {
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
      yield* requireOrchestratorEnabled({ command, project });
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
      const project = yield* requireProject({
        readModel,
        command,
        projectId: task.projectId,
      });
      yield* requireOrchestratorEnabled({ command, project });
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

    case "task.stage.start": {
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
      yield* requireOrchestratorEnabled({ command, project });
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
      const maxStageHandoffs = resolveResourceLimit({
        config: projectConfig,
        defaults: orchestratorDefaults,
        key: "maxStageHandoffs",
      });
      if (task.stageThreadIds.length >= maxStageHandoffs) {
        return yield* invariantError(
          command.type,
          `Task '${command.taskId}' exceeded the stage handoff limit (${maxStageHandoffs}).`,
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

      const crypto = yield* Crypto.Crypto;
      const stageThreadId = ThreadId.make(yield* crypto.randomUUIDv4);
      const messageId = MessageId.make(yield* crypto.randomUUIDv4);
      const stageInstructions = prepareStageInstructions({
        instructions: command.instructions,
        role: command.role,
        rolePromptPrefixes: project.rolePromptPrefixes,
      });
      const workerRuntimeMode = resolveWorkerStageRuntimeMode({
        allowFullAccessWorkers: resolveAllowFullAccessWorkers({
          config: projectConfig,
          defaults: orchestratorDefaults,
        }),
      });

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
      const project = yield* requireProject({
        readModel,
        command,
        projectId: task.projectId,
      });
      yield* requireOrchestratorEnabled({ command, project });

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

      return {
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
      const project = yield* requireProject({
        readModel,
        command,
        projectId: task.projectId,
      });
      yield* requireOrchestratorEnabled({ command, project });

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

    case "task.gate.request": {
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
      yield* requireOrchestratorEnabled({ command, project });
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

      if (gatePolicy !== "auto" || command.gate === "land") {
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
      const project = yield* requireProject({
        readModel,
        command,
        projectId: task.projectId,
      });
      yield* requireOrchestratorEnabled({ command, project });
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
      yield* requireOrchestratorEnabled({ command, project });
      if (task.status !== "review") {
        return yield* invariantError(
          command.type,
          `Task '${command.taskId}' must be in review before it can land.`,
        );
      }
      const approvedLandGate = (readModel.pendingGates ?? []).find(
        (gate) =>
          gate.taskId === command.taskId &&
          gate.gate === "land" &&
          gate.status === "resolved" &&
          gate.decision === "approved",
      );
      if (!approvedLandGate) {
        return yield* invariantError(
          command.type,
          `Task '${command.taskId}' cannot land without an approved land gate.`,
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

    case "task.pr.opened": {
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
      yield* requireOrchestratorEnabled({ command, project });

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
      yield* requireOrchestratorEnabled({ command, project });
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
        type: "task.abandoned",
        payload: {
          taskId: command.taskId,
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
