import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import { ExternalLauncherError, LaunchEditorInput } from "./editor.ts";
import { AuthAccessStreamEvent } from "./auth.ts";
import {
  FilesystemBrowseInput,
  FilesystemBrowseResult,
  FilesystemBrowseError,
} from "./filesystem.ts";
import {
  GitActionProgressEvent,
  VcsSwitchRefInput,
  VcsSwitchRefResult,
  GitCommandError,
  VcsCreateRefInput,
  VcsCreateRefResult,
  VcsCreateWorktreeInput,
  VcsCreateWorktreeResult,
  VcsInitInput,
  VcsListRefsInput,
  VcsListRefsResult,
  GitManagerServiceError,
  GitPreparePullRequestThreadInput,
  GitPreparePullRequestThreadResult,
  VcsPullInput,
  GitPullRequestRefInput,
  VcsPullResult,
  VcsRemoveWorktreeInput,
  GitResolvePullRequestResult,
  GitRunStackedActionInput,
  VcsStatusInput,
  VcsStatusResult,
  VcsStatusStreamEvent,
} from "./git.ts";
import { KeybindingsConfigError } from "./keybindings.ts";
import {
  ClientOrchestrationCommand,
  OrchestrationCancelTaskError,
  OrchestrationInterruptStageError,
  ORCHESTRATOR_WS_METHODS,
  ORCHESTRATION_WS_METHODS,
  OrchestrationDispatchCommandError,
  OrchestrationForkThreadError,
  OrchestrationLandTaskError,
  OrchestrationGetFullThreadDiffError,
  OrchestrationGetFullThreadDiffInput,
  OrchestrationGetSnapshotError,
  OrchestrationGetTurnDiffError,
  OrchestrationGetTurnDiffInput,
  OrchestrationReplayEventsError,
  OrchestrationReplayEventsInput,
  OrchestrationRpcSchemas,
  OrchestratorRpcSchemas,
} from "./orchestration.ts";
import { ProviderInstanceId } from "./providerInstance.ts";
import {
  ProjectSearchEntriesError,
  ProjectSearchEntriesInput,
  ProjectSearchEntriesResult,
  ProjectWriteFileError,
  ProjectWriteFileInput,
  ProjectWriteFileResult,
} from "./project.ts";
import {
  TerminalClearInput,
  TerminalCloseInput,
  TerminalError,
  TerminalEvent,
  TerminalOpenInput,
  TerminalResizeInput,
  TerminalRestartInput,
  TerminalSessionSnapshot,
  TerminalWriteInput,
} from "./terminal.ts";
import {
  ServerConfigStreamEvent,
  ServerConfig,
  ServerProviderUpdateError,
  ServerProviderUpdateInput,
  ServerLifecycleStreamEvent,
  ServerRemoveKeybindingInput,
  ServerRemoveKeybindingResult,
  ServerProviderUpdatedPayload,
  ServerTraceDiagnosticsResult,
  ServerProcessDiagnosticsResult,
  ServerProcessResourceHistoryInput,
  ServerProcessResourceHistoryResult,
  ServerSignalProcessInput,
  ServerSignalProcessResult,
  ServerUpsertKeybindingInput,
  ServerUpsertKeybindingResult,
} from "./server.ts";
import { ServerSettings, ServerSettingsError, ServerSettingsPatch } from "./settings.ts";
import {
  SourceControlCloneRepositoryInput,
  SourceControlCloneRepositoryResult,
  SourceControlDiscoveryResult,
  SourceControlPublishRepositoryInput,
  SourceControlPublishRepositoryResult,
  SourceControlRepositoryError,
  SourceControlRepositoryInfo,
  SourceControlRepositoryLookupInput,
} from "./sourceControl.ts";
import { VcsError } from "./vcs.ts";

export const WS_METHODS = {
  // Project registry methods
  projectsList: "projects.list",
  projectsAdd: "projects.add",
  projectsRemove: "projects.remove",
  projectsSearchEntries: "projects.searchEntries",
  projectsWriteFile: "projects.writeFile",

  // Shell methods
  shellOpenInEditor: "shell.openInEditor",

  // Filesystem methods
  filesystemBrowse: "filesystem.browse",

  // VCS methods
  vcsPull: "vcs.pull",
  vcsRefreshStatus: "vcs.refreshStatus",
  vcsListRefs: "vcs.listRefs",
  vcsCreateWorktree: "vcs.createWorktree",
  vcsRemoveWorktree: "vcs.removeWorktree",
  vcsCreateRef: "vcs.createRef",
  vcsSwitchRef: "vcs.switchRef",
  vcsInit: "vcs.init",

  // Git workflow methods
  gitRunStackedAction: "git.runStackedAction",
  gitResolvePullRequest: "git.resolvePullRequest",
  gitPreparePullRequestThread: "git.preparePullRequestThread",

  // Terminal methods
  terminalOpen: "terminal.open",
  terminalWrite: "terminal.write",
  terminalResize: "terminal.resize",
  terminalClear: "terminal.clear",
  terminalRestart: "terminal.restart",
  terminalClose: "terminal.close",

  // Server meta
  serverGetConfig: "server.getConfig",
  serverRefreshProviders: "server.refreshProviders",
  serverUpdateProvider: "server.updateProvider",
  serverUpsertKeybinding: "server.upsertKeybinding",
  serverRemoveKeybinding: "server.removeKeybinding",
  serverGetSettings: "server.getSettings",
  serverUpdateSettings: "server.updateSettings",
  serverDiscoverSourceControl: "server.discoverSourceControl",
  serverGetTraceDiagnostics: "server.getTraceDiagnostics",
  serverGetProcessDiagnostics: "server.getProcessDiagnostics",
  serverGetProcessResourceHistory: "server.getProcessResourceHistory",
  serverSignalProcess: "server.signalProcess",

  // Source control methods
  sourceControlLookupRepository: "sourceControl.lookupRepository",
  sourceControlCloneRepository: "sourceControl.cloneRepository",
  sourceControlPublishRepository: "sourceControl.publishRepository",

  // Streaming subscriptions
  subscribeVcsStatus: "subscribeVcsStatus",
  subscribeTerminalEvents: "subscribeTerminalEvents",
  subscribeServerConfig: "subscribeServerConfig",
  subscribeServerLifecycle: "subscribeServerLifecycle",
  subscribeAuthAccess: "subscribeAuthAccess",
} as const;

export const WsServerUpsertKeybindingRpc = Rpc.make(WS_METHODS.serverUpsertKeybinding, {
  payload: ServerUpsertKeybindingInput,
  success: ServerUpsertKeybindingResult,
  error: KeybindingsConfigError,
});

export const WsServerRemoveKeybindingRpc = Rpc.make(WS_METHODS.serverRemoveKeybinding, {
  payload: ServerRemoveKeybindingInput,
  success: ServerRemoveKeybindingResult,
  error: KeybindingsConfigError,
});

export const WsServerGetConfigRpc = Rpc.make(WS_METHODS.serverGetConfig, {
  payload: Schema.Struct({}),
  success: ServerConfig,
  error: Schema.Union([KeybindingsConfigError, ServerSettingsError]),
});

export const WsServerRefreshProvidersRpc = Rpc.make(WS_METHODS.serverRefreshProviders, {
  payload: Schema.Struct({
    /**
     * When supplied, only refresh this specific provider instance. When
     * omitted, refresh all configured instances — the legacy `refresh()`
     * behaviour retained for transports that still dispatch untargeted
     * refreshes.
     */
    instanceId: Schema.optional(ProviderInstanceId),
  }),
  success: ServerProviderUpdatedPayload,
});

export const WsServerUpdateProviderRpc = Rpc.make(WS_METHODS.serverUpdateProvider, {
  payload: ServerProviderUpdateInput,
  success: ServerProviderUpdatedPayload,
  error: ServerProviderUpdateError,
});

export const WsServerGetSettingsRpc = Rpc.make(WS_METHODS.serverGetSettings, {
  payload: Schema.Struct({}),
  success: ServerSettings,
  error: ServerSettingsError,
});

export const WsServerUpdateSettingsRpc = Rpc.make(WS_METHODS.serverUpdateSettings, {
  payload: Schema.Struct({ patch: ServerSettingsPatch }),
  success: ServerSettings,
  error: ServerSettingsError,
});

export const WsServerDiscoverSourceControlRpc = Rpc.make(WS_METHODS.serverDiscoverSourceControl, {
  payload: Schema.Struct({}),
  success: SourceControlDiscoveryResult,
});

export const WsServerGetTraceDiagnosticsRpc = Rpc.make(WS_METHODS.serverGetTraceDiagnostics, {
  payload: Schema.Struct({}),
  success: ServerTraceDiagnosticsResult,
});

export const WsServerGetProcessDiagnosticsRpc = Rpc.make(WS_METHODS.serverGetProcessDiagnostics, {
  payload: Schema.Struct({}),
  success: ServerProcessDiagnosticsResult,
});

export const WsServerGetProcessResourceHistoryRpc = Rpc.make(
  WS_METHODS.serverGetProcessResourceHistory,
  {
    payload: ServerProcessResourceHistoryInput,
    success: ServerProcessResourceHistoryResult,
  },
);

export const WsServerSignalProcessRpc = Rpc.make(WS_METHODS.serverSignalProcess, {
  payload: ServerSignalProcessInput,
  success: ServerSignalProcessResult,
});

export const WsSourceControlLookupRepositoryRpc = Rpc.make(
  WS_METHODS.sourceControlLookupRepository,
  {
    payload: SourceControlRepositoryLookupInput,
    success: SourceControlRepositoryInfo,
    error: SourceControlRepositoryError,
  },
);

export const WsSourceControlCloneRepositoryRpc = Rpc.make(WS_METHODS.sourceControlCloneRepository, {
  payload: SourceControlCloneRepositoryInput,
  success: SourceControlCloneRepositoryResult,
  error: SourceControlRepositoryError,
});

export const WsSourceControlPublishRepositoryRpc = Rpc.make(
  WS_METHODS.sourceControlPublishRepository,
  {
    payload: SourceControlPublishRepositoryInput,
    success: SourceControlPublishRepositoryResult,
    error: SourceControlRepositoryError,
  },
);

export const WsProjectsSearchEntriesRpc = Rpc.make(WS_METHODS.projectsSearchEntries, {
  payload: ProjectSearchEntriesInput,
  success: ProjectSearchEntriesResult,
  error: ProjectSearchEntriesError,
});

export const WsProjectsWriteFileRpc = Rpc.make(WS_METHODS.projectsWriteFile, {
  payload: ProjectWriteFileInput,
  success: ProjectWriteFileResult,
  error: ProjectWriteFileError,
});

export const WsShellOpenInEditorRpc = Rpc.make(WS_METHODS.shellOpenInEditor, {
  payload: LaunchEditorInput,
  error: ExternalLauncherError,
});

export const WsFilesystemBrowseRpc = Rpc.make(WS_METHODS.filesystemBrowse, {
  payload: FilesystemBrowseInput,
  success: FilesystemBrowseResult,
  error: FilesystemBrowseError,
});

export const WsSubscribeVcsStatusRpc = Rpc.make(WS_METHODS.subscribeVcsStatus, {
  payload: VcsStatusInput,
  success: VcsStatusStreamEvent,
  error: GitManagerServiceError,
  stream: true,
});

export const WsVcsPullRpc = Rpc.make(WS_METHODS.vcsPull, {
  payload: VcsPullInput,
  success: VcsPullResult,
  error: GitCommandError,
});

export const WsVcsRefreshStatusRpc = Rpc.make(WS_METHODS.vcsRefreshStatus, {
  payload: VcsStatusInput,
  success: VcsStatusResult,
  error: GitManagerServiceError,
});

export const WsGitRunStackedActionRpc = Rpc.make(WS_METHODS.gitRunStackedAction, {
  payload: GitRunStackedActionInput,
  success: GitActionProgressEvent,
  error: GitManagerServiceError,
  stream: true,
});

export const WsGitResolvePullRequestRpc = Rpc.make(WS_METHODS.gitResolvePullRequest, {
  payload: GitPullRequestRefInput,
  success: GitResolvePullRequestResult,
  error: GitManagerServiceError,
});

export const WsGitPreparePullRequestThreadRpc = Rpc.make(WS_METHODS.gitPreparePullRequestThread, {
  payload: GitPreparePullRequestThreadInput,
  success: GitPreparePullRequestThreadResult,
  error: GitManagerServiceError,
});

export const WsVcsListRefsRpc = Rpc.make(WS_METHODS.vcsListRefs, {
  payload: VcsListRefsInput,
  success: VcsListRefsResult,
  error: GitCommandError,
});

export const WsVcsCreateWorktreeRpc = Rpc.make(WS_METHODS.vcsCreateWorktree, {
  payload: VcsCreateWorktreeInput,
  success: VcsCreateWorktreeResult,
  error: GitCommandError,
});

export const WsVcsRemoveWorktreeRpc = Rpc.make(WS_METHODS.vcsRemoveWorktree, {
  payload: VcsRemoveWorktreeInput,
  error: GitCommandError,
});

export const WsVcsCreateRefRpc = Rpc.make(WS_METHODS.vcsCreateRef, {
  payload: VcsCreateRefInput,
  success: VcsCreateRefResult,
  error: GitCommandError,
});

export const WsVcsSwitchRefRpc = Rpc.make(WS_METHODS.vcsSwitchRef, {
  payload: VcsSwitchRefInput,
  success: VcsSwitchRefResult,
  error: GitCommandError,
});

export const WsVcsInitRpc = Rpc.make(WS_METHODS.vcsInit, {
  payload: VcsInitInput,
  error: VcsError,
});

export const WsTerminalOpenRpc = Rpc.make(WS_METHODS.terminalOpen, {
  payload: TerminalOpenInput,
  success: TerminalSessionSnapshot,
  error: TerminalError,
});

export const WsTerminalWriteRpc = Rpc.make(WS_METHODS.terminalWrite, {
  payload: TerminalWriteInput,
  error: TerminalError,
});

export const WsTerminalResizeRpc = Rpc.make(WS_METHODS.terminalResize, {
  payload: TerminalResizeInput,
  error: TerminalError,
});

export const WsTerminalClearRpc = Rpc.make(WS_METHODS.terminalClear, {
  payload: TerminalClearInput,
  error: TerminalError,
});

export const WsTerminalRestartRpc = Rpc.make(WS_METHODS.terminalRestart, {
  payload: TerminalRestartInput,
  success: TerminalSessionSnapshot,
  error: TerminalError,
});

export const WsTerminalCloseRpc = Rpc.make(WS_METHODS.terminalClose, {
  payload: TerminalCloseInput,
  error: TerminalError,
});

export const WsOrchestrationDispatchCommandRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.dispatchCommand,
  {
    payload: ClientOrchestrationCommand,
    success: OrchestrationRpcSchemas.dispatchCommand.output,
    error: OrchestrationDispatchCommandError,
  },
);

export const WsOrchestrationForkThreadRpc = Rpc.make(ORCHESTRATION_WS_METHODS.forkThread, {
  payload: OrchestrationRpcSchemas.forkThread.input,
  success: OrchestrationRpcSchemas.forkThread.output,
  error: OrchestrationForkThreadError,
});

export const WsOrchestrationGetTurnDiffRpc = Rpc.make(ORCHESTRATION_WS_METHODS.getTurnDiff, {
  payload: OrchestrationGetTurnDiffInput,
  success: OrchestrationRpcSchemas.getTurnDiff.output,
  error: OrchestrationGetTurnDiffError,
});

export const WsOrchestrationGetFullThreadDiffRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.getFullThreadDiff,
  {
    payload: OrchestrationGetFullThreadDiffInput,
    success: OrchestrationRpcSchemas.getFullThreadDiff.output,
    error: OrchestrationGetFullThreadDiffError,
  },
);

export const WsOrchestrationReplayEventsRpc = Rpc.make(ORCHESTRATION_WS_METHODS.replayEvents, {
  payload: OrchestrationReplayEventsInput,
  success: OrchestrationRpcSchemas.replayEvents.output,
  error: OrchestrationReplayEventsError,
});

export const WsOrchestrationGetArchivedShellSnapshotRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.getArchivedShellSnapshot,
  {
    payload: OrchestrationRpcSchemas.getArchivedShellSnapshot.input,
    success: OrchestrationRpcSchemas.getArchivedShellSnapshot.output,
    error: OrchestrationGetSnapshotError,
  },
);

export const WsOrchestrationSubscribeShellRpc = Rpc.make(ORCHESTRATION_WS_METHODS.subscribeShell, {
  payload: OrchestrationRpcSchemas.subscribeShell.input,
  success: OrchestrationRpcSchemas.subscribeShell.output,
  error: OrchestrationGetSnapshotError,
  stream: true,
});

export const WsOrchestrationSubscribeThreadRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.subscribeThread,
  {
    payload: OrchestrationRpcSchemas.subscribeThread.input,
    success: OrchestrationRpcSchemas.subscribeThread.output,
    error: OrchestrationGetSnapshotError,
    stream: true,
  },
);

export const WsOrchestratorGetPresetMigrationRpc = Rpc.make(
  ORCHESTRATOR_WS_METHODS.getPresetMigration,
  {
    payload: OrchestratorRpcSchemas.getPresetMigration.input,
    success: OrchestratorRpcSchemas.getPresetMigration.output,
    error: OrchestrationDispatchCommandError,
  },
);

export const WsOrchestratorCompletePresetMigrationRpc = Rpc.make(
  ORCHESTRATOR_WS_METHODS.completePresetMigration,
  {
    payload: OrchestratorRpcSchemas.completePresetMigration.input,
    success: OrchestratorRpcSchemas.completePresetMigration.output,
    error: OrchestrationDispatchCommandError,
  },
);

export const WsOrchestratorSendMessageRpc = Rpc.make(ORCHESTRATOR_WS_METHODS.sendMessage, {
  payload: OrchestratorRpcSchemas.sendMessage.input,
  success: OrchestratorRpcSchemas.sendMessage.output,
  error: OrchestrationDispatchCommandError,
});

export const WsOrchestratorSubscribeProjectRpc = Rpc.make(
  ORCHESTRATOR_WS_METHODS.subscribeProject,
  {
    payload: OrchestratorRpcSchemas.subscribeProject.input,
    success: OrchestratorRpcSchemas.subscribeProject.output,
    error: OrchestrationGetSnapshotError,
    stream: true,
  },
);

export const WsOrchestratorSubscribeTaskRpc = Rpc.make(ORCHESTRATOR_WS_METHODS.subscribeTask, {
  payload: OrchestratorRpcSchemas.subscribeTask.input,
  success: OrchestratorRpcSchemas.subscribeTask.output,
  error: OrchestrationGetSnapshotError,
  stream: true,
});

export const WsOrchestratorResolveGateRpc = Rpc.make(ORCHESTRATOR_WS_METHODS.resolveGate, {
  payload: OrchestratorRpcSchemas.resolveGate.input,
  success: OrchestratorRpcSchemas.resolveGate.output,
  error: OrchestrationDispatchCommandError,
});

export const WsOrchestratorSetTaskCapabilityTiersRpc = Rpc.make(
  ORCHESTRATOR_WS_METHODS.setTaskCapabilityTiers,
  {
    payload: OrchestratorRpcSchemas.setTaskCapabilityTiers.input,
    success: OrchestratorRpcSchemas.setTaskCapabilityTiers.output,
    error: OrchestrationDispatchCommandError,
  },
);

export const WsOrchestratorCancelTaskRpc = Rpc.make(ORCHESTRATOR_WS_METHODS.cancelTask, {
  payload: OrchestratorRpcSchemas.cancelTask.input,
  success: OrchestratorRpcSchemas.cancelTask.output,
  error: Schema.Union([OrchestrationDispatchCommandError, OrchestrationCancelTaskError]),
});

export const WsOrchestratorInterruptStageRpc = Rpc.make(ORCHESTRATOR_WS_METHODS.interruptStage, {
  payload: OrchestratorRpcSchemas.interruptStage.input,
  success: OrchestratorRpcSchemas.interruptStage.output,
  error: Schema.Union([OrchestrationDispatchCommandError, OrchestrationInterruptStageError]),
});

export const WsOrchestratorInspectTaskChangesRpc = Rpc.make(
  ORCHESTRATOR_WS_METHODS.inspectTaskChanges,
  {
    payload: OrchestratorRpcSchemas.inspectTaskChanges.input,
    success: OrchestratorRpcSchemas.inspectTaskChanges.output,
    error: OrchestrationDispatchCommandError,
  },
);

export const WsOrchestratorCommitTaskChangesRpc = Rpc.make(
  ORCHESTRATOR_WS_METHODS.commitTaskChanges,
  {
    payload: OrchestratorRpcSchemas.commitTaskChanges.input,
    success: OrchestratorRpcSchemas.commitTaskChanges.output,
    error: OrchestrationDispatchCommandError,
  },
);

export const WsOrchestratorDiscardTaskChangesRpc = Rpc.make(
  ORCHESTRATOR_WS_METHODS.discardTaskChanges,
  {
    payload: OrchestratorRpcSchemas.discardTaskChanges.input,
    success: OrchestratorRpcSchemas.discardTaskChanges.output,
    error: OrchestrationDispatchCommandError,
  },
);

export const WsOrchestratorReturnTaskChangesRpc = Rpc.make(
  ORCHESTRATOR_WS_METHODS.returnTaskChanges,
  {
    payload: OrchestratorRpcSchemas.returnTaskChanges.input,
    success: OrchestratorRpcSchemas.returnTaskChanges.output,
    error: OrchestrationDispatchCommandError,
  },
);

export const WsOrchestratorCompleteTaskWithoutChangesRpc = Rpc.make(
  ORCHESTRATOR_WS_METHODS.completeTaskWithoutChanges,
  {
    payload: OrchestratorRpcSchemas.completeTaskWithoutChanges.input,
    success: OrchestratorRpcSchemas.completeTaskWithoutChanges.output,
    error: OrchestrationDispatchCommandError,
  },
);

export const WsOrchestratorLandTaskRpc = Rpc.make(ORCHESTRATOR_WS_METHODS.landTask, {
  payload: OrchestratorRpcSchemas.landTask.input,
  success: OrchestratorRpcSchemas.landTask.output,
  error: Schema.Union([OrchestrationDispatchCommandError, OrchestrationLandTaskError]),
});

export const WsOrchestratorListArchivedTasksRpc = Rpc.make(
  ORCHESTRATOR_WS_METHODS.listArchivedTasks,
  {
    payload: OrchestratorRpcSchemas.listArchivedTasks.input,
    success: OrchestratorRpcSchemas.listArchivedTasks.output,
    error: OrchestrationGetSnapshotError,
  },
);

export const WsOrchestratorArchiveTaskRpc = Rpc.make(ORCHESTRATOR_WS_METHODS.archiveTask, {
  payload: OrchestratorRpcSchemas.archiveTask.input,
  success: OrchestratorRpcSchemas.archiveTask.output,
  error: OrchestrationDispatchCommandError,
});

export const WsOrchestratorRestoreTaskRpc = Rpc.make(ORCHESTRATOR_WS_METHODS.restoreTask, {
  payload: OrchestratorRpcSchemas.restoreTask.input,
  success: OrchestratorRpcSchemas.restoreTask.output,
  error: OrchestrationDispatchCommandError,
});

export const WsOrchestratorDeleteTaskRpc = Rpc.make(ORCHESTRATOR_WS_METHODS.deleteTask, {
  payload: OrchestratorRpcSchemas.deleteTask.input,
  success: OrchestratorRpcSchemas.deleteTask.output,
  error: OrchestrationDispatchCommandError,
});

export const WsOrchestratorClearPmChatRpc = Rpc.make(ORCHESTRATOR_WS_METHODS.clearPmChat, {
  payload: OrchestratorRpcSchemas.clearPmChat.input,
  success: OrchestratorRpcSchemas.clearPmChat.output,
  error: OrchestrationDispatchCommandError,
});

export const WsOrchestratorRequestPmHandoffRpc = Rpc.make(
  ORCHESTRATOR_WS_METHODS.requestPmHandoff,
  {
    payload: OrchestratorRpcSchemas.requestPmHandoff.input,
    success: OrchestratorRpcSchemas.requestPmHandoff.output,
    error: OrchestrationDispatchCommandError,
  },
);

export const WsOrchestratorGetProjectContextOnboardingRpc = Rpc.make(
  ORCHESTRATOR_WS_METHODS.getProjectContextOnboarding,
  {
    payload: OrchestratorRpcSchemas.getProjectContextOnboarding.input,
    success: OrchestratorRpcSchemas.getProjectContextOnboarding.output,
    error: OrchestrationDispatchCommandError,
  },
);

export const WsOrchestratorDismissProjectContextOnboardingRpc = Rpc.make(
  ORCHESTRATOR_WS_METHODS.dismissProjectContextOnboarding,
  {
    payload: OrchestratorRpcSchemas.dismissProjectContextOnboarding.input,
    success: OrchestratorRpcSchemas.dismissProjectContextOnboarding.output,
    error: OrchestrationDispatchCommandError,
  },
);

export const WsOrchestratorRequestProjectContextRunRpc = Rpc.make(
  ORCHESTRATOR_WS_METHODS.requestProjectContextRun,
  {
    payload: OrchestratorRpcSchemas.requestProjectContextRun.input,
    success: OrchestratorRpcSchemas.requestProjectContextRun.output,
    error: OrchestrationDispatchCommandError,
  },
);

export const WsSubscribeTerminalEventsRpc = Rpc.make(WS_METHODS.subscribeTerminalEvents, {
  payload: Schema.Struct({}),
  success: TerminalEvent,
  stream: true,
});

export const WsSubscribeServerConfigRpc = Rpc.make(WS_METHODS.subscribeServerConfig, {
  payload: Schema.Struct({}),
  success: ServerConfigStreamEvent,
  error: Schema.Union([KeybindingsConfigError, ServerSettingsError]),
  stream: true,
});

export const WsSubscribeServerLifecycleRpc = Rpc.make(WS_METHODS.subscribeServerLifecycle, {
  payload: Schema.Struct({}),
  success: ServerLifecycleStreamEvent,
  stream: true,
});

export const WsSubscribeAuthAccessRpc = Rpc.make(WS_METHODS.subscribeAuthAccess, {
  payload: Schema.Struct({}),
  success: AuthAccessStreamEvent,
  stream: true,
});

export const WsRpcGroup = RpcGroup.make(
  WsServerGetConfigRpc,
  WsServerRefreshProvidersRpc,
  WsServerUpdateProviderRpc,
  WsServerUpsertKeybindingRpc,
  WsServerRemoveKeybindingRpc,
  WsServerGetSettingsRpc,
  WsServerUpdateSettingsRpc,
  WsServerDiscoverSourceControlRpc,
  WsServerGetTraceDiagnosticsRpc,
  WsServerGetProcessDiagnosticsRpc,
  WsServerGetProcessResourceHistoryRpc,
  WsServerSignalProcessRpc,
  WsSourceControlLookupRepositoryRpc,
  WsSourceControlCloneRepositoryRpc,
  WsSourceControlPublishRepositoryRpc,
  WsProjectsSearchEntriesRpc,
  WsProjectsWriteFileRpc,
  WsShellOpenInEditorRpc,
  WsFilesystemBrowseRpc,
  WsSubscribeVcsStatusRpc,
  WsVcsPullRpc,
  WsVcsRefreshStatusRpc,
  WsGitRunStackedActionRpc,
  WsGitResolvePullRequestRpc,
  WsGitPreparePullRequestThreadRpc,
  WsVcsListRefsRpc,
  WsVcsCreateWorktreeRpc,
  WsVcsRemoveWorktreeRpc,
  WsVcsCreateRefRpc,
  WsVcsSwitchRefRpc,
  WsVcsInitRpc,
  WsTerminalOpenRpc,
  WsTerminalWriteRpc,
  WsTerminalResizeRpc,
  WsTerminalClearRpc,
  WsTerminalRestartRpc,
  WsTerminalCloseRpc,
  WsSubscribeTerminalEventsRpc,
  WsSubscribeServerConfigRpc,
  WsSubscribeServerLifecycleRpc,
  WsSubscribeAuthAccessRpc,
  WsOrchestrationDispatchCommandRpc,
  WsOrchestrationForkThreadRpc,
  WsOrchestrationGetTurnDiffRpc,
  WsOrchestrationGetFullThreadDiffRpc,
  WsOrchestrationReplayEventsRpc,
  WsOrchestrationGetArchivedShellSnapshotRpc,
  WsOrchestrationSubscribeShellRpc,
  WsOrchestrationSubscribeThreadRpc,
  WsOrchestratorGetPresetMigrationRpc,
  WsOrchestratorCompletePresetMigrationRpc,
  WsOrchestratorSendMessageRpc,
  WsOrchestratorSubscribeProjectRpc,
  WsOrchestratorSubscribeTaskRpc,
  WsOrchestratorResolveGateRpc,
  WsOrchestratorSetTaskCapabilityTiersRpc,
  WsOrchestratorCancelTaskRpc,
  WsOrchestratorInterruptStageRpc,
  WsOrchestratorInspectTaskChangesRpc,
  WsOrchestratorCommitTaskChangesRpc,
  WsOrchestratorDiscardTaskChangesRpc,
  WsOrchestratorReturnTaskChangesRpc,
  WsOrchestratorCompleteTaskWithoutChangesRpc,
  WsOrchestratorLandTaskRpc,
  WsOrchestratorListArchivedTasksRpc,
  WsOrchestratorArchiveTaskRpc,
  WsOrchestratorRestoreTaskRpc,
  WsOrchestratorDeleteTaskRpc,
  WsOrchestratorClearPmChatRpc,
  WsOrchestratorRequestPmHandoffRpc,
  WsOrchestratorGetProjectContextOnboardingRpc,
  WsOrchestratorDismissProjectContextOnboardingRpc,
  WsOrchestratorRequestProjectContextRunRpc,
);
