import {
  type GitActionProgressEvent,
  type GitRunStackedActionInput,
  type GitRunStackedActionResult,
  type VcsStatusResult,
  type VcsStatusStreamEvent,
  type LocalApi,
  ORCHESTRATOR_WS_METHODS,
  ORCHESTRATION_WS_METHODS,
  type ServerSettingsPatch,
  WS_METHODS,
} from "@t3tools/contracts";
import { applyGitStatusStreamEvent } from "@t3tools/shared/git";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import { type WsRpcProtocolClient } from "./protocol";
import { resetWsReconnectBackoff } from "./wsConnectionState";
import { WsTransport } from "./wsTransport";

type RpcTag = keyof WsRpcProtocolClient & string;
type RpcMethod<TTag extends RpcTag> = WsRpcProtocolClient[TTag];
type RpcInput<TTag extends RpcTag> = Parameters<RpcMethod<TTag>>[0];

interface StreamSubscriptionOptions {
  readonly onResubscribe?: () => void;
}

type RpcUnaryMethod<TTag extends RpcTag> =
  RpcMethod<TTag> extends (input: any, options?: any) => Effect.Effect<infer TSuccess, any, any>
    ? (input: RpcInput<TTag>) => Promise<TSuccess>
    : never;

type RpcUnaryNoArgMethod<TTag extends RpcTag> =
  RpcMethod<TTag> extends (input: any, options?: any) => Effect.Effect<infer TSuccess, any, any>
    ? () => Promise<TSuccess>
    : never;

type RpcStreamMethod<TTag extends RpcTag> =
  RpcMethod<TTag> extends (input: any, options?: any) => Stream.Stream<infer TEvent, any, any>
    ? (listener: (event: TEvent) => void, options?: StreamSubscriptionOptions) => () => void
    : never;

type RpcInputStreamMethod<TTag extends RpcTag> =
  RpcMethod<TTag> extends (input: any, options?: any) => Stream.Stream<infer TEvent, any, any>
    ? (
        input: RpcInput<TTag>,
        listener: (event: TEvent) => void,
        options?: StreamSubscriptionOptions,
      ) => () => void
    : never;

interface GitRunStackedActionOptions {
  readonly onProgress?: (event: GitActionProgressEvent) => void;
}

export interface WsRpcClient {
  readonly dispose: () => Promise<void>;
  readonly reconnect: () => Promise<void>;
  readonly isHeartbeatFresh: () => boolean;
  readonly terminal: {
    readonly open: RpcUnaryMethod<typeof WS_METHODS.terminalOpen>;
    readonly write: RpcUnaryMethod<typeof WS_METHODS.terminalWrite>;
    readonly resize: RpcUnaryMethod<typeof WS_METHODS.terminalResize>;
    readonly clear: RpcUnaryMethod<typeof WS_METHODS.terminalClear>;
    readonly restart: RpcUnaryMethod<typeof WS_METHODS.terminalRestart>;
    readonly close: RpcUnaryMethod<typeof WS_METHODS.terminalClose>;
    readonly onEvent: RpcStreamMethod<typeof WS_METHODS.subscribeTerminalEvents>;
  };
  readonly projects: {
    readonly searchEntries: RpcUnaryMethod<typeof WS_METHODS.projectsSearchEntries>;
    readonly writeFile: RpcUnaryMethod<typeof WS_METHODS.projectsWriteFile>;
  };
  readonly filesystem: {
    readonly browse: RpcUnaryMethod<typeof WS_METHODS.filesystemBrowse>;
  };
  readonly sourceControl: {
    readonly lookupRepository: RpcUnaryMethod<typeof WS_METHODS.sourceControlLookupRepository>;
    readonly cloneRepository: RpcUnaryMethod<typeof WS_METHODS.sourceControlCloneRepository>;
    readonly publishRepository: RpcUnaryMethod<typeof WS_METHODS.sourceControlPublishRepository>;
  };
  readonly shell: {
    readonly openInEditor: (input: {
      readonly cwd: Parameters<LocalApi["shell"]["openInEditor"]>[0];
      readonly editor: Parameters<LocalApi["shell"]["openInEditor"]>[1];
    }) => ReturnType<LocalApi["shell"]["openInEditor"]>;
  };
  readonly vcs: {
    readonly pull: RpcUnaryMethod<typeof WS_METHODS.vcsPull>;
    readonly refreshStatus: RpcUnaryMethod<typeof WS_METHODS.vcsRefreshStatus>;
    readonly onStatus: (
      input: RpcInput<typeof WS_METHODS.subscribeVcsStatus>,
      listener: (status: VcsStatusResult) => void,
      options?: StreamSubscriptionOptions,
    ) => () => void;
    readonly listRefs: RpcUnaryMethod<typeof WS_METHODS.vcsListRefs>;
    readonly createWorktree: RpcUnaryMethod<typeof WS_METHODS.vcsCreateWorktree>;
    readonly removeWorktree: RpcUnaryMethod<typeof WS_METHODS.vcsRemoveWorktree>;
    readonly createRef: RpcUnaryMethod<typeof WS_METHODS.vcsCreateRef>;
    readonly switchRef: RpcUnaryMethod<typeof WS_METHODS.vcsSwitchRef>;
    readonly init: RpcUnaryMethod<typeof WS_METHODS.vcsInit>;
  };
  /**
   * Git-specific workflows. Local repository mechanics live under `vcs`.
   */
  readonly git: {
    readonly runStackedAction: (
      input: GitRunStackedActionInput,
      options?: GitRunStackedActionOptions,
    ) => Promise<GitRunStackedActionResult>;
    readonly resolvePullRequest: RpcUnaryMethod<typeof WS_METHODS.gitResolvePullRequest>;
    readonly preparePullRequestThread: RpcUnaryMethod<
      typeof WS_METHODS.gitPreparePullRequestThread
    >;
  };
  readonly server: {
    readonly getConfig: RpcUnaryNoArgMethod<typeof WS_METHODS.serverGetConfig>;
    /**
     * Refresh provider snapshots. Pass `{ instanceId }` to refresh a single
     * configured instance; pass no argument (or `{}`) to refresh all.
     */
    readonly refreshProviders: (
      input?: RpcInput<typeof WS_METHODS.serverRefreshProviders>,
    ) => ReturnType<RpcUnaryMethod<typeof WS_METHODS.serverRefreshProviders>>;
    readonly updateProvider: RpcUnaryMethod<typeof WS_METHODS.serverUpdateProvider>;
    readonly upsertKeybinding: RpcUnaryMethod<typeof WS_METHODS.serverUpsertKeybinding>;
    readonly removeKeybinding: RpcUnaryMethod<typeof WS_METHODS.serverRemoveKeybinding>;
    readonly getSettings: RpcUnaryNoArgMethod<typeof WS_METHODS.serverGetSettings>;
    readonly updateSettings: (
      patch: ServerSettingsPatch,
    ) => ReturnType<RpcUnaryMethod<typeof WS_METHODS.serverUpdateSettings>>;
    readonly discoverSourceControl: RpcUnaryNoArgMethod<
      typeof WS_METHODS.serverDiscoverSourceControl
    >;
    readonly getTraceDiagnostics: RpcUnaryNoArgMethod<typeof WS_METHODS.serverGetTraceDiagnostics>;
    readonly getProcessDiagnostics: RpcUnaryNoArgMethod<
      typeof WS_METHODS.serverGetProcessDiagnostics
    >;
    readonly getProcessResourceHistory: RpcUnaryMethod<
      typeof WS_METHODS.serverGetProcessResourceHistory
    >;
    readonly signalProcess: RpcUnaryMethod<typeof WS_METHODS.serverSignalProcess>;
    readonly subscribeConfig: RpcStreamMethod<typeof WS_METHODS.subscribeServerConfig>;
    readonly subscribeLifecycle: RpcStreamMethod<typeof WS_METHODS.subscribeServerLifecycle>;
    readonly subscribeAuthAccess: RpcStreamMethod<typeof WS_METHODS.subscribeAuthAccess>;
  };
  readonly orchestration: {
    readonly dispatchCommand: RpcUnaryMethod<typeof ORCHESTRATION_WS_METHODS.dispatchCommand>;
    readonly forkThread: RpcUnaryMethod<typeof ORCHESTRATION_WS_METHODS.forkThread>;
    readonly getTurnDiff: RpcUnaryMethod<typeof ORCHESTRATION_WS_METHODS.getTurnDiff>;
    readonly getFullThreadDiff: RpcUnaryMethod<typeof ORCHESTRATION_WS_METHODS.getFullThreadDiff>;
    readonly getArchivedShellSnapshot: RpcUnaryNoArgMethod<
      typeof ORCHESTRATION_WS_METHODS.getArchivedShellSnapshot
    >;
    readonly subscribeShell: RpcStreamMethod<typeof ORCHESTRATION_WS_METHODS.subscribeShell>;
    readonly subscribeThread: RpcInputStreamMethod<typeof ORCHESTRATION_WS_METHODS.subscribeThread>;
  };
  readonly orchestrator: {
    readonly getPresetMigration: RpcUnaryNoArgMethod<
      typeof ORCHESTRATOR_WS_METHODS.getPresetMigration
    >;
    readonly completePresetMigration: RpcUnaryMethod<
      typeof ORCHESTRATOR_WS_METHODS.completePresetMigration
    >;
    readonly sendMessage: RpcUnaryMethod<typeof ORCHESTRATOR_WS_METHODS.sendMessage>;
    readonly subscribeProject: RpcInputStreamMethod<
      typeof ORCHESTRATOR_WS_METHODS.subscribeProject
    >;
    readonly subscribeTask: RpcInputStreamMethod<typeof ORCHESTRATOR_WS_METHODS.subscribeTask>;
    readonly resolveGate: RpcUnaryMethod<typeof ORCHESTRATOR_WS_METHODS.resolveGate>;
    readonly setTaskCapabilityTiers: RpcUnaryMethod<
      typeof ORCHESTRATOR_WS_METHODS.setTaskCapabilityTiers
    >;
    readonly landTask: RpcUnaryMethod<typeof ORCHESTRATOR_WS_METHODS.landTask>;
    readonly cancelTask: RpcUnaryMethod<typeof ORCHESTRATOR_WS_METHODS.cancelTask>;
    readonly interruptStage: RpcUnaryMethod<typeof ORCHESTRATOR_WS_METHODS.interruptStage>;
    readonly inspectTaskChanges: RpcUnaryMethod<typeof ORCHESTRATOR_WS_METHODS.inspectTaskChanges>;
    readonly commitTaskChanges: RpcUnaryMethod<typeof ORCHESTRATOR_WS_METHODS.commitTaskChanges>;
    readonly discardTaskChanges: RpcUnaryMethod<typeof ORCHESTRATOR_WS_METHODS.discardTaskChanges>;
    readonly returnTaskChanges: RpcUnaryMethod<typeof ORCHESTRATOR_WS_METHODS.returnTaskChanges>;
    readonly completeTaskWithoutChanges: RpcUnaryMethod<
      typeof ORCHESTRATOR_WS_METHODS.completeTaskWithoutChanges
    >;
    readonly listArchivedTasks: RpcUnaryMethod<typeof ORCHESTRATOR_WS_METHODS.listArchivedTasks>;
    readonly archiveTask: RpcUnaryMethod<typeof ORCHESTRATOR_WS_METHODS.archiveTask>;
    readonly restoreTask: RpcUnaryMethod<typeof ORCHESTRATOR_WS_METHODS.restoreTask>;
    readonly deleteTask: RpcUnaryMethod<typeof ORCHESTRATOR_WS_METHODS.deleteTask>;
    readonly clearPmChat: RpcUnaryMethod<typeof ORCHESTRATOR_WS_METHODS.clearPmChat>;
    readonly requestPmHandoff: RpcUnaryMethod<typeof ORCHESTRATOR_WS_METHODS.requestPmHandoff>;
    readonly getProjectContextOnboarding: RpcUnaryMethod<
      typeof ORCHESTRATOR_WS_METHODS.getProjectContextOnboarding
    >;
    readonly dismissProjectContextOnboarding: RpcUnaryMethod<
      typeof ORCHESTRATOR_WS_METHODS.dismissProjectContextOnboarding
    >;
    readonly requestProjectContextRun: RpcUnaryMethod<
      typeof ORCHESTRATOR_WS_METHODS.requestProjectContextRun
    >;
    readonly getProjectContextRunReview: RpcUnaryMethod<
      typeof ORCHESTRATOR_WS_METHODS.getProjectContextRunReview
    >;
    readonly reviseProjectContextRun: RpcUnaryMethod<
      typeof ORCHESTRATOR_WS_METHODS.reviseProjectContextRun
    >;
    readonly commitProjectContextRun: RpcUnaryMethod<
      typeof ORCHESTRATOR_WS_METHODS.commitProjectContextRun
    >;
    readonly discardProjectContextRun: RpcUnaryMethod<
      typeof ORCHESTRATOR_WS_METHODS.discardProjectContextRun
    >;
  };
}

export function createWsRpcClient(transport: WsTransport): WsRpcClient {
  return {
    dispose: () => transport.dispose(),
    reconnect: async () => {
      resetWsReconnectBackoff();
      await transport.reconnect();
    },
    isHeartbeatFresh: () => transport.isHeartbeatFresh(),
    terminal: {
      open: (input) => transport.request((client) => client[WS_METHODS.terminalOpen](input)),
      write: (input) => transport.request((client) => client[WS_METHODS.terminalWrite](input)),
      resize: (input) => transport.request((client) => client[WS_METHODS.terminalResize](input)),
      clear: (input) => transport.request((client) => client[WS_METHODS.terminalClear](input)),
      restart: (input) => transport.request((client) => client[WS_METHODS.terminalRestart](input)),
      close: (input) => transport.request((client) => client[WS_METHODS.terminalClose](input)),
      onEvent: (listener, options) =>
        transport.subscribe((client) => client[WS_METHODS.subscribeTerminalEvents]({}), listener, {
          ...options,
          tag: WS_METHODS.subscribeTerminalEvents,
        }),
    },
    projects: {
      searchEntries: (input) =>
        transport.request((client) => client[WS_METHODS.projectsSearchEntries](input)),
      writeFile: (input) =>
        transport.request((client) => client[WS_METHODS.projectsWriteFile](input)),
    },
    filesystem: {
      browse: (input) => transport.request((client) => client[WS_METHODS.filesystemBrowse](input)),
    },
    sourceControl: {
      lookupRepository: (input) =>
        transport.request((client) => client[WS_METHODS.sourceControlLookupRepository](input)),
      cloneRepository: (input) =>
        transport.request((client) => client[WS_METHODS.sourceControlCloneRepository](input)),
      publishRepository: (input) =>
        transport.request((client) => client[WS_METHODS.sourceControlPublishRepository](input)),
    },
    shell: {
      openInEditor: (input) =>
        transport.request((client) => client[WS_METHODS.shellOpenInEditor](input)),
    },
    vcs: {
      pull: (input) => transport.request((client) => client[WS_METHODS.vcsPull](input)),
      refreshStatus: (input) =>
        transport.request((client) => client[WS_METHODS.vcsRefreshStatus](input)),
      onStatus: (input, listener, options) => {
        let current: VcsStatusResult | null = null;
        return transport.subscribe(
          (client) => client[WS_METHODS.subscribeVcsStatus](input),
          (event: VcsStatusStreamEvent) => {
            current = applyGitStatusStreamEvent(current, event);
            listener(current);
          },
          { ...options, tag: WS_METHODS.subscribeVcsStatus },
        );
      },
      listRefs: (input) => transport.request((client) => client[WS_METHODS.vcsListRefs](input)),
      createWorktree: (input) =>
        transport.request((client) => client[WS_METHODS.vcsCreateWorktree](input)),
      removeWorktree: (input) =>
        transport.request((client) => client[WS_METHODS.vcsRemoveWorktree](input)),
      createRef: (input) => transport.request((client) => client[WS_METHODS.vcsCreateRef](input)),
      switchRef: (input) => transport.request((client) => client[WS_METHODS.vcsSwitchRef](input)),
      init: (input) => transport.request((client) => client[WS_METHODS.vcsInit](input)),
    },
    git: {
      runStackedAction: async (input, options) => {
        let result: GitRunStackedActionResult | null = null;

        await transport.requestStream(
          (client) => client[WS_METHODS.gitRunStackedAction](input),
          (event) => {
            options?.onProgress?.(event);
            if (event.kind === "action_finished") {
              result = event.result;
            }
          },
        );

        if (result) {
          return result;
        }

        throw new Error("Git action stream completed without a final result.");
      },
      resolvePullRequest: (input) =>
        transport.request((client) => client[WS_METHODS.gitResolvePullRequest](input)),
      preparePullRequestThread: (input) =>
        transport.request((client) => client[WS_METHODS.gitPreparePullRequestThread](input)),
    },
    server: {
      getConfig: () => transport.request((client) => client[WS_METHODS.serverGetConfig]({})),
      refreshProviders: (input) =>
        transport.request((client) => client[WS_METHODS.serverRefreshProviders](input ?? {})),
      updateProvider: (input) =>
        transport.request((client) => client[WS_METHODS.serverUpdateProvider](input)),
      upsertKeybinding: (input) =>
        transport.request((client) => client[WS_METHODS.serverUpsertKeybinding](input)),
      removeKeybinding: (input) =>
        transport.request((client) => client[WS_METHODS.serverRemoveKeybinding](input)),
      getSettings: () => transport.request((client) => client[WS_METHODS.serverGetSettings]({})),
      updateSettings: (patch) =>
        transport.request((client) => client[WS_METHODS.serverUpdateSettings]({ patch })),
      discoverSourceControl: () =>
        transport.request((client) => client[WS_METHODS.serverDiscoverSourceControl]({})),
      getTraceDiagnostics: () =>
        transport.request((client) =>
          client[WS_METHODS.serverGetTraceDiagnostics]({}).pipe(Effect.withTracerEnabled(false)),
        ),
      getProcessDiagnostics: () =>
        transport.request((client) =>
          client[WS_METHODS.serverGetProcessDiagnostics]({}).pipe(Effect.withTracerEnabled(false)),
        ),
      getProcessResourceHistory: (input) =>
        transport.request((client) =>
          client[WS_METHODS.serverGetProcessResourceHistory](input).pipe(
            Effect.withTracerEnabled(false),
          ),
        ),
      signalProcess: (input) =>
        transport.request((client) =>
          client[WS_METHODS.serverSignalProcess](input).pipe(Effect.withTracerEnabled(false)),
        ),
      subscribeConfig: (listener, options) =>
        transport.subscribe((client) => client[WS_METHODS.subscribeServerConfig]({}), listener, {
          ...options,
          tag: WS_METHODS.subscribeServerConfig,
        }),
      subscribeLifecycle: (listener, options) =>
        transport.subscribe((client) => client[WS_METHODS.subscribeServerLifecycle]({}), listener, {
          ...options,
          tag: WS_METHODS.subscribeServerLifecycle,
        }),
      subscribeAuthAccess: (listener, options) =>
        transport.subscribe((client) => client[WS_METHODS.subscribeAuthAccess]({}), listener, {
          ...options,
          tag: WS_METHODS.subscribeAuthAccess,
        }),
    },
    orchestration: {
      dispatchCommand: (input) =>
        transport.request((client) => client[ORCHESTRATION_WS_METHODS.dispatchCommand](input)),
      forkThread: (input) =>
        transport.request((client) => client[ORCHESTRATION_WS_METHODS.forkThread](input)),
      getTurnDiff: (input) =>
        transport.request((client) => client[ORCHESTRATION_WS_METHODS.getTurnDiff](input)),
      getFullThreadDiff: (input) =>
        transport.request((client) => client[ORCHESTRATION_WS_METHODS.getFullThreadDiff](input)),
      getArchivedShellSnapshot: () =>
        transport.request((client) =>
          client[ORCHESTRATION_WS_METHODS.getArchivedShellSnapshot]({}),
        ),
      subscribeShell: (listener, options) =>
        transport.subscribe(
          (client) => client[ORCHESTRATION_WS_METHODS.subscribeShell]({}),
          listener,
          { ...options, tag: ORCHESTRATION_WS_METHODS.subscribeShell },
        ),
      subscribeThread: (input, listener, options) =>
        transport.subscribe(
          (client) => client[ORCHESTRATION_WS_METHODS.subscribeThread](input),
          listener,
          { ...options, tag: ORCHESTRATION_WS_METHODS.subscribeThread },
        ),
    },
    orchestrator: {
      getPresetMigration: () =>
        transport.request((client) => client[ORCHESTRATOR_WS_METHODS.getPresetMigration]({})),
      completePresetMigration: (input) =>
        transport.request((client) =>
          client[ORCHESTRATOR_WS_METHODS.completePresetMigration](input),
        ),
      sendMessage: (input) =>
        transport.request((client) => client[ORCHESTRATOR_WS_METHODS.sendMessage](input)),
      subscribeProject: (input, listener, options) =>
        transport.subscribe(
          (client) => client[ORCHESTRATOR_WS_METHODS.subscribeProject](input),
          listener,
          { ...options, tag: ORCHESTRATOR_WS_METHODS.subscribeProject },
        ),
      subscribeTask: (input, listener, options) =>
        transport.subscribe(
          (client) => client[ORCHESTRATOR_WS_METHODS.subscribeTask](input),
          listener,
          { ...options, tag: ORCHESTRATOR_WS_METHODS.subscribeTask },
        ),
      resolveGate: (input) =>
        transport.request((client) => client[ORCHESTRATOR_WS_METHODS.resolveGate](input)),
      // Dialog caller was removed; per-task model selection is now PM-driven, but this remains a human-origin RPC.
      setTaskCapabilityTiers: (input) =>
        transport.request((client) =>
          client[ORCHESTRATOR_WS_METHODS.setTaskCapabilityTiers](input),
        ),
      landTask: (input) =>
        transport.request((client) => client[ORCHESTRATOR_WS_METHODS.landTask](input)),
      cancelTask: (input) =>
        transport.request((client) => client[ORCHESTRATOR_WS_METHODS.cancelTask](input)),
      interruptStage: (input) =>
        transport.request((client) => client[ORCHESTRATOR_WS_METHODS.interruptStage](input)),
      inspectTaskChanges: (input) =>
        transport.request((client) => client[ORCHESTRATOR_WS_METHODS.inspectTaskChanges](input)),
      commitTaskChanges: (input) =>
        transport.request((client) => client[ORCHESTRATOR_WS_METHODS.commitTaskChanges](input)),
      discardTaskChanges: (input) =>
        transport.request((client) => client[ORCHESTRATOR_WS_METHODS.discardTaskChanges](input)),
      returnTaskChanges: (input) =>
        transport.request((client) => client[ORCHESTRATOR_WS_METHODS.returnTaskChanges](input)),
      completeTaskWithoutChanges: (input) =>
        transport.request((client) =>
          client[ORCHESTRATOR_WS_METHODS.completeTaskWithoutChanges](input),
        ),
      listArchivedTasks: (input) =>
        transport.request((client) => client[ORCHESTRATOR_WS_METHODS.listArchivedTasks](input)),
      archiveTask: (input) =>
        transport.request((client) => client[ORCHESTRATOR_WS_METHODS.archiveTask](input)),
      restoreTask: (input) =>
        transport.request((client) => client[ORCHESTRATOR_WS_METHODS.restoreTask](input)),
      deleteTask: (input) =>
        transport.request((client) => client[ORCHESTRATOR_WS_METHODS.deleteTask](input)),
      clearPmChat: (input) =>
        transport.request((client) => client[ORCHESTRATOR_WS_METHODS.clearPmChat](input)),
      requestPmHandoff: (input) =>
        transport.request((client) => client[ORCHESTRATOR_WS_METHODS.requestPmHandoff](input)),
      getProjectContextOnboarding: (input) =>
        transport.request((client) =>
          client[ORCHESTRATOR_WS_METHODS.getProjectContextOnboarding](input),
        ),
      dismissProjectContextOnboarding: (input) =>
        transport.request((client) =>
          client[ORCHESTRATOR_WS_METHODS.dismissProjectContextOnboarding](input),
        ),
      requestProjectContextRun: (input) =>
        transport.request((client) =>
          client[ORCHESTRATOR_WS_METHODS.requestProjectContextRun](input),
        ),
      getProjectContextRunReview: (input) =>
        transport.request((client) =>
          client[ORCHESTRATOR_WS_METHODS.getProjectContextRunReview](input),
        ),
      reviseProjectContextRun: (input) =>
        transport.request((client) =>
          client[ORCHESTRATOR_WS_METHODS.reviseProjectContextRun](input),
        ),
      commitProjectContextRun: (input) =>
        transport.request((client) =>
          client[ORCHESTRATOR_WS_METHODS.commitProjectContextRun](input),
        ),
      discardProjectContextRun: (input) =>
        transport.request((client) =>
          client[ORCHESTRATOR_WS_METHODS.discardProjectContextRun](input),
        ),
    },
  };
}
