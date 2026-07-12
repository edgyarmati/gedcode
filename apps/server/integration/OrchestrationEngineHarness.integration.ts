// @effect-diagnostics nodeBuiltinImport:off
import { execFileSync } from "node:child_process";

import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  ApprovalRequestId,
  CodexSettings,
  DEFAULT_SERVER_SETTINGS,
  GitCommandError,
  ProviderDriverKind,
  SourceControlProviderError,
  type ServerSettings,
  type OrchestrationEvent,
  type OrchestrationThread,
  type ProviderInstanceId,
} from "@t3tools/contracts";
import { applyServerSettingsPatch } from "@t3tools/shared/serverSettings";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/unstable/process";

import { CheckpointStoreLive } from "../src/checkpointing/Layers/CheckpointStore.ts";
import { CheckpointStore } from "../src/checkpointing/Services/CheckpointStore.ts";
import { TextGeneration, type TextGenerationShape } from "../src/textGeneration/TextGeneration.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../src/persistence/Layers/OrchestrationCommandReceipts.ts";
import { OrchestrationEventStoreLive } from "../src/persistence/Layers/OrchestrationEventStore.ts";
import { ProjectionCheckpointRepositoryLive } from "../src/persistence/Layers/ProjectionCheckpoints.ts";
import { ProjectionPendingApprovalRepositoryLive } from "../src/persistence/Layers/ProjectionPendingApprovals.ts";
import { ProviderSessionRuntimeRepositoryLive } from "../src/persistence/Layers/ProviderSessionRuntime.ts";
import { makeSqlitePersistenceLive } from "../src/persistence/Layers/Sqlite.ts";
import { ProjectionCheckpointRepository } from "../src/persistence/Services/ProjectionCheckpoints.ts";
import { ProjectionPendingApprovalRepository } from "../src/persistence/Services/ProjectionPendingApprovals.ts";
import { makeAdapterRegistryMock } from "../src/provider/testUtils/providerAdapterRegistryMock.ts";
import { ProviderAdapterRegistry } from "../src/provider/Services/ProviderAdapterRegistry.ts";
import { ProviderSessionDirectoryLive } from "../src/provider/Layers/ProviderSessionDirectory.ts";
import { ServerSettingsService, type ServerSettingsShape } from "../src/serverSettings.ts";
import { makeProviderServiceLive } from "../src/provider/Layers/ProviderService.ts";
import { makeCodexAdapter } from "../src/provider/Layers/CodexAdapter.ts";
import {
  NoOpProviderEventLoggers,
  ProviderEventLoggers,
} from "../src/provider/Layers/ProviderEventLoggers.ts";
import { ProviderService } from "../src/provider/Services/ProviderService.ts";
import { CheckpointReactorLive } from "../src/orchestration/Layers/CheckpointReactor.ts";
import { CheckpointReactor } from "../src/orchestration/Services/CheckpointReactor.ts";
import { RepositoryIdentityResolverLive } from "../src/project/Layers/RepositoryIdentityResolver.ts";
import { OrchestrationEngineLive } from "../src/orchestration/Layers/OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "../src/orchestration/Layers/ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "../src/orchestration/Layers/ProjectionSnapshotQuery.ts";
import { RuntimeReceiptBusTest } from "../src/orchestration/Layers/RuntimeReceiptBus.ts";
import { OrchestrationReactorLive } from "../src/orchestration/Layers/OrchestrationReactor.ts";
import { ProviderCommandReactorLive } from "../src/orchestration/Layers/ProviderCommandReactor.ts";
import { ProviderRuntimeIngestionLive } from "../src/orchestration/Layers/ProviderRuntimeIngestion.ts";
import { ProviderCommandReactor } from "../src/orchestration/Services/ProviderCommandReactor.ts";
import { ProviderRuntimeIngestionService } from "../src/orchestration/Services/ProviderRuntimeIngestion.ts";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../src/orchestration/Services/OrchestrationEngine.ts";
import { ThreadDeletionReactor } from "../src/orchestration/Services/ThreadDeletionReactor.ts";
import { TaskWorktreeReactor } from "../src/orchestration/Services/TaskWorktreeReactor.ts";
import { OrchestrationReactor } from "../src/orchestration/Services/OrchestrationReactor.ts";
import { OrphanTurnReconciler } from "../src/orchestration/Services/OrphanTurnReconciler.ts";
import { makeOrphanTurnReconcilerLive } from "../src/orchestration/Layers/OrphanTurnReconciler.ts";
import { TaskCancellationReconciler } from "../src/orchestration/Services/TaskCancellationReconciler.ts";
import { makeTaskCancellationReconcilerLive } from "../src/orchestration/Layers/TaskCancellationReconciler.ts";
import { PmRuntime } from "../src/orchestration/Services/PmRuntime.ts";
import { WorkerStartAdmissionLive } from "../src/orchestration/Layers/WorkerStartAdmission.ts";
import { makeTaskWorktreeReactorLive } from "../src/orchestration/Layers/TaskWorktreeReactor.ts";
import { ProjectionSnapshotQuery } from "../src/orchestration/Services/ProjectionSnapshotQuery.ts";
import {
  RuntimeReceiptBus,
  type OrchestrationRuntimeReceipt,
} from "../src/orchestration/Services/RuntimeReceiptBus.ts";

import {
  makeTestProviderAdapterHarness,
  type TestProviderAdapterHarness,
} from "./TestProviderAdapter.integration.ts";
import { deriveServerPaths, ServerConfig } from "../src/config.ts";
import { WorkspaceEntriesLive } from "../src/workspace/Layers/WorkspaceEntries.ts";
import { WorkspacePathsLive } from "../src/workspace/Layers/WorkspacePaths.ts";
import * as VcsDriverRegistry from "../src/vcs/VcsDriverRegistry.ts";
import { VcsStatusBroadcaster } from "../src/vcs/VcsStatusBroadcaster.ts";
import { GitWorkflowService } from "../src/git/GitWorkflowService.ts";
import type { GitWorkflowServiceShape } from "../src/git/GitWorkflowService.ts";
import * as VcsProcess from "../src/vcs/VcsProcess.ts";
import {
  SourceControlProviderRegistry,
  type SourceControlProviderRegistryShape,
} from "../src/sourceControl/SourceControlProviderRegistry.ts";
import * as SourceControlProvider from "../src/sourceControl/SourceControlProvider.ts";
import { TerminalManager } from "../src/terminal/Services/Manager.ts";

const decodeCodexSettings = Schema.decodeEffect(CodexSettings);

function runGit(cwd: string, args: ReadonlyArray<string>) {
  return execFileSync("git", args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });
}

function unsupportedSourceControlProvider(
  operation: string,
): Effect.Effect<never, SourceControlProviderError> {
  return Effect.fail(
    new SourceControlProviderError({
      provider: "unknown",
      operation,
      detail: "No integration source-control provider was configured.",
    }),
  );
}

function makeUnsupportedSourceControlRegistry(): SourceControlProviderRegistryShape {
  const provider = SourceControlProvider.SourceControlProvider.of({
    kind: "unknown",
    listChangeRequests: () => unsupportedSourceControlProvider("listChangeRequests"),
    getChangeRequest: () => unsupportedSourceControlProvider("getChangeRequest"),
    createChangeRequest: () => unsupportedSourceControlProvider("createChangeRequest"),
    getRepositoryCloneUrls: () => unsupportedSourceControlProvider("getRepositoryCloneUrls"),
    createRepository: () => unsupportedSourceControlProvider("createRepository"),
    getDefaultBranch: () => unsupportedSourceControlProvider("getDefaultBranch"),
    checkoutChangeRequest: () => unsupportedSourceControlProvider("checkoutChangeRequest"),
  });
  const resolveHandle: SourceControlProviderRegistryShape["resolveHandle"] = () =>
    Effect.succeed({
      provider,
      context: null,
    });

  return {
    get: () => Effect.succeed(provider),
    resolveHandle,
    resolve: (input) => resolveHandle(input).pipe(Effect.map((handle) => handle.provider)),
    discover: Effect.succeed([]),
  };
}

const initializeGitWorkspace = Effect.fn(function* (cwd: string) {
  runGit(cwd, ["init", "--initial-branch=main"]);
  runGit(cwd, ["config", "user.email", "test@example.com"]);
  runGit(cwd, ["config", "user.name", "Test User"]);
  const fileSystem = yield* FileSystem.FileSystem;
  const { join } = yield* Path.Path;
  yield* fileSystem.writeFileString(join(cwd, "README.md"), "v1\n");
  runGit(cwd, ["add", "."]);
  runGit(cwd, ["commit", "-m", "Initial"]);
});

export function gitRefExists(cwd: string, ref: string): boolean {
  try {
    runGit(cwd, ["show-ref", "--verify", "--quiet", ref]);
    return true;
  } catch {
    return false;
  }
}

export function gitShowFileAtRef(cwd: string, ref: string, filePath: string): string {
  return runGit(cwd, ["show", `${ref}:${filePath}`]);
}

class WaitForTimeoutError extends Schema.TaggedErrorClass<WaitForTimeoutError>()(
  "WaitForTimeoutError",
  {
    description: Schema.String,
  },
) {}

function waitFor<A, E>(
  read: Effect.Effect<A, E>,
  predicate: (value: A) => boolean,
  description: string,
  timeoutMs?: number,
): Effect.Effect<A, never>;
function waitFor<A, B extends A, E>(
  read: Effect.Effect<A, E>,
  predicate: (value: A) => value is B,
  description: string,
  timeoutMs?: number,
): Effect.Effect<B, never>;
function waitFor<A, E>(
  read: Effect.Effect<A, E>,
  predicate: (value: A) => boolean,
  description: string,
  timeoutMs = 75_000,
): Effect.Effect<A, never> {
  const RETRY_SIGNAL = "wait_for_retry";
  const retryIntervalMs = 10;
  const maxRetries = Math.max(0, Math.floor(timeoutMs / retryIntervalMs));
  const retrySchedule = Schedule.spaced(`${retryIntervalMs} millis`);

  return read.pipe(
    Effect.filterOrFail(predicate, () => RETRY_SIGNAL),
    Effect.retry({
      schedule: retrySchedule,
      times: maxRetries,
      while: (error) => error === RETRY_SIGNAL,
    }),
    Effect.mapError((error) =>
      error === RETRY_SIGNAL ? new WaitForTimeoutError({ description }) : error,
    ),
    Effect.orDie,
  );
}

class OrchestrationHarnessRuntimeError extends Schema.TaggedErrorClass<OrchestrationHarnessRuntimeError>()(
  "OrchestrationHarnessRuntimeError",
  {
    operation: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}

const tryRuntimePromise = <A>(operation: string, run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => new OrchestrationHarnessRuntimeError({ operation, cause }),
  });

export interface OrchestrationIntegrationHarness {
  readonly rootDir: string;
  readonly workspaceDir: string;
  readonly dbPath: string;
  readonly adapterHarness: TestProviderAdapterHarness | null;
  readonly serverSettings: ServerSettingsShape;
  readonly unsafeUpdateServerSettingsForTest: (
    update: (settings: ServerSettings) => ServerSettings,
  ) => Effect.Effect<void, never>;
  readonly engine: OrchestrationEngineShape;
  readonly snapshotQuery: ProjectionSnapshotQuery["Service"];
  readonly providerService: ProviderService["Service"];
  readonly checkpointStore: CheckpointStore["Service"];
  readonly checkpointRepository: ProjectionCheckpointRepository["Service"];
  readonly pendingApprovalRepository: ProjectionPendingApprovalRepository["Service"];
  readonly landingMocks: OrchestrationLandingHarnessMocks | null;
  readonly waitForThread: (
    threadId: string,
    predicate: (thread: OrchestrationThread) => boolean,
    timeoutMs?: number,
  ) => Effect.Effect<OrchestrationThread, never>;
  readonly waitForDomainEvent: (
    predicate: (event: OrchestrationEvent) => boolean,
    timeoutMs?: number,
  ) => Effect.Effect<ReadonlyArray<OrchestrationEvent>, never>;
  readonly waitForPendingApproval: (
    requestId: string,
    predicate: (row: {
      readonly status: "pending" | "resolved";
      readonly decision: "accept" | "acceptForSession" | "decline" | "cancel" | null;
      readonly resolvedAt: string | null;
    }) => boolean,
    timeoutMs?: number,
  ) => Effect.Effect<
    {
      readonly status: "pending" | "resolved";
      readonly decision: "accept" | "acceptForSession" | "decline" | "cancel" | null;
      readonly resolvedAt: string | null;
    },
    never
  >;
  readonly waitForReceipt: {
    (
      predicate: (receipt: OrchestrationRuntimeReceipt) => boolean,
      timeoutMs?: number,
    ): Effect.Effect<OrchestrationRuntimeReceipt, never>;
    <Receipt extends OrchestrationRuntimeReceipt>(
      predicate: (receipt: OrchestrationRuntimeReceipt) => receipt is Receipt,
      timeoutMs?: number,
    ): Effect.Effect<Receipt, never>;
  };
  readonly startTaskWorktreeReactor: Effect.Effect<void, never>;
  readonly drainReactors: Effect.Effect<void, never>;
  readonly dispose: Effect.Effect<void, never>;
}

export interface OrchestrationLandingHarnessMocks {
  readonly pushCurrentBranchCalls: Array<
    Parameters<GitWorkflowServiceShape["pushCurrentBranch"]>[0]
  >;
  readonly readRangeContextCalls: Array<Parameters<GitWorkflowServiceShape["readRangeContext"]>[0]>;
  readonly removeWorktreeCalls: Array<Parameters<GitWorkflowServiceShape["removeWorktree"]>[0]>;
  readonly vcsProcessRunCalls: Array<VcsProcess.VcsProcessInput>;
}

interface MakeOrchestrationIntegrationHarnessOptions {
  readonly provider?: ProviderDriverKind;
  readonly realCodex?: boolean;
  readonly rootDir?: string;
  readonly workspaceDir?: string;
  readonly additionalProviderInstances?: ReadonlyArray<ProviderInstanceId>;
  readonly startReactors?: boolean;
  readonly orphanTurnReconciler?: {
    readonly enabled: boolean;
  };
  readonly taskCancellationReconciler?: {
    readonly enabled: boolean;
  };
  readonly taskWorktreeReactor?: {
    readonly enabled: boolean;
    readonly reaperIntervalMsOverride?: number;
    readonly orphanGracePeriodMsOverride?: number;
    readonly leaseDurationMsOverride?: number;
    readonly sourceControlProviderRegistry?: SourceControlProviderRegistryShape;
    readonly pushCurrentBranch?: GitWorkflowServiceShape["pushCurrentBranch"];
    readonly readRangeContext?: GitWorkflowServiceShape["readRangeContext"];
    readonly removeWorktree?: GitWorkflowServiceShape["removeWorktree"];
  };
}

export const makeOrchestrationIntegrationHarness = (
  options?: MakeOrchestrationIntegrationHarnessOptions,
) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const fileSystem = yield* FileSystem.FileSystem;

    const provider = options?.provider ?? ProviderDriverKind.make("codex");
    const useRealCodex = options?.realCodex === true;
    const adapterHarness = useRealCodex
      ? null
      : yield* makeTestProviderAdapterHarness({
          provider,
        });
    const fakeRegistry = adapterHarness
      ? Layer.succeed(
          ProviderAdapterRegistry,
          makeAdapterRegistryMock(
            { [adapterHarness.provider]: adapterHarness.adapter },
            {
              additionalInstances: (options?.additionalProviderInstances ?? []).map(
                (instanceId) => ({
                  instanceId,
                  driverKind: adapterHarness.provider,
                }),
              ),
            },
          ),
        )
      : null;
    const rootDir =
      options?.rootDir ??
      (yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-orchestration-integration-",
      }));
    const workspaceDir = options?.workspaceDir ?? path.join(rootDir, "workspace");
    const { stateDir, dbPath } = yield* deriveServerPaths(rootDir, undefined).pipe(
      Effect.provideService(Path.Path, path),
    );
    yield* fileSystem.makeDirectory(rootDir, { recursive: true });
    yield* fileSystem.makeDirectory(workspaceDir, { recursive: true });
    yield* fileSystem.makeDirectory(stateDir, { recursive: true });
    const workspaceGitDirExists = yield* fileSystem
      .exists(path.join(workspaceDir, ".git"))
      .pipe(Effect.orElseSucceed(() => false));
    if (!workspaceGitDirExists) {
      yield* initializeGitWorkspace(workspaceDir);
    }

    const serverSettingsRef = yield* Ref.make<ServerSettings>(DEFAULT_SERVER_SETTINGS);
    const serverSettings: ServerSettingsShape = {
      start: Effect.void,
      ready: Effect.void,
      getSettings: Ref.get(serverSettingsRef),
      updateSettings: (patch) =>
        Ref.get(serverSettingsRef).pipe(
          Effect.map((current) => applyServerSettingsPatch(current, patch)),
          Effect.tap((nextSettings) => Ref.set(serverSettingsRef, nextSettings)),
        ),
      streamChanges: Stream.empty,
    };
    const serverSettingsLayer = Layer.succeed(ServerSettingsService, serverSettings);

    const persistenceLayer = makeSqlitePersistenceLive(dbPath);
    const orchestrationLayer = OrchestrationEngineLive.pipe(
      Layer.provide(OrchestrationProjectionPipelineLive),
      Layer.provide(OrchestrationEventStoreLive),
      Layer.provide(OrchestrationCommandReceiptRepositoryLive),
    );
    const providerSessionDirectoryLayer = ProviderSessionDirectoryLive.pipe(
      Layer.provide(ProviderSessionRuntimeRepositoryLive),
    );
    const realCodexRegistry = Layer.effect(
      ProviderAdapterRegistry,
      Effect.gen(function* () {
        const codexSettings = yield* decodeCodexSettings({});
        const codexAdapter = yield* makeCodexAdapter(codexSettings);
        return makeAdapterRegistryMock({
          [ProviderDriverKind.make("codex")]: codexAdapter,
        });
      }),
    ).pipe(
      Layer.provideMerge(ServerConfig.layerTest(workspaceDir, rootDir)),
      Layer.provideMerge(NodeServices.layer),
      Layer.provideMerge(providerSessionDirectoryLayer),
    );
    const providerEventLoggersLayer = Layer.succeed(ProviderEventLoggers, NoOpProviderEventLoggers);
    const providerLayer = useRealCodex
      ? makeProviderServiceLive().pipe(
          Layer.provide(providerSessionDirectoryLayer),
          Layer.provide(realCodexRegistry),
          Layer.provide(providerEventLoggersLayer),
        )
      : makeProviderServiceLive().pipe(
          Layer.provide(providerSessionDirectoryLayer),
          Layer.provide(fakeRegistry!),
          Layer.provide(providerEventLoggersLayer),
        );

    const checkpointStoreLayer = CheckpointStoreLive.pipe(Layer.provide(VcsDriverRegistry.layer));
    const projectionSnapshotQueryLayer = OrchestrationProjectionSnapshotQueryLive;
    const runtimeServicesLayer = Layer.mergeAll(
      projectionSnapshotQueryLayer,
      orchestrationLayer.pipe(Layer.provide(projectionSnapshotQueryLayer)),
      ProjectionCheckpointRepositoryLive,
      ProjectionPendingApprovalRepositoryLive,
      checkpointStoreLayer,
      providerLayer,
      RuntimeReceiptBusTest,
    );
    const workerStartAdmissionLayer = WorkerStartAdmissionLive.pipe(
      Layer.provide(serverSettingsLayer),
    );
    const runtimeIngestionLayer = ProviderRuntimeIngestionLive.pipe(
      Layer.provideMerge(runtimeServicesLayer),
      Layer.provideMerge(serverSettingsLayer),
    );
    const textGenerationLayer = Layer.succeed(TextGeneration, {
      generateBranchName: () => Effect.succeed({ branch: "update" }),
      generateThreadTitle: () => Effect.succeed({ title: "New thread" }),
    } as unknown as TextGenerationShape);
    const landingMocks: OrchestrationLandingHarnessMocks | null =
      options?.taskWorktreeReactor?.enabled === true
        ? {
            pushCurrentBranchCalls: [],
            readRangeContextCalls: [],
            removeWorktreeCalls: [],
            vcsProcessRunCalls: [],
          }
        : null;
    const pushCurrentBranch: GitWorkflowServiceShape["pushCurrentBranch"] =
      options?.taskWorktreeReactor?.pushCurrentBranch ??
      ((input) => {
        landingMocks?.pushCurrentBranchCalls.push(input);
        return Effect.succeed({
          status: "pushed",
          branch: input.fallbackBranch ?? "HEAD",
          upstreamBranch:
            input.remoteName === null || input.remoteName === undefined
              ? undefined
              : `${input.remoteName}/${input.fallbackBranch ?? "HEAD"}`,
          setUpstream: true,
        });
      });
    const readRangeContext: GitWorkflowServiceShape["readRangeContext"] =
      options?.taskWorktreeReactor?.readRangeContext ??
      ((input) => {
        landingMocks?.readRangeContextCalls.push(input);
        return Effect.succeed({
          commitSummary: "- Implement landing integration fixture",
          diffSummary: " 1 file changed, 1 insertion(+)",
          diffPatch: "",
        });
      });
    const removeWorktree: GitWorkflowServiceShape["removeWorktree"] =
      options?.taskWorktreeReactor?.removeWorktree ??
      ((input) => {
        landingMocks?.removeWorktreeCalls.push(input);
        return Effect.try({
          try: () => {
            runGit(input.cwd, [
              "worktree",
              "remove",
              ...(input.force ? ["--force"] : []),
              input.path,
            ]);
          },
          catch: (cause) =>
            new GitCommandError({
              operation: "removeWorktree",
              command: "git worktree remove",
              cwd: input.cwd,
              detail: cause instanceof Error ? cause.message : String(cause),
            }),
        });
      });
    const gitWorkflowLayer = Layer.mock(GitWorkflowService)({
      renameBranch: (input: {
        readonly cwd: string;
        readonly oldBranch: string;
        readonly newBranch: string;
      }) => Effect.succeed({ branch: input.newBranch }),
      pushCurrentBranch,
      readRangeContext,
      removeWorktree,
    } satisfies Partial<GitWorkflowServiceShape>);
    const sourceControlProviderRegistryLayer = Layer.succeed(
      SourceControlProviderRegistry,
      options?.taskWorktreeReactor?.sourceControlProviderRegistry ??
        makeUnsupportedSourceControlRegistry(),
    );
    const vcsProcessLayer = Layer.succeed(VcsProcess.VcsProcess, {
      run: (input) => {
        landingMocks?.vcsProcessRunCalls.push(input);
        return Effect.succeed({
          exitCode: ChildProcessSpawner.ExitCode(0),
          stdout: "",
          stderr: "",
          stdoutTruncated: false,
          stderrTruncated: false,
        });
      },
    } satisfies VcsProcess.VcsProcessShape);
    const providerCommandReactorLayer = ProviderCommandReactorLive.pipe(
      Layer.provideMerge(runtimeServicesLayer),
      Layer.provideMerge(gitWorkflowLayer),
      Layer.provideMerge(textGenerationLayer),
      Layer.provideMerge(serverSettingsLayer),
      Layer.provideMerge(workerStartAdmissionLayer),
    );
    const checkpointReactorLayer = CheckpointReactorLive.pipe(
      Layer.provideMerge(runtimeServicesLayer),
      Layer.provideMerge(
        Layer.succeed(VcsStatusBroadcaster, {
          getStatus: () => Effect.die("getStatus should not be called in this test"),
          refreshLocalStatus: () =>
            Effect.succeed({
              isRepo: true,
              hasPrimaryRemote: false,
              isDefaultRef: true,
              refName: "main",
              hasWorkingTreeChanges: false,
              workingTree: { files: [], insertions: 0, deletions: 0 },
            }),
          refreshStatus: () => Effect.die("refreshStatus should not be called in this test"),
          streamStatus: () => Stream.empty,
        }),
      ),
      Layer.provideMerge(
        WorkspaceEntriesLive.pipe(
          Layer.provide(WorkspacePathsLive),
          Layer.provideMerge(VcsDriverRegistry.layer),
          Layer.provide(NodeServices.layer),
        ),
      ),
      Layer.provideMerge(WorkspacePathsLive),
      Layer.provideMerge(VcsProcess.layer),
    );
    const taskWorktreeReactorLayer =
      options?.taskWorktreeReactor?.enabled === true
        ? makeTaskWorktreeReactorLive({
            reaperIntervalMsOverride:
              options.taskWorktreeReactor.reaperIntervalMsOverride ?? 60_000,
            ...(options.taskWorktreeReactor.orphanGracePeriodMsOverride !== undefined
              ? {
                  orphanGracePeriodMsOverride:
                    options.taskWorktreeReactor.orphanGracePeriodMsOverride,
                }
              : {}),
            ...(options.taskWorktreeReactor.leaseDurationMsOverride !== undefined
              ? { leaseDurationMsOverride: options.taskWorktreeReactor.leaseDurationMsOverride }
              : {}),
            landingRetryDelayMsOverride: 1,
            landingMaxAttemptsOverride: 1,
          }).pipe(
            Layer.provideMerge(runtimeServicesLayer),
            Layer.provideMerge(gitWorkflowLayer),
            Layer.provideMerge(sourceControlProviderRegistryLayer),
            Layer.provideMerge(vcsProcessLayer),
            Layer.provideMerge(serverSettingsLayer),
            Layer.provideMerge(NodeServices.layer),
          )
        : Layer.succeed(TaskWorktreeReactor, {
            start: () => Effect.void,
            drain: Effect.void,
          });
    const taskCancellationReconcilerLayer =
      options?.taskCancellationReconciler?.enabled === true
        ? makeTaskCancellationReconcilerLive({
            maxAttempts: 1,
            retryDelayMs: 1,
          }).pipe(
            Layer.provideMerge(runtimeServicesLayer),
            Layer.provideMerge(
              Layer.mock(TerminalManager)({
                close: () => Effect.void,
              }),
            ),
          )
        : Layer.succeed(TaskCancellationReconciler, {
            reconcile: () => Effect.succeed(0),
          });
    const orphanTurnReconcilerLayer =
      options?.orphanTurnReconciler?.enabled === true
        ? makeOrphanTurnReconcilerLive({ maxAttempts: 1, retryDelayMs: 1 }).pipe(
            Layer.provideMerge(projectionSnapshotQueryLayer),
            Layer.provideMerge(
              orchestrationLayer.pipe(Layer.provide(projectionSnapshotQueryLayer)),
            ),
            Layer.provideMerge(providerLayer),
          )
        : Layer.succeed(OrphanTurnReconciler, {
            reconcile: () => Effect.succeed(0),
          });
    const orchestrationReactorLayer = OrchestrationReactorLive.pipe(
      Layer.provideMerge(taskCancellationReconcilerLayer),
      Layer.provideMerge(runtimeIngestionLayer),
      Layer.provideMerge(providerCommandReactorLayer),
      Layer.provideMerge(checkpointReactorLayer),
      Layer.provideMerge(orphanTurnReconcilerLayer),
      Layer.provideMerge(
        Layer.succeed(ThreadDeletionReactor, {
          start: () => Effect.void,
          drain: Effect.void,
        }),
      ),
      Layer.provideMerge(
        Layer.succeed(PmRuntime, {
          start: () => Effect.void,
          drain: Effect.void,
        }),
      ),
      Layer.provideMerge(taskWorktreeReactorLayer),
    );
    const layer = Layer.empty.pipe(
      Layer.provideMerge(runtimeServicesLayer),
      Layer.provideMerge(orchestrationReactorLayer),
      Layer.provide(persistenceLayer),
      Layer.provideMerge(RepositoryIdentityResolverLive),
      Layer.provideMerge(serverSettingsLayer),
      Layer.provideMerge(ServerConfig.layerTest(workspaceDir, rootDir)),
      Layer.provideMerge(NodeServices.layer),
    );

    const runtime = ManagedRuntime.make(layer);
    const engine = yield* tryRuntimePromise("load OrchestrationEngine service", () =>
      runtime.runPromise(Effect.service(OrchestrationEngineService)),
    ).pipe(Effect.orDie);
    const reactor = yield* tryRuntimePromise("load OrchestrationReactor service", () =>
      runtime.runPromise(Effect.service(OrchestrationReactor)),
    ).pipe(Effect.orDie);
    const taskWorktreeReactor = yield* tryRuntimePromise("load TaskWorktreeReactor service", () =>
      runtime.runPromise(Effect.service(TaskWorktreeReactor)),
    ).pipe(Effect.orDie);
    const providerCommandReactor = yield* tryRuntimePromise(
      "load ProviderCommandReactor service",
      () => runtime.runPromise(Effect.service(ProviderCommandReactor)),
    ).pipe(Effect.orDie);
    const providerRuntimeIngestion = yield* tryRuntimePromise(
      "load ProviderRuntimeIngestion service",
      () => runtime.runPromise(Effect.service(ProviderRuntimeIngestionService)),
    ).pipe(Effect.orDie);
    const checkpointReactor = yield* tryRuntimePromise("load CheckpointReactor service", () =>
      runtime.runPromise(Effect.service(CheckpointReactor)),
    ).pipe(Effect.orDie);
    const snapshotQuery = yield* tryRuntimePromise("load ProjectionSnapshotQuery service", () =>
      runtime.runPromise(Effect.service(ProjectionSnapshotQuery)),
    ).pipe(Effect.orDie);
    const providerService = yield* tryRuntimePromise("load ProviderService service", () =>
      runtime.runPromise(Effect.service(ProviderService)),
    ).pipe(Effect.orDie);
    const checkpointStore = yield* tryRuntimePromise("load CheckpointStore service", () =>
      runtime.runPromise(Effect.service(CheckpointStore)),
    ).pipe(Effect.orDie);
    const checkpointRepository = yield* tryRuntimePromise(
      "load ProjectionCheckpointRepository service",
      () => runtime.runPromise(Effect.service(ProjectionCheckpointRepository)),
    ).pipe(Effect.orDie);
    const pendingApprovalRepository = yield* tryRuntimePromise(
      "load ProjectionPendingApprovalRepository service",
      () => runtime.runPromise(Effect.service(ProjectionPendingApprovalRepository)),
    ).pipe(Effect.orDie);
    const runtimeReceiptBus = yield* tryRuntimePromise("load RuntimeReceiptBus service", () =>
      runtime.runPromise(Effect.service(RuntimeReceiptBus)),
    ).pipe(Effect.orDie);

    const scope = yield* Scope.make("sequential");
    if (options?.startReactors !== false) {
      yield* tryRuntimePromise("start OrchestrationReactor", () =>
        runtime.runPromise(reactor.start().pipe(Scope.provide(scope))),
      ).pipe(Effect.orDie);
    }
    const receiptHistory = yield* Ref.make<ReadonlyArray<OrchestrationRuntimeReceipt>>([]);
    yield* Stream.runForEach(runtimeReceiptBus.streamEventsForTest, (receipt) =>
      Ref.update(receiptHistory, (history) => [...history, receipt]).pipe(Effect.asVoid),
    ).pipe(Effect.forkIn(scope));
    if (options?.startReactors !== false) {
      yield* Effect.sleep(10);
    }

    const waitForThread: OrchestrationIntegrationHarness["waitForThread"] = (
      threadId,
      predicate,
      timeoutMs,
    ) =>
      waitFor(
        snapshotQuery
          .getSnapshot()
          .pipe(
            Effect.map(
              (snapshot) => snapshot.threads.find((thread) => thread.id === threadId) ?? null,
            ),
          ),
        (thread): thread is OrchestrationThread => thread !== null && predicate(thread),
        `projected thread '${threadId}'`,
        timeoutMs,
      ) as Effect.Effect<OrchestrationThread, never>;

    const waitForDomainEvent: OrchestrationIntegrationHarness["waitForDomainEvent"] = (
      predicate,
      timeoutMs,
    ) =>
      waitFor(
        Stream.runCollect(engine.readEvents(0)).pipe(
          Effect.map((chunk): ReadonlyArray<OrchestrationEvent> => Array.from(chunk)),
        ),
        (events) => events.some(predicate),
        "domain event",
        timeoutMs,
      );

    const waitForPendingApproval: OrchestrationIntegrationHarness["waitForPendingApproval"] = (
      requestId,
      predicate,
      timeoutMs,
    ) =>
      waitFor(
        pendingApprovalRepository
          .getByRequestId({ requestId: ApprovalRequestId.make(requestId) })
          .pipe(
            Effect.map((row) =>
              Option.match(row, {
                onNone: () => null,
                onSome: (value) => ({
                  status: value.status,
                  decision: value.decision,
                  resolvedAt: value.resolvedAt,
                }),
              }),
            ),
          ),
        (
          row,
        ): row is {
          readonly status: "pending" | "resolved";
          readonly decision: "accept" | "acceptForSession" | "decline" | "cancel" | null;
          readonly resolvedAt: string | null;
        } => row !== null && predicate(row),
        `pending approval '${requestId}'`,
        timeoutMs,
      ) as Effect.Effect<
        {
          readonly status: "pending" | "resolved";
          readonly decision: "accept" | "acceptForSession" | "decline" | "cancel" | null;
          readonly resolvedAt: string | null;
        },
        never
      >;

    function waitForReceipt(
      predicate: (receipt: OrchestrationRuntimeReceipt) => boolean,
      timeoutMs?: number,
    ): Effect.Effect<OrchestrationRuntimeReceipt, never>;
    function waitForReceipt<Receipt extends OrchestrationRuntimeReceipt>(
      predicate: (receipt: OrchestrationRuntimeReceipt) => receipt is Receipt,
      timeoutMs?: number,
    ): Effect.Effect<Receipt, never>;
    function waitForReceipt(
      predicate: (receipt: OrchestrationRuntimeReceipt) => boolean,
      timeoutMs?: number,
    ) {
      const readMatchingReceipt = Ref.get(receiptHistory).pipe(
        Effect.map((history) => history.find(predicate)),
      );

      return waitFor(
        readMatchingReceipt,
        (receipt): receipt is OrchestrationRuntimeReceipt => receipt !== undefined,
        "runtime receipt",
        timeoutMs,
      );
    }

    const drainReactors = Effect.gen(function* () {
      yield* Effect.sleep(25);
      yield* providerRuntimeIngestion.drain;
      yield* providerCommandReactor.drain;
      yield* Effect.sleep(25);
      yield* providerRuntimeIngestion.drain;
      yield* checkpointReactor.drain;
    });

    const startTaskWorktreeReactor = tryRuntimePromise("start TaskWorktreeReactor", () =>
      runtime.runPromise(taskWorktreeReactor.start().pipe(Scope.provide(scope))),
    ).pipe(Effect.orDie);

    let disposed = false;
    const dispose = Effect.gen(function* () {
      if (disposed) {
        return;
      }
      disposed = true;

      const shutdown = Effect.gen(function* () {
        const closeScopeExit = yield* Effect.exit(Scope.close(scope, Exit.void));
        const disposeRuntimeExit = yield* Effect.exit(Effect.promise(() => runtime.dispose()));

        const failureCause = Exit.isFailure(closeScopeExit)
          ? closeScopeExit.cause
          : Exit.isFailure(disposeRuntimeExit)
            ? disposeRuntimeExit.cause
            : null;

        if (failureCause) {
          return yield* Effect.failCause(failureCause);
        }
      });

      yield* shutdown;
    });

    return {
      rootDir,
      workspaceDir,
      dbPath,
      adapterHarness,
      serverSettings,
      unsafeUpdateServerSettingsForTest: (update) =>
        Ref.update(serverSettingsRef, update).pipe(Effect.orDie),
      engine,
      snapshotQuery,
      providerService,
      checkpointStore,
      checkpointRepository,
      pendingApprovalRepository,
      landingMocks,
      waitForThread,
      waitForDomainEvent,
      waitForPendingApproval,
      waitForReceipt,
      startTaskWorktreeReactor,
      drainReactors,
      dispose,
    } satisfies OrchestrationIntegrationHarness;
  });
