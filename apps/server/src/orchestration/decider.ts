import {
  DEFAULT_PROVIDER_INTERACTION_MODE,
  EventId,
  MessageId,
  OrchestratorProjectConfig,
  ThreadId,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationProject,
  type OrchestrationProjectContextRun,
  type OrchestrationReadModel,
  type OrchestrationThread,
} from "@t3tools/contracts";
import { buildOrchestratorTaskBranchName } from "@t3tools/shared/git";
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
import { resolveCapabilityPreset, resolveStageModelSelection } from "./stageModelSelection.ts";
import { activeStageRoleForTaskStatus, prepareStageInstructions } from "./stageResolution.ts";
import { appendCompletedHelperContext } from "./helperRunContext.ts";
import {
  explicitlySetProjectConfig,
  type SparseOrchestratorDefaults,
} from "./orchestratorConfigResolution.ts";
import { resolveWorkerStageRuntimeMode } from "./workerSafety.ts";

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
const decodeOrchestratorConfig = Schema.decodeUnknownOption(OrchestratorProjectConfig);
const defaultOrchestratorConfig = Option.getOrThrow(decodeOrchestratorConfig({}));
const ACTIVE_PROJECT_CONTEXT_RUN_STATUSES = new Set(["pending", "running", "pending-review"]);

function requireNoActiveProjectContextRun(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly projectId: OrchestrationProject["id"];
  readonly operation: "delete" | "relocate its workspace root";
}): Effect.Effect<void, OrchestrationCommandInvariantError> {
  const activeRun = input.readModel.projectContextRuns.find(
    (run) =>
      run.projectId === input.projectId && ACTIVE_PROJECT_CONTEXT_RUN_STATUSES.has(run.status),
  );
  if (activeRun === undefined) return Effect.void;
  return Effect.fail(
    invariantError(
      input.command.type,
      `Project '${input.projectId}' cannot ${input.operation} while project-context run '${activeRun.id}' is '${activeRun.status}'. Interrupt the run or resolve its pending review first.`,
    ),
  );
}

function projectContextRunPrompt(
  mode: "populate" | "review",
  repositoryPullRequestGuidancePaths: ReadonlyArray<string>,
): string {
  const action =
    mode === "populate"
      ? "Populate missing or stub project guidance with concise, project-specific content."
      : "Review the existing project guidance and improve only material inaccuracies or omissions.";
  return [
    "You are maintaining the shared project context in the primary checkout.",
    action,
    "Inspect repository contribution guidance before editing context: root, .github, and docs CONTRIBUTING.md files; root, docs, and .github pull_request_template.md files; every Markdown template directly under .github/PULL_REQUEST_TEMPLATE/; and relevant PR rules in AGENTS.md.",
    repositoryPullRequestGuidancePaths.length === 0
      ? "The server found no conventional public contribution document or pull-request template; inspect AGENTS.md for PR-specific rules and create .ged/PULL_REQUESTS.md if it provides none."
      : `The server found these conventional public guidance files; read them as current authoritative inputs: ${repositoryPullRequestGuidancePaths.join(", ")}.`,
    "Public contribution documents and pull-request templates are authoritative read-only inputs. Never create or edit them. If none of those sources defines pull-request guidance, create or improve .ged/PULL_REQUESTS.md with a concise internal convention covering purpose, behavioral changes, concrete verification, risks/migrations, visual evidence when relevant, and issue/task links. If public guidance exists, do not duplicate it into a new fallback file; retain an existing .ged/PULL_REQUESTS.md only when it adds non-conflicting project-specific guidance.",
    "You may change only AGENTS.md, CONTEXT.md, .ged/PROJECT.md, .ged/ARCHITECTURE.md, .ged/PULL_REQUESTS.md, and direct Markdown files under docs/adr/.",
    "Do not edit .ged/MANIFEST.json; GedCode writes it after auditing your documentation changes.",
    "Do not modify application code, runtime state, task files, generated files, secrets, Git history, branches, worktrees, commits, pull requests, or orchestration state.",
    "Do not create tasks, stages, gates, worktrees, commits, pull requests, or delegate to another agent.",
    "Finish with a concise summary of the context changes for human diff review.",
  ].join(" ");
}

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

function requireProjectContextRun(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly projectContextRunId: OrchestrationProjectContextRun["id"];
}): Effect.Effect<OrchestrationProjectContextRun, OrchestrationCommandInvariantError> {
  const run = input.readModel.projectContextRuns.find(
    (candidate) => candidate.id === input.projectContextRunId,
  );
  return run === undefined
    ? Effect.fail(
        invariantError(
          input.command.type,
          `Project-context run '${input.projectContextRunId}' does not exist.`,
        ),
      )
    : Effect.succeed(run);
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
  readonly worktreeCompletion: { readonly head: string; readonly dirty: boolean } | undefined;
}): Effect.Effect<void, OrchestrationCommandInvariantError> {
  const completedStages = Object.values(input.readModel.stageHistory).filter(
    (stage) =>
      stage.taskId === input.task.id && stage.status === "completed" && stage.endedAt !== null,
  );
  const latestCompletedStage = (role: "work" | "verify") =>
    completedStages
      .filter((stage) => stage.role === role)
      .toSorted((left, right) => right.endedAt!.localeCompare(left.endedAt!))[0];
  const latestWork = latestCompletedStage("work");
  const latestVerify = latestCompletedStage("verify");
  const verification = input.task.verification;

  if (
    verification !== null &&
    latestVerify !== undefined &&
    verification.stageThreadId === latestVerify.stageThreadId &&
    (latestWork === undefined || latestVerify.endedAt! > latestWork.endedAt!)
  ) {
    if (input.worktreeCompletion === undefined) {
      return Effect.fail(
        invariantError(
          input.command.type,
          `Task '${input.task.id}' must have its worktree inspected before land approval or landing.`,
        ),
      );
    }
    if (input.worktreeCompletion.dirty) {
      return Effect.fail(
        invariantError(
          input.command.type,
          `Task '${input.task.id}' cannot be approved or landed while its worktree has uncommitted changes.`,
        ),
      );
    }
    if (input.worktreeCompletion.head !== verification.head) {
      return Effect.fail(
        invariantError(
          input.command.type,
          `Task '${input.task.id}' cannot be approved or landed because HEAD '${input.worktreeCompletion.head}' differs from verified HEAD '${verification.head}'.`,
        ),
      );
    }
    return Effect.void;
  }

  return Effect.fail(
    invariantError(
      input.command.type,
      verification === null || latestVerify === undefined
        ? `Task '${input.task.id}' cannot be approved or landed without verification recorded against its worktree HEAD.`
        : `Task '${input.task.id}' cannot be approved or landed because its recorded verification is stale.`,
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
      if (command.workspaceRoot !== undefined && command.workspaceRoot !== project.workspaceRoot) {
        yield* requireNoActiveProjectContextRun({
          readModel,
          command,
          projectId: command.projectId,
          operation: "relocate its workspace root",
        });
      }
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

    case "project.context.run.request": {
      const project = yield* requireProject({
        readModel,
        command,
        projectId: command.projectId,
      });
      if (project.deletedAt !== null) {
        return yield* invariantError(
          command.type,
          `Project '${project.id}' was deleted before its project-context baseline could be requested.`,
        );
      }
      if (project.workspaceRoot !== command.expectedPrimaryCheckoutPath) {
        return yield* invariantError(
          command.type,
          `Project '${project.id}' primary checkout changed from '${command.expectedPrimaryCheckoutPath}' to '${project.workspaceRoot}' while capturing its project-context baseline.`,
        );
      }
      if (readModel.projectContextRuns.some((run) => run.id === command.projectContextRunId)) {
        return yield* invariantError(
          command.type,
          `Project-context run '${command.projectContextRunId}' already exists.`,
        );
      }
      const activeRun = readModel.projectContextRuns.find(
        (run) =>
          run.projectId === command.projectId &&
          ACTIVE_PROJECT_CONTEXT_RUN_STATUSES.has(run.status),
      );
      if (activeRun !== undefined) {
        return yield* invariantError(
          command.type,
          `Project '${command.projectId}' already has active project-context run '${activeRun.id}'.`,
        );
      }
      const baselinePaths = new Set(command.baselineManifest.map((entry) => entry.path));
      if (baselinePaths.size !== command.baselineManifest.length) {
        return yield* invariantError(
          command.type,
          "Project-context baseline manifest contains duplicate paths.",
        );
      }
      for (let index = 1; index < command.workspaceStatusManifest.length; index += 1) {
        const previous = command.workspaceStatusManifest[index - 1];
        const current = command.workspaceStatusManifest[index];
        if (
          previous === undefined ||
          current === undefined ||
          previous.relativePath >= current.relativePath
        ) {
          return yield* invariantError(
            command.type,
            "Project-context workspace status manifest must have unique, code-unit-sorted paths.",
          );
        }
      }
      const tier = command.tier ?? "smart";
      const modelSelection = resolveCapabilityPreset({
        orchestratorDefaults,
        projectConfig: explicitlySetProjectConfig(project.orchestratorConfig),
        tier,
      });
      if (modelSelection === null) {
        return yield* invariantError(
          command.type,
          `Project '${project.id}' has no configured '${tier}' capability preset.`,
        );
      }
      const pmTurnRunning = readModel.threads.some(
        (thread) =>
          thread.projectId === project.id &&
          String(thread.id) === `pm:${project.id}` &&
          thread.latestTurn?.state === "running",
      );
      return {
        ...(yield* withEventBase({
          aggregateKind: "project-context-run",
          aggregateId: command.projectContextRunId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "project.context-run-requested",
        payload: {
          projectContextRunId: command.projectContextRunId,
          projectId: command.projectId,
          mode: command.mode,
          tier,
          providerInstanceId: modelSelection.instanceId,
          model: modelSelection.model,
          modelOptions: modelSelection.options ?? null,
          primaryCheckoutPath: project.workspaceRoot,
          schemaVersion: command.schemaVersion,
          fingerprint: command.fingerprint,
          prompt: projectContextRunPrompt(
            command.mode,
            command.repositoryPullRequestGuidancePaths ?? [],
          ),
          baselineManifest: command.baselineManifest,
          workspaceStatusManifest: command.workspaceStatusManifest,
          gitState: command.gitState,
          pmStartState: pmTurnRunning ? "awaiting-user" : "ready",
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "project.context.run.prepare-start": {
      const run = yield* requireProjectContextRun({
        readModel,
        command,
        projectContextRunId: command.projectContextRunId,
      });
      if (run.status !== "pending" || run.pmStartState !== "awaiting-user") {
        return yield* invariantError(
          command.type,
          `Project-context run '${run.id}' cannot prepare PM settlement from '${run.status}/${run.pmStartState}'.`,
        );
      }
      return {
        ...(yield* withEventBase({
          aggregateKind: "project-context-run",
          aggregateId: run.id,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "project.context-run-start-prepared",
        payload: {
          projectContextRunId: run.id,
          pmStartState: command.action === "wait" ? "waiting-for-idle" : "interrupting",
          updatedAt: command.createdAt,
        },
      };
    }

    case "project.context.run.refresh-baseline": {
      const run = yield* requireProjectContextRun({
        readModel,
        command,
        projectContextRunId: command.projectContextRunId,
      });
      if (
        run.status !== "pending" ||
        (run.pmStartState !== "waiting-for-idle" && run.pmStartState !== "interrupting")
      ) {
        return yield* invariantError(
          command.type,
          `Project-context run '${run.id}' cannot refresh its baseline from '${run.status}/${run.pmStartState}'.`,
        );
      }
      return {
        ...(yield* withEventBase({
          aggregateKind: "project-context-run",
          aggregateId: run.id,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "project.context-run-baseline-refreshed",
        payload: {
          projectContextRunId: run.id,
          schemaVersion: command.schemaVersion,
          fingerprint: command.fingerprint,
          baselineManifest: command.baselineManifest,
          workspaceStatusManifest: command.workspaceStatusManifest,
          gitState: command.gitState,
          updatedAt: command.createdAt,
        },
      };
    }

    case "project.context.run.apply": {
      const run = yield* requireProjectContextRun({
        readModel,
        command,
        projectContextRunId: command.projectContextRunId,
      });
      yield* requireProject({ readModel, command, projectId: run.projectId });
      if (run.status !== "running") {
        return yield* invariantError(
          command.type,
          `Project-context run '${run.id}' cannot be applied from '${run.status}'.`,
        );
      }
      const changePaths = new Set(command.changes.map((change) => change.path));
      if (changePaths.size !== command.changes.length) {
        return yield* invariantError(
          command.type,
          "Project-context changes contain duplicate paths.",
        );
      }
      const baselineByPath = new Map(
        run.baselineManifest.map((entry) => [entry.path, entry.rawContent] as const),
      );
      for (const change of command.changes) {
        if (change.beforeRawContent === change.afterRawContent) {
          return yield* invariantError(
            command.type,
            `Project-context change '${change.path}' does not change its raw content.`,
          );
        }
        if (
          (baselineByPath.has(change.path) &&
            baselineByPath.get(change.path) !== change.beforeRawContent) ||
          (!baselineByPath.has(change.path) && change.beforeRawContent !== null)
        ) {
          return yield* invariantError(
            command.type,
            `Project-context change '${change.path}' does not match the immutable baseline.`,
          );
        }
      }
      const appliedEvent = {
        ...(yield* withEventBase({
          aggregateKind: "project-context-run",
          aggregateId: run.id,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "project.context-run-applied",
        payload: {
          projectContextRunId: run.id,
          result: command.result,
          changes: command.changes,
          resultSchemaVersion: command.resultSchemaVersion,
          resultFingerprint: command.resultFingerprint,
          resolvedAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      } satisfies PlannedOrchestrationEvent;
      return appliedEvent;
    }

    case "project.context.run.start":
    case "project.context.run.pending-review":
    case "project.context.run.fail":
    case "project.context.run.interrupt": {
      const run = yield* requireProjectContextRun({
        readModel,
        command,
        projectContextRunId: command.projectContextRunId,
      });
      const eventBase = yield* withEventBase({
        aggregateKind: "project-context-run",
        aggregateId: command.projectContextRunId,
        occurredAt: command.createdAt,
        commandId: command.commandId,
      });
      if (command.type === "project.context.run.start") {
        if (run.status !== "pending" || run.pmStartState !== "ready") {
          return yield* invariantError(
            command.type,
            `Project-context run '${run.id}' cannot start from '${run.status}/${run.pmStartState}'.`,
          );
        }
        return {
          ...eventBase,
          type: "project.context-run-started",
          payload: {
            projectContextRunId: run.id,
            providerThreadId: command.providerThreadId,
            startedAt: command.createdAt,
            updatedAt: command.createdAt,
          },
        };
      }
      if (command.type === "project.context.run.pending-review") {
        if (run.status !== "running") {
          return yield* invariantError(
            command.type,
            `Project-context run '${run.id}' cannot enter pending review from '${run.status}'.`,
          );
        }
        const changePaths = new Set(command.changes.map((change) => change.path));
        if (changePaths.size !== command.changes.length) {
          return yield* invariantError(
            command.type,
            "Project-context changes contain duplicate paths.",
          );
        }
        const baselineByPath = new Map(
          run.baselineManifest.map((entry) => [entry.path, entry.rawContent] as const),
        );
        for (const change of command.changes) {
          if (change.beforeRawContent === change.afterRawContent) {
            return yield* invariantError(
              command.type,
              `Project-context change '${change.path}' does not change its raw content.`,
            );
          }
          if (
            (baselineByPath.has(change.path) &&
              baselineByPath.get(change.path) !== change.beforeRawContent) ||
            (!baselineByPath.has(change.path) && change.beforeRawContent !== null)
          ) {
            return yield* invariantError(
              command.type,
              `Project-context change '${change.path}' does not match the immutable baseline.`,
            );
          }
        }
        if (new Set(command.scopeViolationPaths).size !== command.scopeViolationPaths.length) {
          return yield* invariantError(
            command.type,
            "Project-context scope violations contain duplicate paths.",
          );
        }
        return {
          ...eventBase,
          type: "project.context-run-pending-review",
          payload: {
            projectContextRunId: run.id,
            result: command.result,
            changes: command.changes,
            scopeViolationPaths: command.scopeViolationPaths,
            pendingReviewAt: command.createdAt,
            updatedAt: command.createdAt,
          },
        };
      }
      if (command.type === "project.context.run.fail") {
        if (run.status !== "pending" && run.status !== "running") {
          return yield* invariantError(
            command.type,
            `Project-context run '${run.id}' cannot fail from '${run.status}'.`,
          );
        }
        return {
          ...eventBase,
          type: "project.context-run-failed",
          payload: {
            projectContextRunId: run.id,
            message: command.message,
            failedAt: command.createdAt,
            updatedAt: command.createdAt,
          },
        };
      }
      if (run.status !== "pending" && run.status !== "running") {
        return yield* invariantError(
          command.type,
          `Project-context run '${run.id}' cannot be interrupted from '${run.status}'.`,
        );
      }
      return {
        ...eventBase,
        type: "project.context-run-interrupted",
        payload: {
          projectContextRunId: run.id,
          interruptedAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "project.delete": {
      yield* requireProject({
        readModel,
        command,
        projectId: command.projectId,
      });
      yield* requireNoActiveProjectContextRun({
        readModel,
        command,
        projectId: command.projectId,
        operation: "delete",
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
          ...(command.orchestrationOwnership === undefined
            ? {}
            : { orchestrationOwnership: command.orchestrationOwnership }),
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

    case "helper.run.request": {
      const project = yield* requireProject({
        readModel,
        command,
        projectId: command.projectId,
      });
      if ((readModel.helperRuns ?? []).some((run) => run.id === command.helperRunId)) {
        return yield* invariantError(
          command.type,
          `Helper run '${command.helperRunId}' already exists.`,
        );
      }
      if (command.attachment.kind === "pm") {
        const thread = yield* requirePmThread({
          readModel,
          command,
          threadId: command.attachment.threadId,
        });
        if (thread.projectId !== project.id) {
          return yield* invariantError(
            command.type,
            `PM thread '${thread.id}' belongs to a different project.`,
          );
        }
      } else {
        const task = yield* requireTask({
          readModel,
          command,
          taskId: command.attachment.taskId,
        });
        if (task.projectId !== project.id) {
          return yield* invariantError(
            command.type,
            `Task '${task.id}' belongs to a different project.`,
          );
        }
        if (
          task.archivedAt !== null ||
          task.deletedAt !== null ||
          isTerminalTaskStatus(task.status)
        ) {
          return yield* invariantError(
            command.type,
            `Task '${task.id}' must be active before starting a helper run.`,
          );
        }
      }
      const projectConfig = explicitlySetProjectConfig(project.orchestratorConfig);
      const modelSelection = resolveCapabilityPreset({
        orchestratorDefaults,
        projectConfig,
        tier: command.tier,
      });
      if (modelSelection === null) {
        return yield* invariantError(
          command.type,
          `Project '${project.id}' has no configured '${command.tier}' capability preset.`,
        );
      }
      return {
        ...(yield* withEventBase({
          aggregateKind: "helper-run",
          aggregateId: command.helperRunId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "helper.run-requested",
        payload: {
          helperRunId: command.helperRunId,
          projectId: project.id,
          attachment: command.attachment,
          accessMode: "read-only",
          tier: command.tier,
          providerInstanceId: modelSelection.instanceId,
          model: modelSelection.model,
          modelOptions: modelSelection.options ?? null,
          prompt: command.prompt,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "helper.run.start":
    case "helper.run.complete":
    case "helper.run.fail":
    case "helper.run.interrupt": {
      const helperRun = (readModel.helperRuns ?? []).find((run) => run.id === command.helperRunId);
      if (helperRun === undefined) {
        return yield* invariantError(
          command.type,
          `Helper run '${command.helperRunId}' does not exist.`,
        );
      }
      const eventBase = yield* withEventBase({
        aggregateKind: "helper-run",
        aggregateId: command.helperRunId,
        occurredAt: command.createdAt,
        commandId: command.commandId,
      });
      if (command.type === "helper.run.start") {
        const isInitialStart = helperRun.status === "pending" && command.transportRetry !== true;
        const isTransportRetry =
          helperRun.status === "running" &&
          helperRun.transientRetryCount < 1 &&
          command.transportRetry === true;
        if (!isInitialStart && !isTransportRetry) {
          return yield* invariantError(
            command.type,
            `Helper run '${command.helperRunId}' cannot start from '${helperRun.status}'.`,
          );
        }
        return {
          ...eventBase,
          type: "helper.run-started",
          payload: {
            helperRunId: command.helperRunId,
            providerThreadId: command.providerThreadId,
            ...(command.transportRetry === true ? { transportRetry: true as const } : {}),
            startedAt: command.createdAt,
            updatedAt: command.createdAt,
          },
        };
      }
      if (command.type === "helper.run.complete") {
        if (helperRun.status !== "running") {
          return yield* invariantError(
            command.type,
            `Helper run '${command.helperRunId}' cannot complete from '${helperRun.status}'.`,
          );
        }
        return {
          ...eventBase,
          type: "helper.run-completed",
          payload: {
            helperRunId: command.helperRunId,
            result: command.result,
            completedAt: command.createdAt,
            updatedAt: command.createdAt,
          },
        };
      }
      if (command.type === "helper.run.fail") {
        if (helperRun.status !== "pending" && helperRun.status !== "running") {
          return yield* invariantError(
            command.type,
            `Helper run '${command.helperRunId}' cannot fail from '${helperRun.status}'.`,
          );
        }
        return {
          ...eventBase,
          type: "helper.run-failed",
          payload: {
            helperRunId: command.helperRunId,
            message: command.message,
            failedAt: command.createdAt,
            updatedAt: command.createdAt,
          },
        };
      }
      if (helperRun.status !== "pending" && helperRun.status !== "running") {
        return yield* invariantError(
          command.type,
          `Helper run '${command.helperRunId}' cannot be interrupted from '${helperRun.status}'.`,
        );
      }
      return {
        ...eventBase,
        type: "helper.run-interrupted",
        payload: {
          helperRunId: command.helperRunId,
          interruptedAt: command.createdAt,
          updatedAt: command.createdAt,
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
          branch:
            command.branch ?? buildOrchestratorTaskBranchName(command.taskType, command.title),
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
              branch: child.branch ?? buildOrchestratorTaskBranchName(child.taskType, child.title),
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

    case "task.capability-tiers.set": {
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
          `Task capability tiers can only be updated by human/client/pm-runtime origins; received '${command.origin}'.`,
        );
      }
      return {
        ...(yield* withEventBase({
          aggregateKind: "task",
          aggregateId: command.taskId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "task.capability-tiers-updated",
        payload: {
          taskId: command.taskId,
          roleCapabilityTiers: command.roleCapabilityTiers,
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
      if (
        command.role === "verify" &&
        task.changeReview?.status === "pending" &&
        (task.changeReview.stageRole ?? "work") !== "verify"
      ) {
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

      const capabilityTier = command.capabilityTier ?? task.roleCapabilityTiers?.[command.role];
      const modelSelection =
        capabilityTier === undefined
          ? resolveStageModelSelection({
              orchestratorDefaults,
              project,
              role: command.role,
            })
          : resolveCapabilityPreset({
              orchestratorDefaults,
              projectConfig,
              tier: capabilityTier,
            });
      if (modelSelection === null || modelSelection === undefined) {
        return yield* invariantError(
          command.type,
          capabilityTier === undefined
            ? `Project '${task.projectId}' has no model selection for task stage role '${command.role}'.`
            : `Project '${task.projectId}' has no configured '${capabilityTier}' capability preset.`,
        );
      }

      // A stage start is a new attempt, including retries. Never reuse the
      // prior provider thread: the task projection links ordered attempts via
      // stageThreadIds/stageHistory, while steering targets an existing thread.
      const crypto = yield* Crypto.Crypto;
      const stageThreadId = ThreadId.make(yield* crypto.randomUUIDv4);
      const messageId = MessageId.make(yield* crypto.randomUUIDv4);
      const stageInstructions = prepareStageInstructions({
        instructions: appendCompletedHelperContext({
          instructions: command.instructions,
          taskId: task.id,
          helperRuns: readModel.helperRuns ?? [],
        }),
        role: command.role,
        rolePromptPrefixes: project.rolePromptPrefixes,
      });
      const workerRuntimeMode = resolveWorkerStageRuntimeMode();
      const workerNetworkAccess =
        (orchestratorDefaults.workerNetworkEnabled ?? true) && (command.networkAccess ?? true);

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
          ...(capabilityTier === undefined ? {} : { capabilityTier }),
          stageThreadId,
          awaitedTurnId: null,
          providerInstanceId: modelSelection.instanceId,
          model: modelSelection.model,
          ...(modelSelection.options === undefined ? {} : { modelOptions: modelSelection.options }),
          runtimeMode: workerRuntimeMode,
          networkAccess: workerNetworkAccess,
          ...(command.startHead === undefined ? {} : { startHead: command.startHead }),
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
          orchestrationOwnership: {
            kind: "stage",
            taskId: command.taskId,
          },
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
        (command.role === "work" || command.role === "verify") &&
        task.worktreePath !== null &&
        command.worktreeCompletion === undefined
      ) {
        return yield* invariantError(
          command.type,
          `Task '${command.taskId}' ${command.role} completion must include the inspected worktree HEAD and dirty state.`,
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
          ...(command.ownershipViolationPaths === undefined
            ? {}
            : { ownershipViolationPaths: command.ownershipViolationPaths }),
          ...(command.verificationFinalizationError === undefined
            ? {}
            : { verificationFinalizationError: command.verificationFinalizationError }),
          updatedAt: command.createdAt,
        },
      };
      if (
        command.role === "verify" &&
        command.worktreeCompletion?.dirty === false &&
        (command.ownershipViolationPaths?.length ?? 0) === 0 &&
        command.verificationFinalizationError === undefined
      ) {
        const verificationRecordedEvent: PlannedOrchestrationEvent = {
          ...(yield* withEventBase({
            aggregateKind: "task",
            aggregateId: command.taskId,
            occurredAt: command.createdAt,
            commandId: command.commandId,
          })),
          causationEventId: stageCompletedEvent.eventId,
          type: "task.verification-recorded",
          payload: {
            taskId: command.taskId,
            stageThreadId: command.stageThreadId,
            head: command.worktreeCompletion.head,
            verifiedAt: command.createdAt,
            updatedAt: command.createdAt,
          },
        };
        return [stageCompletedEvent, verificationRecordedEvent];
      }
      if (
        (command.role !== "work" && command.role !== "verify") ||
        command.worktreeCompletion?.dirty !== true ||
        (command.ownershipViolationPaths?.length ?? 0) > 0
      ) {
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
          stageRole: command.role,
          ...(command.verificationFinalizationError === undefined
            ? {}
            : { finalizationError: command.verificationFinalizationError }),
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
      const stageRole = command.stageRole ?? "work";
      const workStage = readModel.stageHistory[command.workStageThreadId];
      if (
        !task.stageThreadIds.includes(command.workStageThreadId) ||
        workStage?.taskId !== task.id ||
        workStage.role !== stageRole ||
        workStage.status !== "completed"
      ) {
        return yield* invariantError(
          command.type,
          `Stage thread '${command.workStageThreadId}' is not completed ${stageRole} for task '${command.taskId}'.`,
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
          stageRole,
          ...(command.finalizationError === undefined
            ? {}
            : { finalizationError: command.finalizationError }),
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
      const activeStage =
        task.currentStageThreadId === null
          ? undefined
          : readModel.stageHistory[task.currentStageThreadId];
      const returningToActiveStage =
        command.resolution === "returned" &&
        (task.status === "working" || task.status === "verifying") &&
        activeStage?.taskId === task.id &&
        activeStage.role === (task.changeReview?.stageRole ?? "work") &&
        activeStage.status === "running";
      if (
        task.changeReview?.status !== "pending" ||
        (task.status !== "change-review" && !returningToActiveStage)
      ) {
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
      if (
        command.worktreeCompletion === undefined ||
        command.worktreeCompletion.dirty ||
        command.worktreeCompletion.head !== command.head
      ) {
        return yield* invariantError(
          command.type,
          `Task '${command.taskId}' verification must record the exact inspected clean worktree HEAD.`,
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
      const reviewCompletion = task.status === "review";
      const inertLandedRepair = task.status === "landed" && task.prUrl === null;
      if ((!reviewCompletion && !inertLandedRepair) || task.currentStageThreadId !== null) {
        return yield* invariantError(
          command.type,
          `Task '${command.taskId}' must have settled work in review or an inert landing without a PR before it can complete without changes.`,
        );
      }
      if (
        command.worktreeCompletion === undefined ||
        command.worktreeCompletion.dirty ||
        command.worktreeCompletion.head !== command.head ||
        command.baseHead !== command.head
      ) {
        return yield* invariantError(
          command.type,
          `Task '${command.taskId}' can complete without changes only when its inspected clean HEAD equals its branch creation baseline.`,
        );
      }
      const noChangesNeededEvent = {
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
      } satisfies PlannedOrchestrationEvent;
      const archivedEvent = {
        ...(yield* withEventBase({
          aggregateKind: "task",
          aggregateId: command.taskId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        causationEventId: noChangesNeededEvent.eventId,
        type: "task.archived",
        payload: {
          taskId: command.taskId,
          archivedAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      } satisfies PlannedOrchestrationEvent;
      return [noChangesNeededEvent, archivedEvent];
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
      if (command.reason === "capability" && command.requestId === undefined) {
        return yield* invariantError(
          command.type,
          "A capability-paused stage must retain the provider approval request id.",
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
          ...(command.requestId === undefined ? {} : { requestId: command.requestId }),
          ...(command.requestKind === undefined ? {} : { requestKind: command.requestKind }),
          ...(command.detail === undefined ? {} : { detail: command.detail }),
          ...(command.expiresAt === undefined ? {} : { expiresAt: command.expiresAt }),
          ...(command.resetAt !== undefined ? { resetAt: command.resetAt } : {}),
          updatedAt: command.createdAt,
        },
      };
    }

    case "task.stage.resume": {
      const task = yield* requireTask({ readModel, command, taskId: command.taskId });
      yield* requireTaskNotCancelling({ command, task });
      if (task.currentStageThreadId !== command.stageThreadId) {
        return yield* invariantError(
          command.type,
          `Task '${command.taskId}' does not retain paused stage thread '${command.stageThreadId}'.`,
        );
      }
      const stage = readModel.stageHistory[command.stageThreadId];
      if (stage?.status !== "paused") {
        return yield* invariantError(
          command.type,
          `Stage thread '${command.stageThreadId}' is not capability-paused.`,
        );
      }
      if (stage.role !== command.role) {
        return yield* invariantError(
          command.type,
          `Paused stage role '${stage.role}' cannot resume as '${command.role}'.`,
        );
      }
      return {
        ...(yield* withEventBase({
          aggregateKind: "task",
          aggregateId: command.taskId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "task.stage-resumed",
        payload: {
          taskId: command.taskId,
          role: command.role,
          stageThreadId: command.stageThreadId,
          requestId: command.requestId,
          decision: command.decision,
          updatedAt: command.createdAt,
        },
      } satisfies PlannedOrchestrationEvent;
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
      if (command.gate === "land") {
        if (command.pullRequest === undefined) {
          return yield* invariantError(
            command.type,
            `Land approval for task '${command.taskId}' requires the exact pull-request title and body.`,
          );
        }
        if (task.status !== "review" || task.currentStageThreadId !== null) {
          return yield* invariantError(
            command.type,
            `Land approval requires task '${command.taskId}' to have settled work in review.`,
          );
        }
        yield* requireFreshVerification({
          command,
          readModel,
          task,
          worktreeCompletion: command.worktreeCompletion,
        });
      } else if (command.pullRequest !== undefined) {
        return yield* invariantError(
          command.type,
          `Pull-request content is valid only for a land approval gate.`,
        );
      }
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
          pullRequest: command.pullRequest ?? null,
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

    case "task.land.approve": {
      const task = yield* requireTask({ readModel, command, taskId: command.taskId });
      yield* requireTaskNotCancelling({ command, task });
      const project = yield* requireProject({
        readModel,
        command,
        projectId: task.projectId,
      });
      yield* requireOrchestratorConfig({ command, project });
      if (task.status !== "review" || task.currentStageThreadId !== null) {
        return yield* invariantError(
          command.type,
          `Task '${command.taskId}' must be idle and in review before its approved landing can start.`,
        );
      }
      const pendingGate = (readModel.pendingGates ?? []).find(
        (gate) => gate.gateId === command.gateId,
      );
      if (
        pendingGate === undefined ||
        pendingGate.taskId !== command.taskId ||
        pendingGate.gate !== "land" ||
        pendingGate.status !== "pending" ||
        pendingGate.contentHash !== command.approvedHash
      ) {
        return yield* invariantError(
          command.type,
          `Land gate '${command.gateId}' is not a current, content-matched pending gate for task '${command.taskId}'.`,
        );
      }
      yield* requireFreshVerification({
        command,
        readModel,
        task,
        worktreeCompletion: command.worktreeCompletion,
      });

      const resolvedBase = yield* withEventBase({
        aggregateKind: "task",
        aggregateId: command.taskId,
        occurredAt: command.createdAt,
        commandId: command.commandId,
      });
      return [
        {
          ...resolvedBase,
          type: "task.gate-resolved" as const,
          payload: {
            taskId: command.taskId,
            gateId: command.gateId,
            gate: "land" as const,
            approvedHash: command.approvedHash,
            decision: "approved" as const,
            origin: "human" as const,
            updatedAt: command.createdAt,
          },
        },
        {
          ...(yield* withEventBase({
            aggregateKind: "task",
            aggregateId: command.taskId,
            occurredAt: command.createdAt,
            commandId: command.commandId,
          })),
          type: "task.landed" as const,
          payload: { taskId: command.taskId, updatedAt: command.createdAt },
        },
      ] satisfies ReadonlyArray<PlannedOrchestrationEvent>;
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
      if (command.gate === "land" && command.decision === "approved") {
        yield* requireFreshVerification({
          command,
          readModel,
          task,
          worktreeCompletion: command.worktreeCompletion,
        });
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
      yield* requireFreshVerification({
        command,
        readModel,
        task,
        worktreeCompletion: command.worktreeCompletion,
      });
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
        (task.status !== "review" && task.status !== "landed") ||
        task.prUrl !== null ||
        task.worktreePath === null ||
        task.landing?.status !== "failed"
      ) {
        return yield* invariantError(
          command.type,
          `Task '${command.taskId}' must have an exhausted landing failure and a retained worktree before landing can be retried.`,
        );
      }
      yield* requireFreshVerification({
        command,
        readModel,
        task,
        worktreeCompletion: command.worktreeCompletion,
      });
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
      if (
        (task.status !== "review" && task.status !== "landed") ||
        task.prUrl !== null ||
        task.landing?.status !== "opening-pr"
      ) {
        return yield* invariantError(
          command.type,
          `Task '${command.taskId}' must be opening an approved landing without an existing PR before PR success can be recorded.`,
        );
      }
      const project = yield* requireProject({
        readModel,
        command,
        projectId: task.projectId,
      });
      yield* requireOrchestratorConfig({ command, project });

      const prOpenedEvent = {
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
      } satisfies PlannedOrchestrationEvent;
      return prOpenedEvent;
    }

    case "task.pr.merged": {
      const task = yield* requireTask({
        readModel,
        command,
        taskId: command.taskId,
      });
      yield* requireTaskNotCancelling({ command, task });
      if (task.status !== "pr-open" || task.prUrl !== command.prUrl) {
        return yield* invariantError(
          command.type,
          `Task '${command.taskId}' must have the matching open pull request before its merge can be recorded.`,
        );
      }
      const prMergedEvent = {
        ...(yield* withEventBase({
          aggregateKind: "task",
          aggregateId: command.taskId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "task.pr-merged",
        payload: {
          taskId: command.taskId,
          prUrl: command.prUrl,
          updatedAt: command.createdAt,
        },
      } satisfies PlannedOrchestrationEvent;
      const archivedEvent = {
        ...(yield* withEventBase({
          aggregateKind: "task",
          aggregateId: command.taskId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        causationEventId: prMergedEvent.eventId,
        type: "task.archived",
        payload: {
          taskId: command.taskId,
          archivedAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      } satisfies PlannedOrchestrationEvent;
      return [prMergedEvent, archivedEvent];
    }

    case "task.pr.closed": {
      const task = yield* requireTask({
        readModel,
        command,
        taskId: command.taskId,
      });
      yield* requireTaskNotCancelling({ command, task });
      if (task.status !== "pr-open" || task.prUrl !== command.prUrl) {
        return yield* invariantError(
          command.type,
          `Task '${command.taskId}' must have the matching open pull request before its closure can be recorded.`,
        );
      }
      return {
        ...(yield* withEventBase({
          aggregateKind: "task",
          aggregateId: command.taskId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "task.pr-closed",
        payload: {
          taskId: command.taskId,
          prUrl: command.prUrl,
          updatedAt: command.createdAt,
        },
      } satisfies PlannedOrchestrationEvent;
    }

    case "task.pr.open.failed": {
      const task = yield* requireTask({
        readModel,
        command,
        taskId: command.taskId,
      });
      yield* requireTaskNotCancelling({ command, task });
      if (
        (task.status !== "review" && task.status !== "landed") ||
        task.prUrl !== null ||
        task.landing?.status !== "opening-pr"
      ) {
        return yield* invariantError(
          command.type,
          `Task '${command.taskId}' must be opening an approved landing without an opened PR before PR failure can be recorded.`,
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
