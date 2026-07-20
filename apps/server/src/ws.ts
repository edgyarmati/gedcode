import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import {
  DEFAULT_AUTOMATIC_GIT_FETCH_INTERVAL,
  type AuthAccessStreamEvent,
  AuthSessionId,
  CommandId,
  EventId,
  MessageId,
  type OrchestrationCommand,
  type GitActionProgressEvent,
  type GitManagerServiceError,
  type PmHandoffMode,
  type OrchestrationThread,
  ORCHESTRATOR_WS_METHODS,
  OrchestrationCancelTaskError,
  OrchestrationInterruptStageError,
  OrchestrationLandTaskError,
  OrchestrationDispatchCommandError,
  OrchestrationForkThreadError,
  type OrchestrationEvent,
  OrchestrationGetFullThreadDiffError,
  OrchestrationGetSnapshotError,
  OrchestrationGetTurnDiffError,
  OrchestratorProjectConfig,
  ORCHESTRATION_WS_METHODS,
  ProjectSearchEntriesError,
  ProjectWriteFileError,
  ServerSettingsError,
  OrchestrationReplayEventsError,
  FilesystemBrowseError,
  ProjectId,
  TaskId,
  ThreadId,
  type TerminalEvent,
  WS_METHODS,
  WsRpcGroup,
} from "@t3tools/contracts";
import { clamp } from "effect/Number";
import { HttpRouter, HttpServerRequest } from "effect/unstable/http";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";

import { CheckpointDiffQuery } from "./checkpointing/Services/CheckpointDiffQuery.ts";
import { ServerConfig } from "./config.ts";
import { Keybindings } from "./keybindings.ts";
import * as ExternalLauncher from "./process/externalLauncher.ts";
import { normalizeDispatchCommand } from "./orchestration/Normalizer.ts";
import { OrchestrationEngineService } from "./orchestration/Services/OrchestrationEngine.ts";
import { ProjectContextRunCoordinator } from "./orchestration/Services/ProjectContextRunCoordinator.ts";
import { ProjectContextOnboardingCoordinator } from "./orchestration/Services/ProjectContextOnboardingCoordinator.ts";
import { PmProjectRuntimeFactory } from "./orchestration/Services/PmRuntime.ts";
import { ProjectionSnapshotQuery } from "./orchestration/Services/ProjectionSnapshotQuery.ts";
import { isPmThreadId, pmThreadIdForProject } from "./orchestration/pm/PmEventProjection.ts";
import { cancelOrchestrationTaskWithServices } from "./orchestration/taskCancellation.ts";
import { interruptOrchestrationStageWithServices } from "./orchestration/stageInterrupt.ts";
import { forkOrchestrationThreadWithServices } from "./orchestration/threadFork.ts";
import {
  landOrchestrationTaskWithServices,
  OrchestrationLandTaskError as TaskLandingError,
} from "./orchestration/taskLanding.ts";
import { inspectTaskWorktreeCompletion } from "./orchestration/worktreeCompletion.ts";
import {
  commitOrchestratorTaskChanges,
  completeOrchestratorTaskWithoutChanges,
  discardOrchestratorTaskChanges,
  inspectOrchestratorTaskChanges,
  returnOrchestratorTaskChanges,
} from "./orchestration/taskChangeReviewActions.ts";
import {
  observeRpcEffect as observeRpcEffectBase,
  observeRpcStream,
  observeRpcStreamEffect as observeRpcStreamEffectBase,
} from "./observability/RpcInstrumentation.ts";
import {
  buildOrchestratorPresetMigrationState,
  configuredOrchestratorDefaults,
  validateOrchestratorPresetMigrationCompletion,
} from "./orchestration/orchestratorPresetMigration.ts";
import { ProviderRegistry } from "./provider/Services/ProviderRegistry.ts";
import { ProviderService } from "./provider/Services/ProviderService.ts";
import { ProviderQuotaStatusRepository } from "./persistence/Services/ProviderQuotaStatus.ts";
import * as ProviderMaintenanceRunner from "./provider/providerMaintenanceRunner.ts";
import { ServerLifecycleEvents } from "./serverLifecycleEvents.ts";
import { ServerRuntimeStartup } from "./serverRuntimeStartup.ts";
import { redactServerSettingsForClient, ServerSettingsService } from "./serverSettings.ts";
import { TerminalManager } from "./terminal/Services/Manager.ts";
import { WorkspaceEntries } from "./workspace/Services/WorkspaceEntries.ts";
import { WorkspaceFileSystem } from "./workspace/Services/WorkspaceFileSystem.ts";
import { WorkspacePathOutsideRootError } from "./workspace/Services/WorkspacePaths.ts";
import { VcsStatusBroadcaster } from "./vcs/VcsStatusBroadcaster.ts";
import { VcsProvisioningService } from "./vcs/VcsProvisioningService.ts";
import { GitWorkflowService } from "./git/GitWorkflowService.ts";
import { ProjectSetupScriptRunner } from "./project/Services/ProjectSetupScriptRunner.ts";
import { RepositoryIdentityResolver } from "./project/Services/RepositoryIdentityResolver.ts";
import { ServerEnvironment } from "./environment/Services/ServerEnvironment.ts";
import { ServerAuth } from "./auth/Services/ServerAuth.ts";
import * as ProcessDiagnostics from "./diagnostics/ProcessDiagnostics.ts";
import * as ProcessResourceMonitor from "./diagnostics/ProcessResourceMonitor.ts";
import * as TraceDiagnostics from "./diagnostics/TraceDiagnostics.ts";
import * as SourceControlDiscoveryLayer from "./sourceControl/SourceControlDiscovery.ts";
import { SourceControlRepositoryService } from "./sourceControl/SourceControlRepositoryService.ts";
import * as GitHubCli from "./sourceControl/GitHubCli.ts";
import * as GitLabCli from "./sourceControl/GitLabCli.ts";
import * as SourceControlProviderRegistry from "./sourceControl/SourceControlProviderRegistry.ts";
import * as GitVcsDriver from "./vcs/GitVcsDriver.ts";
import * as VcsDriverRegistry from "./vcs/VcsDriverRegistry.ts";
import * as VcsProjectConfig from "./vcs/VcsProjectConfig.ts";
import * as VcsProcess from "./vcs/VcsProcess.ts";
import {
  BootstrapCredentialService,
  type BootstrapCredentialChange,
} from "./auth/Services/BootstrapCredentialService.ts";
import {
  SessionCredentialService,
  type SessionCredentialChange,
} from "./auth/Services/SessionCredentialService.ts";
import { respondToAuthError } from "./auth/http.ts";
const isOrchestrationDispatchCommandError = Schema.is(OrchestrationDispatchCommandError);
const isOrchestrationCancelTaskError = Schema.is(OrchestrationCancelTaskError);
const isOrchestrationInterruptStageError = Schema.is(OrchestrationInterruptStageError);
const isTaskLandingError = (cause: unknown): cause is TaskLandingError =>
  cause instanceof TaskLandingError;
const isOrchestrationGetSnapshotError = Schema.is(OrchestrationGetSnapshotError);
const isWorkspacePathOutsideRootError = Schema.is(WorkspacePathOutsideRootError);

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
const decodeOrchestratorConfig = Schema.decodeUnknownOption(OrchestratorProjectConfig);

function isThreadDetailEvent(event: OrchestrationEvent): event is Extract<
  OrchestrationEvent,
  {
    type:
      | "thread.message-sent"
      | "thread.created"
      | "thread.cleared"
      | "thread.pm-handoff-requested"
      | "thread.pm-handoff-completed"
      | "thread.proposed-plan-upserted"
      | "thread.activity-appended"
      | "thread.turn-diff-completed"
      | "thread.reverted"
      | "thread.session-set";
  }
> {
  return (
    event.type === "thread.message-sent" ||
    event.type === "thread.created" ||
    event.type === "thread.cleared" ||
    event.type === "thread.pm-handoff-requested" ||
    event.type === "thread.pm-handoff-completed" ||
    event.type === "thread.proposed-plan-upserted" ||
    event.type === "thread.activity-appended" ||
    event.type === "thread.turn-diff-completed" ||
    event.type === "thread.reverted" ||
    event.type === "thread.session-set"
  );
}

function isAfterLastThreadClear(
  event: OrchestrationEvent,
  lastClearedSequence: number | undefined,
) {
  return lastClearedSequence === undefined || event.sequence > lastClearedSequence;
}

function projectIdFromPmThreadId(threadId: ThreadId): ProjectId | null {
  const rawThreadId = String(threadId);
  if (!isPmThreadId(threadId)) {
    return null;
  }
  return ProjectId.make(rawThreadId.slice("pm:".length));
}

function isTaskEvent(event: OrchestrationEvent): event is Extract<
  OrchestrationEvent,
  {
    type:
      | "task.created"
      | "task.classified"
      | "task.capability-tiers-updated"
      | "task.archived"
      | "task.restored"
      | "task.deleted"
      | "task.stage-started"
      | "task.stage-completed"
      | "task.stage-blocked"
      | "task.stage-interrupted"
      | "task.gate-requested"
      | "task.gate-resolved"
      | "task.cancellation-requested"
      | "task.cancellation-failed"
      | "task.cancellation-phase-completed"
      | "task.landed"
      | "task.landing-retry-requested"
      | "task.pr-opened"
      | "task.pr-open-failed"
      | "task.abandoned";
  }
> {
  return (
    event.type === "task.created" ||
    event.type === "task.classified" ||
    event.type === "task.capability-tiers-updated" ||
    event.type === "task.archived" ||
    event.type === "task.restored" ||
    event.type === "task.deleted" ||
    event.type === "task.stage-started" ||
    event.type === "task.stage-completed" ||
    event.type === "task.stage-blocked" ||
    event.type === "task.stage-interrupted" ||
    event.type === "task.gate-requested" ||
    event.type === "task.gate-resolved" ||
    event.type === "task.cancellation-requested" ||
    event.type === "task.cancellation-failed" ||
    event.type === "task.cancellation-phase-completed" ||
    event.type === "task.landed" ||
    event.type === "task.landing-retry-requested" ||
    event.type === "task.pr-opened" ||
    event.type === "task.pr-open-failed" ||
    event.type === "task.abandoned"
  );
}

function isHelperRunEvent(event: OrchestrationEvent): event is Extract<
  OrchestrationEvent,
  {
    type:
      | "helper.run-requested"
      | "helper.run-started"
      | "helper.run-completed"
      | "helper.run-failed"
      | "helper.run-interrupted";
  }
> {
  return (
    event.type === "helper.run-requested" ||
    event.type === "helper.run-started" ||
    event.type === "helper.run-completed" ||
    event.type === "helper.run-failed" ||
    event.type === "helper.run-interrupted"
  );
}

function isProjectContextRunEvent(event: OrchestrationEvent): event is Extract<
  OrchestrationEvent,
  {
    type:
      | "project.context-run-requested"
      | "project.context-run-started"
      | "project.context-run-pending-review"
      | "project.context-run-failed"
      | "project.context-run-interrupted";
  }
> {
  return (
    event.type === "project.context-run-requested" ||
    event.type === "project.context-run-started" ||
    event.type === "project.context-run-pending-review" ||
    event.type === "project.context-run-failed" ||
    event.type === "project.context-run-interrupted"
  );
}

const PROVIDER_STATUS_DEBOUNCE_MS = 200;

function pmHandoffFallbackReason(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const detail = "detail" in error ? error.detail : undefined;
    if (typeof detail === "string" && detail.length > 0) {
      return detail;
    }
    const message = "message" in error ? error.message : undefined;
    if (typeof message === "string" && message.length > 0) {
      return message;
    }
  }
  return String(error);
}

function toAuthAccessStreamEvent(
  change: BootstrapCredentialChange | SessionCredentialChange,
  revision: number,
  currentSessionId: AuthSessionId,
): AuthAccessStreamEvent {
  switch (change.type) {
    case "pairingLinkUpserted":
      return {
        version: 1,
        revision,
        type: "pairingLinkUpserted",
        payload: change.pairingLink,
      };
    case "pairingLinkRemoved":
      return {
        version: 1,
        revision,
        type: "pairingLinkRemoved",
        payload: { id: change.id },
      };
    case "clientUpserted":
      return {
        version: 1,
        revision,
        type: "clientUpserted",
        payload: {
          ...change.clientSession,
          current: change.clientSession.sessionId === currentSessionId,
        },
      };
    case "clientRemoved":
      return {
        version: 1,
        revision,
        type: "clientRemoved",
        payload: { sessionId: change.sessionId },
      };
  }
}

const shouldGuardOrchestratorMethod = (method: string) =>
  method.startsWith("orchestrator.") &&
  method !== ORCHESTRATOR_WS_METHODS.getPresetMigration &&
  method !== ORCHESTRATOR_WS_METHODS.completePresetMigration &&
  // Read-only context inspection may safely discover current state before the
  // required preset migration. Dismissal remains a guarded mutation.
  method !== ORCHESTRATOR_WS_METHODS.getProjectContextOnboarding;

const makeWsRpcLayer = (currentSessionId: AuthSessionId) =>
  WsRpcGroup.toLayer(
    Effect.gen(function* () {
      const crypto = yield* Crypto.Crypto;
      const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
      const orchestrationEngine = yield* OrchestrationEngineService;
      const projectContextRunCoordinator = yield* ProjectContextRunCoordinator;
      const projectContextOnboardingCoordinator = yield* ProjectContextOnboardingCoordinator;
      const pmProjectRuntimeFactory = yield* PmProjectRuntimeFactory;
      const checkpointDiffQuery = yield* CheckpointDiffQuery;
      const keybindings = yield* Keybindings;
      const externalLauncher = yield* ExternalLauncher.ExternalLauncher;
      const gitWorkflow = yield* GitWorkflowService;
      const vcsProvisioning = yield* VcsProvisioningService;
      const vcsProcess = yield* VcsProcess.VcsProcess;
      const vcsStatusBroadcaster = yield* VcsStatusBroadcaster;
      const terminalManager = yield* TerminalManager;
      const providerService = yield* ProviderService;
      const providerRegistry = yield* ProviderRegistry;
      const providerQuotaStatusRepository = yield* ProviderQuotaStatusRepository;
      const providerMaintenanceRunner = yield* ProviderMaintenanceRunner.ProviderMaintenanceRunner;
      const config = yield* ServerConfig;
      const lifecycleEvents = yield* ServerLifecycleEvents;
      const serverSettings = yield* ServerSettingsService;
      const requireCompletedPresetMigration = serverSettings.getSettings.pipe(
        Effect.flatMap((settings) =>
          settings.orchestratorDefaults.capabilityPresets === null
            ? Effect.fail(
                new OrchestrationDispatchCommandError({
                  message:
                    "Orchestrator capability preset migration is required before this operation.",
                }),
              )
            : Effect.void,
        ),
        // The migration gate spans RPCs with different declared error schemas.
        // Treat bypass attempts as protocol defects so the guard cannot widen
        // each method's public error channel while still closing the request.
        Effect.orDie,
      );
      const observeRpcEffect = <A, E, R>(
        method: string,
        effect: Effect.Effect<A, E, R>,
        traceAttributes?: Readonly<Record<string, unknown>>,
      ) =>
        observeRpcEffectBase(
          method,
          shouldGuardOrchestratorMethod(method)
            ? requireCompletedPresetMigration.pipe(Effect.andThen(effect))
            : effect,
          traceAttributes,
        );
      const observeRpcStreamEffect = <A, StreamError, StreamContext, EffectError, EffectContext>(
        method: string,
        effect: Effect.Effect<
          Stream.Stream<A, StreamError, StreamContext>,
          EffectError,
          EffectContext
        >,
        traceAttributes?: Readonly<Record<string, unknown>>,
      ) =>
        observeRpcStreamEffectBase(
          method,
          shouldGuardOrchestratorMethod(method)
            ? requireCompletedPresetMigration.pipe(Effect.andThen(effect))
            : effect,
          traceAttributes,
        );
      const startup = yield* ServerRuntimeStartup;
      const workspaceEntries = yield* WorkspaceEntries;
      const workspaceFileSystem = yield* WorkspaceFileSystem;
      const projectSetupScriptRunner = yield* ProjectSetupScriptRunner;
      const repositoryIdentityResolver = yield* RepositoryIdentityResolver;
      const serverEnvironment = yield* ServerEnvironment;
      const serverAuth = yield* ServerAuth;
      const sourceControlDiscovery = yield* SourceControlDiscoveryLayer.SourceControlDiscovery;
      const automaticGitFetchInterval = serverSettings.getSettings.pipe(
        Effect.map((settings) => settings.automaticGitFetchInterval),
        Effect.catch((cause) =>
          Effect.logWarning("Failed to read automatic Git fetch interval setting", {
            detail: cause.message,
          }).pipe(Effect.as(DEFAULT_AUTOMATIC_GIT_FETCH_INTERVAL)),
        ),
      );
      const sourceControlRepositories = yield* SourceControlRepositoryService;
      const bootstrapCredentials = yield* BootstrapCredentialService;
      const sessions = yield* SessionCredentialService;
      const processDiagnostics = yield* ProcessDiagnostics.ProcessDiagnostics;
      const processResourceMonitor = yield* ProcessResourceMonitor.ProcessResourceMonitor;
      const toDispatchCommandError = (cause: unknown, fallbackMessage: string) =>
        isOrchestrationDispatchCommandError(cause)
          ? cause
          : new OrchestrationDispatchCommandError({
              message: cause instanceof Error ? cause.message : fallbackMessage,
              cause,
            });
      const randomUUID = crypto.randomUUIDv4.pipe(
        Effect.mapError((cause) =>
          toDispatchCommandError(cause, "Failed to generate orchestration command identifier."),
        ),
      );
      const serverEventId = randomUUID.pipe(Effect.map(EventId.make));
      const serverCommandId = (tag: string) =>
        randomUUID.pipe(Effect.map((uuid) => CommandId.make(`server:${tag}:${uuid}`)));

      const loadAuthAccessSnapshot = () =>
        Effect.all({
          pairingLinks: serverAuth.listPairingLinks().pipe(Effect.orDie),
          clientSessions: serverAuth.listClientSessions(currentSessionId).pipe(Effect.orDie),
        });

      const appendSetupScriptActivity = (input: {
        readonly threadId: ThreadId;
        readonly kind: "setup-script.requested" | "setup-script.started" | "setup-script.failed";
        readonly summary: string;
        readonly createdAt: string;
        readonly payload: Record<string, unknown>;
        readonly tone: "info" | "error";
      }) =>
        Effect.all({
          commandId: serverCommandId("setup-script-activity"),
          activityId: serverEventId,
        }).pipe(
          Effect.flatMap(({ commandId, activityId }) =>
            orchestrationEngine.dispatch({
              type: "thread.activity.append",
              commandId,
              threadId: input.threadId,
              activity: {
                id: activityId,
                tone: input.tone,
                kind: input.kind,
                summary: input.summary,
                payload: input.payload,
                turnId: null,
                createdAt: input.createdAt,
              },
              createdAt: input.createdAt,
            }),
          ),
        );

      const toBootstrapDispatchCommandCauseError = (cause: Cause.Cause<unknown>) => {
        const error = Cause.squash(cause);
        return isOrchestrationDispatchCommandError(error)
          ? error
          : new OrchestrationDispatchCommandError({
              message:
                error instanceof Error ? error.message : "Failed to bootstrap thread turn start.",
              cause,
            });
      };

      const enrichProjectEvent = (
        event: OrchestrationEvent,
      ): Effect.Effect<OrchestrationEvent, never, never> => {
        switch (event.type) {
          case "project.created":
            return repositoryIdentityResolver.resolve(event.payload.workspaceRoot).pipe(
              Effect.map((repositoryIdentity) => ({
                ...event,
                payload: {
                  ...event.payload,
                  repositoryIdentity,
                },
              })),
            );
          case "project.meta-updated":
            return Effect.gen(function* () {
              const workspaceRoot =
                event.payload.workspaceRoot ??
                Option.match(
                  yield* projectionSnapshotQuery.getProjectShellById(event.payload.projectId),
                  {
                    onNone: () => null,
                    onSome: (project) => project.workspaceRoot,
                  },
                ) ??
                null;
              if (workspaceRoot === null) {
                return event;
              }

              const repositoryIdentity = yield* repositoryIdentityResolver.resolve(workspaceRoot);
              return {
                ...event,
                payload: {
                  ...event.payload,
                  repositoryIdentity,
                },
              } satisfies OrchestrationEvent;
            }).pipe(Effect.catch(() => Effect.succeed(event)));
          default:
            return Effect.succeed(event);
        }
      };

      const enrichOrchestrationEvents = (events: ReadonlyArray<OrchestrationEvent>) =>
        Effect.forEach(events, enrichProjectEvent, { concurrency: 4 });

      const dispatchBootstrapTurnStart = (
        command: Extract<OrchestrationCommand, { type: "thread.turn.start" }>,
      ): Effect.Effect<{ readonly sequence: number }, OrchestrationDispatchCommandError> =>
        Effect.gen(function* () {
          const bootstrap = command.bootstrap;
          const { bootstrap: _bootstrap, ...finalTurnStartCommand } = command;
          let createdThread = false;
          let targetProjectId = bootstrap?.createThread?.projectId;
          let targetProjectCwd = bootstrap?.prepareWorktree?.projectCwd;
          let targetWorktreePath = bootstrap?.createThread?.worktreePath ?? null;

          const cleanupCreatedThread = () =>
            createdThread
              ? serverCommandId("bootstrap-thread-delete").pipe(
                  Effect.flatMap((commandId) =>
                    orchestrationEngine.dispatch({
                      type: "thread.delete",
                      commandId,
                      threadId: command.threadId,
                    }),
                  ),
                  Effect.ignoreCause({ log: true }),
                )
              : Effect.void;

          const recordSetupScriptLaunchFailure = (input: {
            readonly error: unknown;
            readonly requestedAt: string;
            readonly worktreePath: string;
          }) => {
            const detail =
              input.error instanceof Error ? input.error.message : "Unknown setup failure.";
            return appendSetupScriptActivity({
              threadId: command.threadId,
              kind: "setup-script.failed",
              summary: "Setup script failed to start",
              createdAt: input.requestedAt,
              payload: {
                detail,
                worktreePath: input.worktreePath,
              },
              tone: "error",
            }).pipe(
              Effect.ignoreCause({ log: false }),
              Effect.flatMap(() =>
                Effect.logWarning("bootstrap turn start failed to launch setup script", {
                  threadId: command.threadId,
                  worktreePath: input.worktreePath,
                  detail,
                }),
              ),
            );
          };

          const recordSetupScriptStarted = (input: {
            readonly requestedAt: string;
            readonly worktreePath: string;
            readonly scriptId: string;
            readonly scriptName: string;
            readonly terminalId: string;
          }) =>
            Effect.gen(function* () {
              const startedAt = yield* nowIso;
              const payload = {
                scriptId: input.scriptId,
                scriptName: input.scriptName,
                terminalId: input.terminalId,
                worktreePath: input.worktreePath,
              };
              yield* Effect.all([
                appendSetupScriptActivity({
                  threadId: command.threadId,
                  kind: "setup-script.requested",
                  summary: "Starting setup script",
                  createdAt: input.requestedAt,
                  payload,
                  tone: "info",
                }),
                appendSetupScriptActivity({
                  threadId: command.threadId,
                  kind: "setup-script.started",
                  summary: "Setup script started",
                  createdAt: startedAt,
                  payload,
                  tone: "info",
                }),
              ]).pipe(
                Effect.asVoid,
                Effect.catch((error) =>
                  Effect.logWarning(
                    "bootstrap turn start launched setup script but failed to record setup activity",
                    {
                      threadId: command.threadId,
                      worktreePath: input.worktreePath,
                      scriptId: input.scriptId,
                      terminalId: input.terminalId,
                      detail: error.message,
                    },
                  ),
                ),
              );
            });

          const runSetupProgram = () =>
            Effect.gen(function* () {
              if (!bootstrap?.runSetupScript || !targetWorktreePath) {
                return;
              }
              const worktreePath = targetWorktreePath;
              const requestedAt = yield* nowIso;
              yield* projectSetupScriptRunner
                .runForThread({
                  threadId: command.threadId,
                  ...(targetProjectId ? { projectId: targetProjectId } : {}),
                  ...(targetProjectCwd ? { projectCwd: targetProjectCwd } : {}),
                  worktreePath,
                })
                .pipe(
                  Effect.matchEffect({
                    onFailure: (error) =>
                      recordSetupScriptLaunchFailure({
                        error,
                        requestedAt,
                        worktreePath,
                      }),
                    onSuccess: (setupResult) => {
                      if (setupResult.status !== "started") {
                        return Effect.void;
                      }
                      return recordSetupScriptStarted({
                        requestedAt,
                        worktreePath,
                        scriptId: setupResult.scriptId,
                        scriptName: setupResult.scriptName,
                        terminalId: setupResult.terminalId,
                      });
                    },
                  }),
                );
            });

          const bootstrapProgram = Effect.gen(function* () {
            if (bootstrap?.createThread) {
              yield* orchestrationEngine.dispatch({
                type: "thread.create",
                commandId: yield* serverCommandId("bootstrap-thread-create"),
                threadId: command.threadId,
                projectId: bootstrap.createThread.projectId,
                title: bootstrap.createThread.title,
                modelSelection: bootstrap.createThread.modelSelection,
                ...(bootstrap.createThread.gedWorkflowEnabled !== undefined
                  ? {
                      gedWorkflowEnabled: bootstrap.createThread.gedWorkflowEnabled,
                    }
                  : {}),
                runtimeMode: bootstrap.createThread.runtimeMode,
                interactionMode: bootstrap.createThread.interactionMode,
                branch: bootstrap.createThread.branch,
                worktreePath: bootstrap.createThread.worktreePath,
                createdAt: bootstrap.createThread.createdAt,
              });
              createdThread = true;
            }

            if (bootstrap?.prepareWorktree) {
              const worktree = yield* gitWorkflow.createWorktree({
                cwd: bootstrap.prepareWorktree.projectCwd,
                refName: bootstrap.prepareWorktree.baseBranch,
                newRefName: bootstrap.prepareWorktree.branch,
                path: null,
              });
              targetWorktreePath = worktree.worktree.path;
              yield* orchestrationEngine.dispatch({
                type: "thread.meta.update",
                commandId: yield* serverCommandId("bootstrap-thread-meta-update"),
                threadId: command.threadId,
                branch: worktree.worktree.refName,
                worktreePath: targetWorktreePath,
              });
              yield* refreshGitStatus(targetWorktreePath);
            }

            yield* runSetupProgram();

            return yield* orchestrationEngine.dispatch(finalTurnStartCommand);
          });

          return yield* bootstrapProgram.pipe(
            Effect.catchCause((cause) => {
              const dispatchError = toBootstrapDispatchCommandCauseError(cause);
              if (Cause.hasInterruptsOnly(cause)) {
                return Effect.fail(dispatchError);
              }
              return cleanupCreatedThread().pipe(Effect.flatMap(() => Effect.fail(dispatchError)));
            }),
          );
        });

      const dispatchNormalizedCommand = (
        normalizedCommand: OrchestrationCommand,
      ): Effect.Effect<{ readonly sequence: number }, OrchestrationDispatchCommandError> => {
        const dispatchEffect =
          normalizedCommand.type === "thread.turn.start" && normalizedCommand.bootstrap
            ? dispatchBootstrapTurnStart(normalizedCommand)
            : orchestrationEngine
                .dispatch(normalizedCommand)
                .pipe(
                  Effect.mapError((cause) =>
                    toDispatchCommandError(cause, "Failed to dispatch orchestration command"),
                  ),
                );

        return startup
          .enqueueCommand(dispatchEffect)
          .pipe(
            Effect.mapError((cause) =>
              toDispatchCommandError(cause, "Failed to dispatch orchestration command"),
            ),
          );
      };

      const loadProjectForPmRuntime = (projectId: ProjectId) =>
        projectionSnapshotQuery.getCommandReadModel().pipe(
          Effect.map((readModel) => readModel.projects.find((project) => project.id === projectId)),
          Effect.flatMap((project) =>
            project === undefined
              ? Effect.fail(
                  new OrchestrationDispatchCommandError({
                    message: `Project ${projectId} was not found`,
                    cause: projectId,
                  }),
                )
              : Effect.succeed(project),
          ),
          Effect.mapError((cause) =>
            isOrchestrationDispatchCommandError(cause)
              ? cause
              : new OrchestrationDispatchCommandError({
                  message: `Failed to load project ${projectId}`,
                  cause,
                }),
          ),
        );

      const loadOrchestratorProjectSnapshot = (projectId: ProjectId) =>
        projectionSnapshotQuery.getSnapshot().pipe(
          Effect.flatMap((snapshot) =>
            Effect.gen(function* () {
              const project = snapshot.projects.find((entry) => entry.id === projectId);
              if (project === undefined) {
                return yield* new OrchestrationGetSnapshotError({
                  message: `Project ${projectId} was not found`,
                  cause: projectId,
                });
              }
              const taskIds = new Set(
                snapshot.tasks
                  .filter((task) => task.projectId === projectId)
                  .map((task) => String(task.id)),
              );
              const pendingGates = (snapshot.pendingGates ?? []).filter((gate) =>
                taskIds.has(String(gate.taskId)),
              );
              const quotaBlockedStages = snapshot.quotaBlockedStages.filter((stage) =>
                taskIds.has(String(stage.taskId)),
              );
              const stageHistory = Object.fromEntries(
                Object.entries(snapshot.stageHistory).filter(([, stage]) =>
                  taskIds.has(String(stage.taskId)),
                ),
              );
              const pmThreadId = pmThreadIdForProject(project);
              const pmThread = snapshot.threads.find((thread) => thread.id === pmThreadId) ?? null;
              const projectConfig = decodeOrchestratorConfig(project.orchestratorConfig ?? {});
              const pmQuotaBlock =
                Option.isSome(projectConfig) && projectConfig.value.pmModelSelection !== null
                  ? yield* providerQuotaStatusRepository
                      .isInstanceQuotaBlocked({
                        providerInstanceId: projectConfig.value.pmModelSelection.instanceId,
                      })
                      .pipe(
                        Effect.map((quotaState) =>
                          quotaState.status === "blocked-until" ||
                          quotaState.status === "blocked-unknown"
                            ? {
                                providerInstanceId: quotaState.providerInstanceId,
                                status: quotaState.status,
                                resetAt: quotaState.resetAt,
                              }
                            : null,
                        ),
                      )
                  : null;
              return {
                snapshotSequence: snapshot.snapshotSequence,
                project,
                pmThreadId,
                pmThread,
                pmQuotaBlock,
                tasks: snapshot.tasks.filter((task) => task.projectId === projectId),
                helperRuns: (snapshot.helperRuns ?? []).filter(
                  (run) => run.projectId === projectId,
                ),
                projectContextRuns: snapshot.projectContextRuns.filter(
                  (run) => run.projectId === projectId,
                ),
                pendingGates,
                quotaBlockedStages,
                stageHistory,
              };
            }),
          ),
          Effect.mapError((cause) =>
            isOrchestrationGetSnapshotError(cause)
              ? cause
              : new OrchestrationGetSnapshotError({
                  message: `Failed to load orchestrator project ${projectId}`,
                  cause,
                }),
          ),
        );

      const loadOrchestratorTaskSnapshot = (taskId: TaskId) =>
        projectionSnapshotQuery.getSnapshot().pipe(
          Effect.flatMap((snapshot) => {
            const task = snapshot.tasks.find((entry) => entry.id === taskId);
            if (task === undefined) {
              return Effect.fail(
                new OrchestrationGetSnapshotError({
                  message: `Task ${taskId} was not found`,
                  cause: taskId,
                }),
              );
            }
            return Effect.succeed({
              snapshotSequence: snapshot.snapshotSequence,
              task,
              pendingGates: (snapshot.pendingGates ?? []).filter((gate) => gate.taskId === taskId),
              stageHistory: Object.fromEntries(
                Object.entries(snapshot.stageHistory).filter(
                  ([, stage]) => stage.taskId === taskId,
                ),
              ),
              helperRuns: (snapshot.helperRuns ?? []).filter(
                (run) => run.attachment.kind === "task" && run.attachment.taskId === taskId,
              ),
            });
          }),
          Effect.mapError((cause) =>
            isOrchestrationGetSnapshotError(cause)
              ? cause
              : new OrchestrationGetSnapshotError({
                  message: `Failed to load orchestrator task ${taskId}`,
                  cause,
                }),
          ),
        );

      const loadMissingPmThreadPlaceholder = (
        threadId: ThreadId,
      ): Effect.Effect<Option.Option<OrchestrationThread>, OrchestrationGetSnapshotError> =>
        Effect.gen(function* () {
          const projectId = projectIdFromPmThreadId(threadId);
          if (projectId === null) {
            return Option.none<OrchestrationThread>();
          }
          const project = yield* projectionSnapshotQuery.getProjectShellById(projectId).pipe(
            Effect.mapError(
              (cause) =>
                new OrchestrationGetSnapshotError({
                  message: `Failed to load project ${projectId} for PM thread ${threadId}`,
                  cause,
                }),
            ),
          );
          if (Option.isNone(project)) {
            return Option.none<OrchestrationThread>();
          }
          const projectConfig = decodeOrchestratorConfig(project.value.orchestratorConfig ?? {});
          const modelSelection =
            Option.isSome(projectConfig) && projectConfig.value.pmModelSelection !== null
              ? projectConfig.value.pmModelSelection
              : project.value.defaultModelSelection;
          if (modelSelection === null) {
            return yield* new OrchestrationGetSnapshotError({
              message: `PM thread ${threadId} cannot be subscribed before creation because project ${projectId} has no PM model selection`,
              cause: projectId,
            });
          }
          return Option.some({
            id: threadId,
            projectId,
            title: `${project.value.title} PM`,
            modelSelection,
            runtimeMode: "approval-required",
            interactionMode: "default",
            branch: null,
            worktreePath: project.value.workspaceRoot,
            latestTurn: null,
            createdAt: project.value.updatedAt,
            updatedAt: project.value.updatedAt,
            archivedAt: null,
            deletedAt: null,
            pendingPmHandoff: null,
            messages: [],
            proposedPlans: [],
            activities: [],
            checkpoints: [],
            session: null,
          });
        });

      const isProjectOrchestratorEvent = (projectId: ProjectId, event: OrchestrationEvent) => {
        if (event.aggregateKind === "project" && event.aggregateId === projectId) {
          return Effect.succeed(true);
        }
        const pmThreadId = pmThreadIdForProject({ id: projectId });
        if (
          event.aggregateKind === "thread" &&
          event.aggregateId === pmThreadId &&
          isThreadDetailEvent(event)
        ) {
          return Effect.succeed(true);
        }

        if (isHelperRunEvent(event)) {
          if (event.type === "helper.run-requested") {
            return Effect.succeed(event.payload.projectId === projectId);
          }
          return projectionSnapshotQuery.getCommandReadModel().pipe(
            Effect.map((readModel) =>
              (readModel.helperRuns ?? []).some(
                (helperRun) =>
                  helperRun.id === event.payload.helperRunId && helperRun.projectId === projectId,
              ),
            ),
            Effect.catch(() => Effect.succeed(false)),
          );
        }

        if (isProjectContextRunEvent(event)) {
          if (event.type === "project.context-run-requested") {
            return Effect.succeed(event.payload.projectId === projectId);
          }
          return projectionSnapshotQuery.getCommandReadModel().pipe(
            Effect.map((readModel) =>
              readModel.projectContextRuns.some(
                (run) =>
                  run.id === event.payload.projectContextRunId && run.projectId === projectId,
              ),
            ),
            Effect.catch(() => Effect.succeed(false)),
          );
        }

        if (!isTaskEvent(event)) {
          return Effect.succeed(false);
        }

        if (event.type === "task.created") {
          return Effect.succeed(event.payload.projectId === projectId);
        }

        return projectionSnapshotQuery.getCommandReadModel().pipe(
          Effect.map((readModel) =>
            readModel.tasks.some(
              (task) => task.id === event.payload.taskId && task.projectId === projectId,
            ),
          ),
          Effect.catch(() => Effect.succeed(false)),
        );
      };

      const isTaskOrchestratorEvent = (taskId: TaskId, event: OrchestrationEvent) => {
        if (event.aggregateKind === "task" && event.aggregateId === taskId) {
          return Effect.succeed(true);
        }
        if (!isHelperRunEvent(event)) {
          return Effect.succeed(false);
        }
        if (event.type === "helper.run-requested") {
          return Effect.succeed(
            event.payload.attachment.kind === "task" && event.payload.attachment.taskId === taskId,
          );
        }
        return projectionSnapshotQuery.getCommandReadModel().pipe(
          Effect.map((readModel) =>
            (readModel.helperRuns ?? []).some(
              (helperRun) =>
                helperRun.id === event.payload.helperRunId &&
                helperRun.attachment.kind === "task" &&
                helperRun.attachment.taskId === taskId,
            ),
          ),
          Effect.catch(() => Effect.succeed(false)),
        );
      };

      const loadServerConfig = Effect.gen(function* () {
        const keybindingsConfig = yield* keybindings.loadConfigState;
        const providers = yield* providerRegistry.getProviders;
        const settings = redactServerSettingsForClient(yield* serverSettings.getSettings);
        const environment = yield* serverEnvironment.getDescriptor;
        const auth = yield* serverAuth.getDescriptor();

        return {
          environment,
          auth,
          cwd: config.cwd,
          keybindingsConfigPath: config.keybindingsConfigPath,
          keybindings: keybindingsConfig.keybindings,
          issues: keybindingsConfig.issues,
          providers,
          availableEditors: ExternalLauncher.resolveAvailableEditors(),
          observability: {
            logsDirectoryPath: config.logsDir,
            localTracingEnabled: true,
            ...(config.otlpTracesUrl !== undefined ? { otlpTracesUrl: config.otlpTracesUrl } : {}),
            otlpTracesEnabled: config.otlpTracesUrl !== undefined,
            ...(config.otlpMetricsUrl !== undefined
              ? { otlpMetricsUrl: config.otlpMetricsUrl }
              : {}),
            otlpMetricsEnabled: config.otlpMetricsUrl !== undefined,
          },
          settings,
        };
      });

      const refreshGitStatus = (cwd: string) =>
        vcsStatusBroadcaster
          .refreshStatus(cwd)
          .pipe(Effect.ignoreCause({ log: true }), Effect.forkDetach, Effect.asVoid);

      return WsRpcGroup.of({
        [ORCHESTRATION_WS_METHODS.dispatchCommand]: (command) =>
          observeRpcEffect(
            ORCHESTRATION_WS_METHODS.dispatchCommand,
            Effect.gen(function* () {
              const normalizedCommand = yield* normalizeDispatchCommand(command);
              if (normalizedCommand.type.startsWith("task.")) {
                yield* requireCompletedPresetMigration;
              }
              const shouldStopSessionAfterArchive =
                normalizedCommand.type === "thread.archive"
                  ? yield* projectionSnapshotQuery
                      .getThreadShellById(normalizedCommand.threadId)
                      .pipe(
                        Effect.map(
                          Option.match({
                            onNone: () => false,
                            onSome: (thread) =>
                              thread.session !== null && thread.session.status !== "stopped",
                          }),
                        ),
                        Effect.catch(() => Effect.succeed(false)),
                      )
                  : false;
              const result = yield* dispatchNormalizedCommand(normalizedCommand);
              if (normalizedCommand.type === "thread.archive") {
                if (shouldStopSessionAfterArchive) {
                  yield* Effect.gen(function* () {
                    const stopCommand = yield* normalizeDispatchCommand({
                      type: "thread.session.stop",
                      commandId: CommandId.make(
                        `session-stop-for-archive:${normalizedCommand.commandId}`,
                      ),
                      threadId: normalizedCommand.threadId,
                      createdAt: yield* nowIso,
                    });

                    yield* dispatchNormalizedCommand(stopCommand);
                  }).pipe(
                    Effect.catchCause((cause) =>
                      Effect.logWarning("failed to stop provider session during archive", {
                        threadId: normalizedCommand.threadId,
                        cause,
                      }),
                    ),
                  );
                }

                yield* terminalManager.close({ threadId: normalizedCommand.threadId }).pipe(
                  Effect.catch((error) =>
                    Effect.logWarning("failed to close thread terminals after archive", {
                      threadId: normalizedCommand.threadId,
                      error: error.message,
                    }),
                  ),
                );
              }
              return result;
            }).pipe(
              Effect.mapError((cause) =>
                isOrchestrationDispatchCommandError(cause)
                  ? cause
                  : new OrchestrationDispatchCommandError({
                      message: "Failed to dispatch orchestration command",
                      cause,
                    }),
              ),
            ),
            { "rpc.aggregate": "orchestration" },
          ),
        [ORCHESTRATION_WS_METHODS.forkThread]: (input) =>
          observeRpcEffect(
            ORCHESTRATION_WS_METHODS.forkThread,
            forkOrchestrationThreadWithServices(
              {
                snapshotQuery: projectionSnapshotQuery,
                providerService,
              },
              {
                newThreadId: crypto.randomUUIDv4.pipe(
                  Effect.map(ThreadId.make),
                  Effect.mapError(
                    (cause) =>
                      new OrchestrationForkThreadError({
                        ...input,
                        reason: "dispatch-failed",
                        message: "Failed to generate a forked task identifier.",
                        cause,
                      }),
                  ),
                ),
                newMessageId: crypto.randomUUIDv4.pipe(
                  Effect.map(MessageId.make),
                  Effect.mapError(
                    (cause) =>
                      new OrchestrationForkThreadError({
                        ...input,
                        reason: "dispatch-failed",
                        message: "Failed to generate a forked message identifier.",
                        cause,
                      }),
                  ),
                ),
                commandId: serverCommandId("thread-fork").pipe(
                  Effect.mapError(
                    (cause) =>
                      new OrchestrationForkThreadError({
                        ...input,
                        reason: "dispatch-failed",
                        message: "Failed to generate a fork command identifier.",
                        cause,
                      }),
                  ),
                ),
                createdAt: nowIso,
                dispatch: orchestrationEngine.dispatch,
              },
              input,
            ),
          ),
        [ORCHESTRATION_WS_METHODS.getTurnDiff]: (input) =>
          observeRpcEffect(
            ORCHESTRATION_WS_METHODS.getTurnDiff,
            checkpointDiffQuery.getTurnDiff(input).pipe(
              Effect.mapError(
                (cause) =>
                  new OrchestrationGetTurnDiffError({
                    message: "Failed to load turn diff",
                    cause,
                  }),
              ),
            ),
            { "rpc.aggregate": "orchestration" },
          ),
        [ORCHESTRATION_WS_METHODS.getFullThreadDiff]: (input) =>
          observeRpcEffect(
            ORCHESTRATION_WS_METHODS.getFullThreadDiff,
            checkpointDiffQuery.getFullThreadDiff(input).pipe(
              Effect.mapError(
                (cause) =>
                  new OrchestrationGetFullThreadDiffError({
                    message: "Failed to load full thread diff",
                    cause,
                  }),
              ),
            ),
            { "rpc.aggregate": "orchestration" },
          ),
        [ORCHESTRATION_WS_METHODS.replayEvents]: (input) =>
          observeRpcEffect(
            ORCHESTRATION_WS_METHODS.replayEvents,
            Stream.runCollect(
              orchestrationEngine.readEvents(
                clamp(input.fromSequenceExclusive, {
                  maximum: Number.MAX_SAFE_INTEGER,
                  minimum: 0,
                }),
              ),
            ).pipe(
              Effect.map((events) => Array.from(events)),
              Effect.flatMap(enrichOrchestrationEvents),
              Effect.mapError(
                (cause) =>
                  new OrchestrationReplayEventsError({
                    message: "Failed to replay orchestration events",
                    cause,
                  }),
              ),
            ),
            { "rpc.aggregate": "orchestration" },
          ),
        [ORCHESTRATION_WS_METHODS.subscribeShell]: (_input) =>
          observeRpcStreamEffect(
            ORCHESTRATION_WS_METHODS.subscribeShell,
            Effect.gen(function* () {
              const snapshot = yield* projectionSnapshotQuery.getShellSnapshot().pipe(
                Effect.tapError((cause) =>
                  Effect.logError("orchestration shell snapshot load failed", { cause }),
                ),
                Effect.mapError(
                  (cause) =>
                    new OrchestrationGetSnapshotError({
                      message: "Failed to load orchestration shell snapshot",
                      cause,
                    }),
                ),
              );

              // The domain-event -> shell mapping is computed once in the
              // engine and fanned out to all subscribers, so this stream is
              // already mapped and requires no per-subscriber re-query.
              const liveStream = orchestrationEngine.streamShellEvents;

              return Stream.concat(
                Stream.make({
                  kind: "snapshot" as const,
                  snapshot,
                }),
                liveStream,
              );
            }),
            { "rpc.aggregate": "orchestration" },
          ),
        [ORCHESTRATION_WS_METHODS.getArchivedShellSnapshot]: (_input) =>
          observeRpcEffect(
            ORCHESTRATION_WS_METHODS.getArchivedShellSnapshot,
            projectionSnapshotQuery.getArchivedShellSnapshot().pipe(
              Effect.tapError((cause) =>
                Effect.logError("orchestration archived shell snapshot load failed", { cause }),
              ),
              Effect.mapError(
                (cause) =>
                  new OrchestrationGetSnapshotError({
                    message: "Failed to load archived orchestration shell snapshot",
                    cause,
                  }),
              ),
            ),
            { "rpc.aggregate": "orchestration" },
          ),
        [ORCHESTRATION_WS_METHODS.subscribeThread]: (input) =>
          observeRpcStreamEffect(
            ORCHESTRATION_WS_METHODS.subscribeThread,
            Effect.gen(function* () {
              const [loadedThreadDetail, snapshotSequence] = yield* Effect.all([
                projectionSnapshotQuery.getThreadDetailById(input.threadId).pipe(
                  Effect.mapError(
                    (cause) =>
                      new OrchestrationGetSnapshotError({
                        message: `Failed to load thread ${input.threadId}`,
                        cause,
                      }),
                  ),
                ),
                projectionSnapshotQuery.getSnapshotSequence().pipe(
                  Effect.map(({ snapshotSequence }) => snapshotSequence),
                  Effect.mapError(
                    (cause) =>
                      new OrchestrationGetSnapshotError({
                        message: "Failed to load orchestration snapshot sequence",
                        cause,
                      }),
                  ),
                ),
              ]);

              let threadDetail = loadedThreadDetail;
              if (Option.isNone(threadDetail)) {
                threadDetail = yield* loadMissingPmThreadPlaceholder(input.threadId);
                if (Option.isNone(threadDetail)) {
                  return yield* new OrchestrationGetSnapshotError({
                    message: `Thread ${input.threadId} was not found`,
                    cause: input.threadId,
                  });
                }
              }

              const liveStream = orchestrationEngine.streamDomainEvents.pipe(
                Stream.filter(
                  (event) =>
                    event.aggregateKind === "thread" &&
                    event.aggregateId === input.threadId &&
                    isThreadDetailEvent(event),
                ),
                Stream.map((event) => ({
                  kind: "event" as const,
                  event,
                })),
              );
              const replayStream = orchestrationEngine.readEvents(snapshotSequence).pipe(
                Stream.filter(
                  (event) =>
                    event.aggregateKind === "thread" &&
                    event.aggregateId === input.threadId &&
                    isThreadDetailEvent(event) &&
                    isAfterLastThreadClear(event, threadDetail.value.lastClearedSequence),
                ),
                Stream.map((event) => ({
                  kind: "event" as const,
                  event,
                })),
                Stream.mapError(
                  (cause) =>
                    new OrchestrationGetSnapshotError({
                      message: `Failed to replay thread ${input.threadId} events`,
                      cause,
                    }),
                ),
              );

              return Stream.concat(
                Stream.make({
                  kind: "snapshot" as const,
                  snapshot: {
                    snapshotSequence,
                    thread: threadDetail.value,
                  },
                }),
                Stream.concat(replayStream, liveStream),
              );
            }),
            { "rpc.aggregate": "orchestration" },
          ),
        [ORCHESTRATOR_WS_METHODS.getPresetMigration]: (_input) =>
          observeRpcEffect(
            ORCHESTRATOR_WS_METHODS.getPresetMigration,
            Effect.all({
              settings: serverSettings.getSettings,
              readModel: projectionSnapshotQuery.getCommandReadModel(),
            }).pipe(
              Effect.map(buildOrchestratorPresetMigrationState),
              Effect.mapError((cause) =>
                toDispatchCommandError(cause, "Failed to inspect capability preset migration."),
              ),
            ),
            { "rpc.aggregate": "orchestrator" },
          ),
        [ORCHESTRATOR_WS_METHODS.completePresetMigration]: (input) =>
          observeRpcEffect(
            ORCHESTRATOR_WS_METHODS.completePresetMigration,
            Effect.gen(function* () {
              const settings = yield* serverSettings.getSettings;
              const readModel = yield* projectionSnapshotQuery.getCommandReadModel();
              const state = buildOrchestratorPresetMigrationState({
                settings,
                readModel,
              });
              if (state.status === "completed") {
                return state;
              }
              const decisions = yield* Effect.try({
                try: () =>
                  validateOrchestratorPresetMigrationCompletion({
                    state,
                    completion: input,
                  }),
                catch: (cause) =>
                  new OrchestrationDispatchCommandError({
                    message:
                      cause instanceof Error
                        ? cause.message
                        : "Invalid capability preset migration decisions.",
                    cause,
                  }),
              });

              yield* Effect.forEach(
                state.projects,
                (legacyProject) =>
                  Effect.gen(function* () {
                    const project = readModel.projects.find(
                      (candidate) => candidate.id === legacyProject.projectId,
                    );
                    if (project === undefined) {
                      return yield* new OrchestrationDispatchCommandError({
                        message: `Project '${legacyProject.projectId}' disappeared during preset migration.`,
                      });
                    }
                    const commandId = yield* serverCommandId(
                      "orchestrator-complete-preset-migration-project",
                    );
                    yield* dispatchNormalizedCommand({
                      type: "project.meta.update",
                      commandId,
                      projectId: project.id,
                      orchestratorConfig: {
                        ...project.orchestratorConfig,
                        capabilityPresets: decisions.get(String(project.id)) ?? {},
                      },
                    });
                  }),
                { concurrency: 1, discard: true },
              );

              const completedSettings = yield* serverSettings.updateSettings({
                orchestratorDefaults: configuredOrchestratorDefaults({
                  settings,
                  globalPresets: input.globalPresets,
                }),
              });
              const completedReadModel = yield* projectionSnapshotQuery.getCommandReadModel();
              return buildOrchestratorPresetMigrationState({
                settings: completedSettings,
                readModel: completedReadModel,
              });
            }).pipe(
              Effect.mapError((cause) =>
                toDispatchCommandError(cause, "Failed to complete capability preset migration."),
              ),
            ),
            { "rpc.aggregate": "orchestrator" },
          ),
        [ORCHESTRATOR_WS_METHODS.sendMessage]: (input) =>
          observeRpcEffect(
            ORCHESTRATOR_WS_METHODS.sendMessage,
            Effect.gen(function* () {
              const project = yield* loadProjectForPmRuntime(input.projectId);
              const runtime = yield* pmProjectRuntimeFactory.getOrCreate(project).pipe(
                Effect.mapError(
                  (cause) =>
                    new OrchestrationDispatchCommandError({
                      message: "Failed to start PM runtime",
                      cause,
                    }),
                ),
              );
              yield* runtime.surfaceUserMessage(input.message).pipe(
                Effect.mapError(
                  (cause) =>
                    new OrchestrationDispatchCommandError({
                      message: "Failed to surface PM user message",
                      cause,
                    }),
                ),
              );
              yield* runtime.enqueue(input.message).pipe(
                Effect.mapError(
                  (cause) =>
                    new OrchestrationDispatchCommandError({
                      message: "Failed to enqueue PM message",
                      cause,
                    }),
                ),
              );
              yield* runtime.drain.pipe(
                Effect.catchCause((cause) =>
                  Effect.logWarning("PM runtime failed while handling websocket message", {
                    projectId: String(input.projectId),
                    cause: Cause.pretty(cause),
                  }),
                ),
                Effect.forkDetach,
              );
              return { accepted: true as const };
            }),
            { "rpc.aggregate": "orchestrator" },
          ),
        [ORCHESTRATOR_WS_METHODS.subscribeProject]: (input) =>
          observeRpcStreamEffect(
            ORCHESTRATOR_WS_METHODS.subscribeProject,
            Effect.gen(function* () {
              const snapshot = yield* loadOrchestratorProjectSnapshot(input.projectId);
              const pmThreadLastClearedSequence = snapshot.pmThread?.lastClearedSequence;
              const liveStream = orchestrationEngine.streamDomainEvents.pipe(
                Stream.filterEffect((event) => isProjectOrchestratorEvent(input.projectId, event)),
                Stream.map((event) => ({
                  kind: "event" as const,
                  event,
                })),
              );
              const replayStream = orchestrationEngine.readEvents(snapshot.snapshotSequence).pipe(
                Stream.filterEffect((event) => isProjectOrchestratorEvent(input.projectId, event)),
                Stream.filter((event) => {
                  if (
                    event.aggregateKind !== "thread" ||
                    event.aggregateId !== snapshot.pmThreadId ||
                    !isThreadDetailEvent(event)
                  ) {
                    return true;
                  }
                  return isAfterLastThreadClear(event, pmThreadLastClearedSequence);
                }),
                Stream.map((event) => ({
                  kind: "event" as const,
                  event,
                })),
                Stream.mapError(
                  (cause) =>
                    new OrchestrationGetSnapshotError({
                      message: `Failed to replay project ${input.projectId} events`,
                      cause,
                    }),
                ),
              );

              return Stream.concat(
                Stream.make({
                  kind: "snapshot" as const,
                  snapshot,
                }),
                Stream.concat(replayStream, liveStream),
              );
            }),
            { "rpc.aggregate": "orchestrator" },
          ),
        [ORCHESTRATOR_WS_METHODS.subscribeTask]: (input) =>
          observeRpcStreamEffect(
            ORCHESTRATOR_WS_METHODS.subscribeTask,
            Effect.gen(function* () {
              const snapshot = yield* loadOrchestratorTaskSnapshot(input.taskId);
              const liveStream = orchestrationEngine.streamDomainEvents.pipe(
                Stream.filterEffect((event) => isTaskOrchestratorEvent(input.taskId, event)),
                Stream.map((event) => ({
                  kind: "event" as const,
                  event,
                })),
              );
              const replayStream = orchestrationEngine.readEvents(snapshot.snapshotSequence).pipe(
                Stream.filterEffect((event) => isTaskOrchestratorEvent(input.taskId, event)),
                Stream.map((event) => ({
                  kind: "event" as const,
                  event,
                })),
                Stream.mapError(
                  (cause) =>
                    new OrchestrationGetSnapshotError({
                      message: `Failed to replay task ${input.taskId} events`,
                      cause,
                    }),
                ),
              );

              return Stream.concat(
                Stream.make({
                  kind: "snapshot" as const,
                  snapshot,
                }),
                Stream.concat(replayStream, liveStream),
              );
            }),
            { "rpc.aggregate": "orchestrator" },
          ),
        [ORCHESTRATOR_WS_METHODS.resolveGate]: (input) =>
          observeRpcEffect(
            ORCHESTRATOR_WS_METHODS.resolveGate,
            Effect.gen(function* () {
              const commandId = yield* serverCommandId("orchestrator-resolve-gate");
              const createdAt = yield* nowIso;
              const worktreeCompletion =
                input.gate === "land" && input.decision === "approved"
                  ? yield* projectionSnapshotQuery.getCommandReadModel().pipe(
                      Effect.flatMap((readModel) => {
                        const task = readModel.tasks.find((entry) => entry.id === input.taskId);
                        return task?.worktreePath
                          ? inspectTaskWorktreeCompletion({
                              worktreePath: task.worktreePath,
                              process: vcsProcess,
                            }).pipe(Effect.map(Option.some))
                          : Effect.succeed(Option.none());
                      }),
                    )
                  : Option.none();
              return yield* dispatchNormalizedCommand({
                type: "task.gate.resolve",
                commandId,
                taskId: input.taskId,
                gateId: input.gateId,
                gate: input.gate,
                approvedHash: input.approvedHash,
                decision: input.decision,
                origin: "human",
                ...(Option.isSome(worktreeCompletion)
                  ? { worktreeCompletion: worktreeCompletion.value }
                  : {}),
                createdAt,
              });
            }).pipe(
              Effect.mapError((cause) =>
                isOrchestrationDispatchCommandError(cause)
                  ? cause
                  : toDispatchCommandError(cause, "Failed to resolve orchestration gate"),
              ),
            ),
            { "rpc.aggregate": "orchestrator" },
          ),
        [ORCHESTRATOR_WS_METHODS.setTaskCapabilityTiers]: (input) =>
          observeRpcEffect(
            ORCHESTRATOR_WS_METHODS.setTaskCapabilityTiers,
            Effect.all({
              commandId: serverCommandId("orchestrator-set-task-capability-tiers"),
              createdAt: nowIso,
            }).pipe(
              Effect.flatMap(({ commandId, createdAt }) =>
                dispatchNormalizedCommand({
                  type: "task.capability-tiers.set",
                  commandId,
                  taskId: input.taskId,
                  roleCapabilityTiers: input.roleCapabilityTiers,
                  origin: "human",
                  createdAt,
                }),
              ),
            ),
            { "rpc.aggregate": "orchestrator" },
          ),
        [ORCHESTRATOR_WS_METHODS.cancelTask]: (input) =>
          observeRpcEffect(
            ORCHESTRATOR_WS_METHODS.cancelTask,
            cancelOrchestrationTaskWithServices(
              {
                snapshotQuery: projectionSnapshotQuery,
                providerService,
                terminalManager,
              },
              {
                taskId: input.taskId,
                commandId: serverCommandId("orchestrator-cancel-task"),
                createdAt: nowIso.pipe(
                  Effect.mapError((cause) =>
                    toDispatchCommandError(cause, "Failed to timestamp cancellation command."),
                  ),
                ),
                dispatch: dispatchNormalizedCommand,
              },
            ).pipe(
              Effect.mapError((cause) =>
                isOrchestrationCancelTaskError(cause)
                  ? cause
                  : toDispatchCommandError(cause, "Failed to cancel orchestration task"),
              ),
            ),
            { "rpc.aggregate": "orchestrator" },
          ),
        [ORCHESTRATOR_WS_METHODS.interruptStage]: (input) =>
          observeRpcEffect(
            ORCHESTRATOR_WS_METHODS.interruptStage,
            interruptOrchestrationStageWithServices(
              { snapshotQuery: projectionSnapshotQuery },
              {
                taskId: input.taskId,
                commandId: serverCommandId("orchestrator-interrupt-stage"),
                createdAt: nowIso,
                dispatch: dispatchNormalizedCommand,
              },
            ).pipe(
              Effect.mapError((cause) =>
                isOrchestrationInterruptStageError(cause)
                  ? cause
                  : toDispatchCommandError(cause, "Failed to interrupt orchestration stage"),
              ),
            ),
            { "rpc.aggregate": "orchestrator" },
          ),
        [ORCHESTRATOR_WS_METHODS.inspectTaskChanges]: (input) =>
          observeRpcEffect(
            ORCHESTRATOR_WS_METHODS.inspectTaskChanges,
            inspectOrchestratorTaskChanges(
              { snapshotQuery: projectionSnapshotQuery, vcsProcess },
              input.taskId,
            ).pipe(
              Effect.map((changes) => ({ taskId: input.taskId, changes })),
              Effect.mapError((cause) =>
                toDispatchCommandError(cause, "Failed to inspect task changes"),
              ),
            ),
            { "rpc.aggregate": "orchestrator" },
          ),
        [ORCHESTRATOR_WS_METHODS.commitTaskChanges]: (input) =>
          observeRpcEffect(
            ORCHESTRATOR_WS_METHODS.commitTaskChanges,
            commitOrchestratorTaskChanges(
              { snapshotQuery: projectionSnapshotQuery, vcsProcess },
              {
                taskId: input.taskId,
                paths: input.paths,
                message: input.message,
                commandId: (tag) => serverCommandId(`orchestrator-${tag}`),
                createdAt: nowIso,
                dispatch: dispatchNormalizedCommand,
              },
            ).pipe(
              Effect.map((result) => ({ taskId: input.taskId, ...result })),
              Effect.mapError((cause) =>
                toDispatchCommandError(cause, "Failed to commit task changes"),
              ),
            ),
            { "rpc.aggregate": "orchestrator" },
          ),
        [ORCHESTRATOR_WS_METHODS.discardTaskChanges]: (input) =>
          observeRpcEffect(
            ORCHESTRATOR_WS_METHODS.discardTaskChanges,
            discardOrchestratorTaskChanges(
              { snapshotQuery: projectionSnapshotQuery, vcsProcess },
              {
                taskId: input.taskId,
                paths: input.paths,
                commandId: (tag) => serverCommandId(`orchestrator-${tag}`),
                createdAt: nowIso,
                dispatch: dispatchNormalizedCommand,
              },
            ).pipe(
              Effect.map((result) => ({ taskId: input.taskId, ...result })),
              Effect.mapError((cause) =>
                toDispatchCommandError(cause, "Failed to discard task changes"),
              ),
            ),
            { "rpc.aggregate": "orchestrator" },
          ),
        [ORCHESTRATOR_WS_METHODS.returnTaskChanges]: (input) =>
          observeRpcEffect(
            ORCHESTRATOR_WS_METHODS.returnTaskChanges,
            returnOrchestratorTaskChanges(
              { snapshotQuery: projectionSnapshotQuery, vcsProcess },
              {
                taskId: input.taskId,
                instructions: input.instructions,
                commandId: (tag) => serverCommandId(`orchestrator-${tag}`),
                createdAt: nowIso,
                dispatch: dispatchNormalizedCommand,
              },
            ).pipe(
              Effect.map((result) => ({ taskId: input.taskId, ...result })),
              Effect.mapError((cause) =>
                toDispatchCommandError(cause, "Failed to return task changes"),
              ),
            ),
            { "rpc.aggregate": "orchestrator" },
          ),
        [ORCHESTRATOR_WS_METHODS.completeTaskWithoutChanges]: (input) =>
          observeRpcEffect(
            ORCHESTRATOR_WS_METHODS.completeTaskWithoutChanges,
            completeOrchestratorTaskWithoutChanges(
              { snapshotQuery: projectionSnapshotQuery, vcsProcess },
              {
                taskId: input.taskId,
                commandId: (tag) => serverCommandId(`orchestrator-${tag}`),
                createdAt: nowIso,
                dispatch: dispatchNormalizedCommand,
              },
            ).pipe(
              Effect.map((result) => ({ taskId: input.taskId, ...result })),
              Effect.mapError((cause) =>
                toDispatchCommandError(cause, "Failed to complete task without changes"),
              ),
            ),
            { "rpc.aggregate": "orchestrator" },
          ),
        [ORCHESTRATOR_WS_METHODS.landTask]: (input) =>
          observeRpcEffect(
            ORCHESTRATOR_WS_METHODS.landTask,
            landOrchestrationTaskWithServices(
              { snapshotQuery: projectionSnapshotQuery, vcsProcess },
              {
                taskId: input.taskId,
                commandId: serverCommandId("orchestrator-land-task"),
                createdAt: nowIso,
                dispatch: dispatchNormalizedCommand,
              },
            ).pipe(
              Effect.mapError((cause) =>
                isTaskLandingError(cause)
                  ? new OrchestrationLandTaskError({
                      taskId: cause.taskId,
                      reason: cause.reason,
                      message: cause.detail,
                    })
                  : toDispatchCommandError(cause, "Failed to land orchestration task"),
              ),
            ),
            { "rpc.aggregate": "orchestrator" },
          ),
        [ORCHESTRATOR_WS_METHODS.listArchivedTasks]: (input) =>
          observeRpcEffect(
            ORCHESTRATOR_WS_METHODS.listArchivedTasks,
            projectionSnapshotQuery.getCommandReadModel().pipe(
              Effect.map((readModel) =>
                readModel.tasks.filter(
                  (task) =>
                    task.projectId === input.projectId &&
                    task.archivedAt !== null &&
                    task.deletedAt === null,
                ),
              ),
              Effect.mapError(
                (cause) =>
                  new OrchestrationGetSnapshotError({
                    message: `Failed to list archived tasks for project ${input.projectId}`,
                    cause,
                  }),
              ),
            ),
            { "rpc.aggregate": "orchestrator" },
          ),
        [ORCHESTRATOR_WS_METHODS.archiveTask]: (input) =>
          observeRpcEffect(
            ORCHESTRATOR_WS_METHODS.archiveTask,
            serverCommandId("orchestrator-archive-task").pipe(
              Effect.flatMap((commandId) =>
                dispatchNormalizedCommand({
                  type: "task.archive",
                  commandId,
                  taskId: input.taskId,
                }),
              ),
            ),
            { "rpc.aggregate": "orchestrator" },
          ),
        [ORCHESTRATOR_WS_METHODS.restoreTask]: (input) =>
          observeRpcEffect(
            ORCHESTRATOR_WS_METHODS.restoreTask,
            serverCommandId("orchestrator-restore-task").pipe(
              Effect.flatMap((commandId) =>
                dispatchNormalizedCommand({
                  type: "task.restore",
                  commandId,
                  taskId: input.taskId,
                }),
              ),
            ),
            { "rpc.aggregate": "orchestrator" },
          ),
        [ORCHESTRATOR_WS_METHODS.deleteTask]: (input) =>
          observeRpcEffect(
            ORCHESTRATOR_WS_METHODS.deleteTask,
            serverCommandId("orchestrator-delete-task").pipe(
              Effect.flatMap((commandId) =>
                dispatchNormalizedCommand({
                  type: "task.delete",
                  commandId,
                  taskId: input.taskId,
                }),
              ),
            ),
            { "rpc.aggregate": "orchestrator" },
          ),
        [ORCHESTRATOR_WS_METHODS.clearPmChat]: (input) =>
          observeRpcEffect(
            ORCHESTRATOR_WS_METHODS.clearPmChat,
            Effect.gen(function* () {
              const project = yield* loadProjectForPmRuntime(input.projectId);
              const pmThreadId = pmThreadIdForProject(project);
              const { commandId, createdAt } = yield* Effect.all({
                commandId: serverCommandId("orchestrator-clear-pm-chat"),
                createdAt: nowIso,
              });

              yield* pmProjectRuntimeFactory
                .waitForIdle(project.id)
                .pipe(
                  Effect.mapError((cause) =>
                    toDispatchCommandError(cause, "Failed to wait for PM runtime to become idle."),
                  ),
                );
              const result = yield* dispatchNormalizedCommand({
                type: "thread.clear",
                commandId,
                threadId: pmThreadId,
                createdAt,
              });
              yield* pmProjectRuntimeFactory
                .clearSessionStorage(project)
                .pipe(
                  Effect.mapError((cause) =>
                    toDispatchCommandError(cause, "Failed to clear PM session storage."),
                  ),
                );
              yield* pmProjectRuntimeFactory
                .invalidateRuntime(project.id, "PM chat cleared")
                .pipe(
                  Effect.mapError((cause) =>
                    toDispatchCommandError(cause, "Failed to invalidate PM runtime."),
                  ),
                );
              return result;
            }),
            { "rpc.aggregate": "orchestrator" },
          ),
        [ORCHESTRATOR_WS_METHODS.requestPmHandoff]: (input) =>
          observeRpcEffect(
            ORCHESTRATOR_WS_METHODS.requestPmHandoff,
            Effect.gen(function* () {
              const project = yield* loadProjectForPmRuntime(input.projectId);
              const pmThreadId = pmThreadIdForProject(project);
              const dispatchRequest = (request: {
                readonly mode: PmHandoffMode;
                readonly brief?: string;
              }): Effect.Effect<void, OrchestrationDispatchCommandError> =>
                Effect.gen(function* () {
                  const { commandId, createdAt } = yield* Effect.all({
                    commandId: serverCommandId("orchestrator-request-pm-handoff"),
                    createdAt: nowIso,
                  });
                  yield* dispatchNormalizedCommand({
                    type: "thread.pm-handoff.request",
                    commandId,
                    threadId: pmThreadId,
                    mode: request.mode,
                    ...(request.brief !== undefined ? { brief: request.brief } : {}),
                    createdAt,
                  });
                  yield* pmProjectRuntimeFactory
                    .resetSessionBinding(project)
                    .pipe(
                      Effect.mapError((cause) =>
                        toDispatchCommandError(
                          cause,
                          "Failed to reset PM session binding for handoff.",
                        ),
                      ),
                    );
                });

              if (input.mode === "transcript") {
                yield* pmProjectRuntimeFactory
                  .waitForIdle(project.id)
                  .pipe(
                    Effect.mapError((cause) =>
                      toDispatchCommandError(
                        cause,
                        "Failed to wait for PM runtime to become idle.",
                      ),
                    ),
                  );
                yield* dispatchRequest({ mode: "transcript" });
                return { accepted: true as const, mode: "transcript" as const };
              }

              const summaryResult = yield* pmProjectRuntimeFactory
                .createHandoffBrief(project.id)
                .pipe(Effect.result);
              if (Result.isSuccess(summaryResult) && Option.isSome(summaryResult.success)) {
                yield* dispatchRequest({
                  mode: "summary",
                  brief: summaryResult.success.value,
                });
                return { accepted: true as const, mode: "summary" as const };
              }

              const fallback = Result.isFailure(summaryResult)
                ? `Summary handoff failed; using transcript handoff. Reason: ${pmHandoffFallbackReason(summaryResult.failure)}`
                : "No active PM runtime; using transcript handoff.";
              yield* dispatchRequest({ mode: "transcript" });
              return {
                accepted: true as const,
                mode: "transcript" as const,
                fallback,
              };
            }),
            { "rpc.aggregate": "orchestrator" },
          ),
        [ORCHESTRATOR_WS_METHODS.requestProjectContextRun]: (input) =>
          observeRpcEffect(
            ORCHESTRATOR_WS_METHODS.requestProjectContextRun,
            // @effect-diagnostics-next-line anyUnknownInErrorContext:off
            projectContextRunCoordinator.request(input).pipe(
              Effect.map(({ projectContextRunId, sequence }) => ({
                runId: projectContextRunId,
                sequence,
              })),
              Effect.mapError((cause) =>
                toDispatchCommandError(cause, "Failed to request a project-context run."),
              ),
            ),
            { "rpc.aggregate": "orchestrator" },
          ),
        [ORCHESTRATOR_WS_METHODS.getProjectContextOnboarding]: (input) =>
          observeRpcEffect(
            ORCHESTRATOR_WS_METHODS.getProjectContextOnboarding,
            projectContextOnboardingCoordinator
              .get(input)
              .pipe(
                Effect.mapError((cause) =>
                  toDispatchCommandError(cause, "Failed to scan project context onboarding."),
                ),
              ),
            { "rpc.aggregate": "orchestrator" },
          ),
        [ORCHESTRATOR_WS_METHODS.dismissProjectContextOnboarding]: (input) =>
          observeRpcEffect(
            ORCHESTRATOR_WS_METHODS.dismissProjectContextOnboarding,
            projectContextOnboardingCoordinator
              .dismiss(input)
              .pipe(
                Effect.mapError((cause) =>
                  toDispatchCommandError(cause, "Failed to dismiss project context onboarding."),
                ),
              ),
            { "rpc.aggregate": "orchestrator" },
          ),
        [WS_METHODS.serverGetConfig]: (_input) =>
          observeRpcEffect(WS_METHODS.serverGetConfig, loadServerConfig, {
            "rpc.aggregate": "server",
          }),
        [WS_METHODS.serverRefreshProviders]: (input) =>
          observeRpcEffect(
            WS_METHODS.serverRefreshProviders,
            (input.instanceId !== undefined
              ? providerRegistry.refreshInstance(input.instanceId)
              : providerRegistry.refresh()
            ).pipe(Effect.map((providers) => ({ providers }))),
            { "rpc.aggregate": "server" },
          ),
        [WS_METHODS.serverUpdateProvider]: (input) =>
          observeRpcEffect(
            WS_METHODS.serverUpdateProvider,
            providerMaintenanceRunner.updateProvider(input),
            {
              "rpc.aggregate": "server",
            },
          ),
        [WS_METHODS.serverUpsertKeybinding]: (rule) =>
          observeRpcEffect(
            WS_METHODS.serverUpsertKeybinding,
            Effect.gen(function* () {
              const keybindingsConfig = yield* keybindings.upsertKeybindingRule(rule);
              return { keybindings: keybindingsConfig, issues: [] };
            }),
            { "rpc.aggregate": "server" },
          ),
        [WS_METHODS.serverRemoveKeybinding]: (rule) =>
          observeRpcEffect(
            WS_METHODS.serverRemoveKeybinding,
            Effect.gen(function* () {
              const keybindingsConfig = yield* keybindings.removeKeybindingRule(rule);
              return { keybindings: keybindingsConfig, issues: [] };
            }),
            { "rpc.aggregate": "server" },
          ),
        [WS_METHODS.serverGetSettings]: (_input) =>
          observeRpcEffect(
            WS_METHODS.serverGetSettings,
            serverSettings.getSettings.pipe(Effect.map(redactServerSettingsForClient)),
            {
              "rpc.aggregate": "server",
            },
          ),
        [WS_METHODS.serverUpdateSettings]: ({ patch }) =>
          observeRpcEffect(
            WS_METHODS.serverUpdateSettings,
            Effect.gen(function* () {
              const current = yield* serverSettings.getSettings;
              if (
                current.orchestratorDefaults.capabilityPresets === null &&
                patch.orchestratorDefaults?.capabilityPresets !== null &&
                patch.orchestratorDefaults?.capabilityPresets !== undefined
              ) {
                return yield* new ServerSettingsError({
                  settingsPath: "orchestratorDefaults.capabilityPresets",
                  detail:
                    "Complete capability preset migration through the Orchestrator migration flow.",
                });
              }
              return yield* serverSettings
                .updateSettings(patch)
                .pipe(Effect.map(redactServerSettingsForClient));
            }),
            {
              "rpc.aggregate": "server",
            },
          ),
        [WS_METHODS.serverDiscoverSourceControl]: (_input) =>
          observeRpcEffect(
            WS_METHODS.serverDiscoverSourceControl,
            sourceControlDiscovery.discover,
            {
              "rpc.aggregate": "server",
            },
          ),
        [WS_METHODS.serverGetTraceDiagnostics]: (_input) =>
          observeRpcEffect(
            WS_METHODS.serverGetTraceDiagnostics,
            TraceDiagnostics.readTraceDiagnostics({
              traceFilePath: config.serverTracePath,
              maxFiles: config.traceMaxFiles,
            }),
            {
              "rpc.aggregate": "server",
            },
          ),
        [WS_METHODS.serverGetProcessDiagnostics]: (_input) =>
          observeRpcEffect(WS_METHODS.serverGetProcessDiagnostics, processDiagnostics.read, {
            "rpc.aggregate": "server",
          }),
        [WS_METHODS.serverGetProcessResourceHistory]: (input) =>
          observeRpcEffect(
            WS_METHODS.serverGetProcessResourceHistory,
            processResourceMonitor.readHistory(input),
            {
              "rpc.aggregate": "server",
            },
          ),
        [WS_METHODS.serverSignalProcess]: (input) =>
          observeRpcEffect(WS_METHODS.serverSignalProcess, processDiagnostics.signal(input), {
            "rpc.aggregate": "server",
          }),
        [WS_METHODS.sourceControlLookupRepository]: (input) =>
          observeRpcEffect(
            WS_METHODS.sourceControlLookupRepository,
            sourceControlRepositories.lookupRepository(input),
            {
              "rpc.aggregate": "source-control",
            },
          ),
        [WS_METHODS.sourceControlCloneRepository]: (input) =>
          observeRpcEffect(
            WS_METHODS.sourceControlCloneRepository,
            sourceControlRepositories.cloneRepository(input),
            {
              "rpc.aggregate": "source-control",
            },
          ),
        [WS_METHODS.sourceControlPublishRepository]: (input) =>
          observeRpcEffect(
            WS_METHODS.sourceControlPublishRepository,
            sourceControlRepositories
              .publishRepository(input)
              .pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
            {
              "rpc.aggregate": "source-control",
            },
          ),
        [WS_METHODS.projectsSearchEntries]: (input) =>
          observeRpcEffect(
            WS_METHODS.projectsSearchEntries,
            workspaceEntries.search(input).pipe(
              Effect.mapError(
                (cause) =>
                  new ProjectSearchEntriesError({
                    message: `Failed to search workspace entries: ${cause.detail}`,
                    cause,
                  }),
              ),
            ),
            { "rpc.aggregate": "workspace" },
          ),
        [WS_METHODS.projectsWriteFile]: (input) =>
          observeRpcEffect(
            WS_METHODS.projectsWriteFile,
            workspaceFileSystem.writeFile(input).pipe(
              Effect.mapError((cause) => {
                const message = isWorkspacePathOutsideRootError(cause)
                  ? "Workspace file path must stay within the project root."
                  : "Failed to write workspace file";
                return new ProjectWriteFileError({
                  message,
                  cause,
                });
              }),
            ),
            { "rpc.aggregate": "workspace" },
          ),
        [WS_METHODS.shellOpenInEditor]: (input) =>
          observeRpcEffect(WS_METHODS.shellOpenInEditor, externalLauncher.launchEditor(input), {
            "rpc.aggregate": "workspace",
          }),
        [WS_METHODS.filesystemBrowse]: (input) =>
          observeRpcEffect(
            WS_METHODS.filesystemBrowse,
            workspaceEntries.browse(input).pipe(
              Effect.mapError(
                (cause) =>
                  new FilesystemBrowseError({
                    message: cause.detail,
                    cause,
                  }),
              ),
            ),
            { "rpc.aggregate": "workspace" },
          ),
        [WS_METHODS.subscribeVcsStatus]: (input) =>
          observeRpcStream(
            WS_METHODS.subscribeVcsStatus,
            vcsStatusBroadcaster.streamStatus(input, {
              automaticRemoteRefreshInterval: automaticGitFetchInterval,
            }),
            {
              "rpc.aggregate": "vcs",
            },
          ),
        [WS_METHODS.vcsRefreshStatus]: (input) =>
          observeRpcEffect(
            WS_METHODS.vcsRefreshStatus,
            vcsStatusBroadcaster.refreshStatus(input.cwd),
            {
              "rpc.aggregate": "vcs",
            },
          ),
        [WS_METHODS.vcsPull]: (input) =>
          observeRpcEffect(
            WS_METHODS.vcsPull,
            gitWorkflow.pullCurrentBranch(input.cwd).pipe(
              Effect.matchCauseEffect({
                onFailure: (cause) => Effect.failCause(cause),
                onSuccess: (result) =>
                  refreshGitStatus(input.cwd).pipe(Effect.ignore({ log: true }), Effect.as(result)),
              }),
            ),
            { "rpc.aggregate": "git" },
          ),
        [WS_METHODS.gitRunStackedAction]: (input) =>
          observeRpcStream(
            WS_METHODS.gitRunStackedAction,
            Stream.callback<GitActionProgressEvent, GitManagerServiceError>((queue) =>
              gitWorkflow
                .runStackedAction(input, {
                  actionId: input.actionId,
                  progressReporter: {
                    publish: (event) => Queue.offer(queue, event).pipe(Effect.asVoid),
                  },
                })
                .pipe(
                  Effect.matchCauseEffect({
                    onFailure: (cause) => Queue.failCause(queue, cause),
                    onSuccess: () =>
                      refreshGitStatus(input.cwd).pipe(
                        Effect.andThen(Queue.end(queue).pipe(Effect.asVoid)),
                      ),
                  }),
                ),
            ),
            { "rpc.aggregate": "vcs" },
          ),
        [WS_METHODS.gitResolvePullRequest]: (input) =>
          observeRpcEffect(
            WS_METHODS.gitResolvePullRequest,
            gitWorkflow.resolvePullRequest(input),
            {
              "rpc.aggregate": "git",
            },
          ),
        [WS_METHODS.gitPreparePullRequestThread]: (input) =>
          observeRpcEffect(
            WS_METHODS.gitPreparePullRequestThread,
            gitWorkflow
              .preparePullRequestThread(input)
              .pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
            { "rpc.aggregate": "git" },
          ),
        [WS_METHODS.vcsListRefs]: (input) =>
          observeRpcEffect(WS_METHODS.vcsListRefs, gitWorkflow.listRefs(input), {
            "rpc.aggregate": "vcs",
          }),
        [WS_METHODS.vcsCreateWorktree]: (input) =>
          observeRpcEffect(
            WS_METHODS.vcsCreateWorktree,
            gitWorkflow.createWorktree(input).pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
            { "rpc.aggregate": "vcs" },
          ),
        [WS_METHODS.vcsRemoveWorktree]: (input) =>
          observeRpcEffect(
            WS_METHODS.vcsRemoveWorktree,
            gitWorkflow.removeWorktree(input).pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
            { "rpc.aggregate": "vcs" },
          ),
        [WS_METHODS.vcsCreateRef]: (input) =>
          observeRpcEffect(
            WS_METHODS.vcsCreateRef,
            gitWorkflow.createRef(input).pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
            { "rpc.aggregate": "vcs" },
          ),
        [WS_METHODS.vcsSwitchRef]: (input) =>
          observeRpcEffect(
            WS_METHODS.vcsSwitchRef,
            gitWorkflow.switchRef(input).pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
            { "rpc.aggregate": "vcs" },
          ),
        [WS_METHODS.vcsInit]: (input) =>
          observeRpcEffect(
            WS_METHODS.vcsInit,
            vcsProvisioning
              .initRepository(input)
              .pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
            { "rpc.aggregate": "vcs" },
          ),
        [WS_METHODS.terminalOpen]: (input) =>
          observeRpcEffect(WS_METHODS.terminalOpen, terminalManager.open(input), {
            "rpc.aggregate": "terminal",
          }),
        [WS_METHODS.terminalWrite]: (input) =>
          observeRpcEffect(WS_METHODS.terminalWrite, terminalManager.write(input), {
            "rpc.aggregate": "terminal",
          }),
        [WS_METHODS.terminalResize]: (input) =>
          observeRpcEffect(WS_METHODS.terminalResize, terminalManager.resize(input), {
            "rpc.aggregate": "terminal",
          }),
        [WS_METHODS.terminalClear]: (input) =>
          observeRpcEffect(WS_METHODS.terminalClear, terminalManager.clear(input), {
            "rpc.aggregate": "terminal",
          }),
        [WS_METHODS.terminalRestart]: (input) =>
          observeRpcEffect(WS_METHODS.terminalRestart, terminalManager.restart(input), {
            "rpc.aggregate": "terminal",
          }),
        [WS_METHODS.terminalClose]: (input) =>
          observeRpcEffect(WS_METHODS.terminalClose, terminalManager.close(input), {
            "rpc.aggregate": "terminal",
          }),
        [WS_METHODS.subscribeTerminalEvents]: (_input) =>
          observeRpcStream(
            WS_METHODS.subscribeTerminalEvents,
            Stream.callback<TerminalEvent>((queue) =>
              Effect.acquireRelease(
                terminalManager.subscribe((event) => Queue.offer(queue, event)),
                (unsubscribe) => Effect.sync(unsubscribe),
              ),
            ),
            { "rpc.aggregate": "terminal" },
          ),
        [WS_METHODS.subscribeServerConfig]: (_input) =>
          observeRpcStreamEffect(
            WS_METHODS.subscribeServerConfig,
            Effect.gen(function* () {
              const keybindingsUpdates = keybindings.streamChanges.pipe(
                Stream.map((event) => ({
                  version: 1 as const,
                  type: "keybindingsUpdated" as const,
                  payload: {
                    keybindings: event.keybindings,
                    issues: event.issues,
                  },
                })),
              );
              const providerStatuses = providerRegistry.streamChanges.pipe(
                Stream.map((providers) => ({
                  version: 1 as const,
                  type: "providerStatuses" as const,
                  payload: { providers },
                })),
                Stream.debounce(Duration.millis(PROVIDER_STATUS_DEBOUNCE_MS)),
              );
              const settingsUpdates = serverSettings.streamChanges.pipe(
                Stream.map((settings) => redactServerSettingsForClient(settings)),
                Stream.map((settings) => ({
                  version: 1 as const,
                  type: "settingsUpdated" as const,
                  payload: { settings },
                })),
              );

              yield* providerRegistry
                .refresh()
                .pipe(Effect.ignoreCause({ log: true }), Effect.forkScoped);

              const liveUpdates = Stream.merge(
                keybindingsUpdates,
                Stream.merge(providerStatuses, settingsUpdates),
              );

              return Stream.concat(
                Stream.make({
                  version: 1 as const,
                  type: "snapshot" as const,
                  config: yield* loadServerConfig,
                }),
                liveUpdates,
              );
            }),
            { "rpc.aggregate": "server" },
          ),
        [WS_METHODS.subscribeServerLifecycle]: (_input) =>
          observeRpcStreamEffect(
            WS_METHODS.subscribeServerLifecycle,
            Effect.gen(function* () {
              const snapshot = yield* lifecycleEvents.snapshot;
              const snapshotEvents = Array.from(snapshot.events).toSorted(
                (left, right) => left.sequence - right.sequence,
              );
              const liveEvents = lifecycleEvents.stream.pipe(
                Stream.filter((event) => event.sequence > snapshot.sequence),
              );
              return Stream.concat(Stream.fromIterable(snapshotEvents), liveEvents);
            }),
            { "rpc.aggregate": "server" },
          ),
        [WS_METHODS.subscribeAuthAccess]: (_input) =>
          observeRpcStreamEffect(
            WS_METHODS.subscribeAuthAccess,
            Effect.gen(function* () {
              const initialSnapshot = yield* loadAuthAccessSnapshot();
              const revisionRef = yield* Ref.make(1);
              const accessChanges: Stream.Stream<
                BootstrapCredentialChange | SessionCredentialChange
              > = Stream.merge(bootstrapCredentials.streamChanges, sessions.streamChanges);

              const liveEvents: Stream.Stream<AuthAccessStreamEvent> = accessChanges.pipe(
                Stream.mapEffect((change) =>
                  Ref.updateAndGet(revisionRef, (revision) => revision + 1).pipe(
                    Effect.map((revision) =>
                      toAuthAccessStreamEvent(change, revision, currentSessionId),
                    ),
                  ),
                ),
              );

              return Stream.concat(
                Stream.make({
                  version: 1 as const,
                  revision: 1,
                  type: "snapshot" as const,
                  payload: initialSnapshot,
                }),
                liveEvents,
              );
            }),
            { "rpc.aggregate": "auth" },
          ),
      });
    }),
  );

export const websocketRpcRouteLayer = Layer.unwrap(
  Effect.succeed(
    HttpRouter.add(
      "GET",
      "/ws",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const serverAuth = yield* ServerAuth;
        const sessions = yield* SessionCredentialService;
        const session = yield* serverAuth.authenticateWebSocketUpgrade(request);
        const rpcWebSocketHttpEffect = yield* RpcServer.toHttpEffectWebsocket(WsRpcGroup, {
          disableTracing: true,
        }).pipe(
          Effect.provide(
            makeWsRpcLayer(session.sessionId).pipe(
              Layer.provideMerge(RpcSerialization.layerJson),
              Layer.provide(ProviderMaintenanceRunner.layer),
              Layer.provide(
                SourceControlDiscoveryLayer.layer.pipe(
                  Layer.provide(
                    SourceControlProviderRegistry.layer.pipe(
                      Layer.provide(Layer.mergeAll(GitHubCli.layer, GitLabCli.layer)),
                      Layer.provideMerge(GitVcsDriver.layer),
                      Layer.provide(
                        VcsDriverRegistry.layer.pipe(Layer.provide(VcsProjectConfig.layer)),
                      ),
                    ),
                  ),
                  Layer.provide(VcsProcess.layer),
                ),
              ),
              Layer.provide(VcsProcess.layer),
            ),
          ),
        );
        return yield* Effect.acquireUseRelease(
          sessions.markConnected(session.sessionId),
          () => rpcWebSocketHttpEffect,
          () => sessions.markDisconnected(session.sessionId),
        );
      }).pipe(Effect.catchTag("AuthError", respondToAuthError)),
    ),
  ),
);
