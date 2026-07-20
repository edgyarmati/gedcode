import { createHash } from "node:crypto";
import {
  CommandId,
  PROJECT_CONTEXT_RUN_FAILURE_MAX_CHARS,
  PROJECT_CONTEXT_RUN_RESULT_MAX_CHARS,
  ProjectContextRunId,
  ProjectContextRunPath,
  ThreadId,
  type OrchestrationEvent,
  type OrchestrationProjectContextRun,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import { ProjectionProjectContextRunRepositoryLive } from "../../persistence/Layers/ProjectionProjectContextRuns.ts";
import { ProviderQuotaStatusRepositoryLive } from "../../persistence/Layers/ProviderQuotaStatus.ts";
import { ProjectionProjectContextRunRepository } from "../../persistence/Services/ProjectionProjectContextRuns.ts";
import { ProviderQuotaStatusRepository } from "../../persistence/Services/ProviderQuotaStatus.ts";
import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { ProjectContextScanner } from "../../project/Services/ProjectContextScanner.ts";
import {
  auditProjectContextGitStateDrift,
  auditProjectContextWorkspaceDrift,
  captureProjectContextRunGitState,
  captureProjectContextWorkspaceStatus,
  compareProjectContextOwnership,
} from "../../project/ProjectContextRunChanges.ts";
import type {
  ProjectContextContentDigest,
  ProjectContextOwnershipBaseline,
} from "../../project/ProjectContext.ts";
import { VcsProcess } from "../../vcs/VcsProcess.ts";
import { resolveOrchestratorPmRuntimePolicy } from "../orchestratorRuntimeModes.ts";
import { recoverElapsedProviderQuotaBlocks } from "../quotaResetRecovery.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import {
  ProjectContextRunReactor,
  type ProjectContextRunReactorShape,
} from "../Services/ProjectContextRunReactor.ts";

const THREAD_PREFIX = "project-context:";
const SYSTEM_PROMPT = [
  "You are a bounded project-context maintainer working in the primary checkout.",
  "You may read the project, but may write only AGENTS.md, CONTEXT.md, .ged/PROJECT.md, .ged/ARCHITECTURE.md, and direct Markdown files in docs/adr/.",
  "Do not modify any other path. Do not stage, commit, reset, restore, clean, switch branches, create worktrees, alter Git history, or delegate to another agent.",
  "Do not write inside .gedcode or .ged/work/root. Stop after editing the allowed context files and summarize what changed.",
].join(" ");
const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

export const projectContextRunThreadId = (runId: ProjectContextRunId): ThreadId =>
  ThreadId.make(`${THREAD_PREFIX}${runId}`);

const commandId = (kind: string, runId: ProjectContextRunId, source = "runtime"): CommandId =>
  CommandId.make(`server:project-context-${kind}:${runId}:${source}`);

const boundFailure = (message: string): string =>
  (message.trim() || "Project-context run failed.").slice(0, PROJECT_CONTEXT_RUN_FAILURE_MAX_CHARS);

const boundResult = (message: string): string =>
  (message.trim() || "Project-context agent completed without a written summary.").slice(
    0,
    PROJECT_CONTEXT_RUN_RESULT_MAX_CHARS,
  );

const isoFromEpochMs = (value: number | undefined): string | null =>
  value === undefined || !Number.isFinite(value) || value <= 0
    ? null
    : DateTime.formatIso(DateTime.makeUnsafe(value));

function ownershipBaselineFromRun(
  run: OrchestrationProjectContextRun,
): ProjectContextOwnershipBaseline {
  return {
    files: run.baselineManifest.map((entry) => {
      const content = entry.rawContent;
      return {
        relativePath: entry.path,
        state:
          content === null
            ? {
                presence: "absent" as const,
                digest: null,
                size: 0 as const,
                content: null,
              }
            : {
                presence: "present" as const,
                digest:
                  `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}` as ProjectContextContentDigest,
                size: Buffer.byteLength(content, "utf8"),
                content,
              },
      };
    }),
  };
}

export const makeProjectContextRunReactor = Effect.gen(function* () {
  const engine = yield* OrchestrationEngineService;
  const snapshots = yield* ProjectionSnapshotQuery;
  const runs = yield* ProjectionProjectContextRunRepository;
  const quota = yield* ProviderQuotaStatusRepository;
  const providers = yield* ProviderService;
  const scanner = yield* ProjectContextScanner;
  const vcsProcess = yield* VcsProcess;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const runByThread = new Map<string, ProjectContextRunId>();
  const assistantText = new Map<string, string>();
  const starting = new Set<string>();
  const scheduledQuotaResetAt = new Map<string, string>();
  const quotaResetSchedules = yield* Queue.unbounded<{
    readonly providerInstanceId: string;
    readonly resetAt: string;
  }>();

  const remember = (run: OrchestrationProjectContextRun) => {
    const threadId = run.providerThreadId ?? projectContextRunThreadId(run.id);
    runByThread.set(String(threadId), run.id);
    return threadId;
  };

  const stopSession = (threadId: ThreadId) =>
    providers.stopSession({ threadId }).pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.void
          : Effect.logDebug("project-context session was already stopped", {
              threadId,
              cause: Cause.pretty(cause),
            }),
      ),
    );

  const failRun = Effect.fn("ProjectContextRunReactor.failRun")(function* (
    run: OrchestrationProjectContextRun,
    message: string,
    source: string,
  ) {
    const fresh = yield* runs.getById({ projectContextRunId: run.id });
    if (
      fresh._tag !== "Some" ||
      (fresh.value.status !== "pending" && fresh.value.status !== "running")
    ) {
      return;
    }
    yield* engine.dispatch({
      type: "project.context.run.fail",
      commandId: commandId("fail", run.id, source),
      projectContextRunId: run.id,
      message: boundFailure(message),
      createdAt: yield* nowIso,
    });
    yield* stopSession(remember(run)).pipe(Effect.ignore);
  });

  const interruptUnavailableProject = Effect.fn(
    "ProjectContextRunReactor.interruptUnavailableProject",
  )(function* (run: OrchestrationProjectContextRun) {
    const fresh = yield* runs.getById({ projectContextRunId: run.id });
    if (
      fresh._tag !== "Some" ||
      (fresh.value.status !== "pending" && fresh.value.status !== "running")
    ) {
      return;
    }
    const threadId = remember(fresh.value);
    yield* engine.dispatch({
      type: "project.context.run.interrupt",
      commandId: commandId("interrupt", fresh.value.id, "project-unavailable"),
      projectContextRunId: fresh.value.id,
      createdAt: yield* nowIso,
    });
    yield* providers.interruptTurn({ threadId }).pipe(Effect.ignore);
    yield* stopSession(threadId).pipe(Effect.ignore);
    assistantText.delete(String(fresh.value.id));
  });

  const inspectChanges = Effect.fn("ProjectContextRunReactor.inspectChanges")(function* (
    run: OrchestrationProjectContextRun,
  ) {
    const currentSnapshot = yield* scanner.scan(run.primaryCheckoutPath);
    const currentWorkspaceStatus = yield* captureProjectContextWorkspaceStatus({
      workspaceRoot: run.primaryCheckoutPath,
      process: vcsProcess,
      fileSystem,
      path,
    });
    const currentGitState = yield* captureProjectContextRunGitState({
      workspaceRoot: run.primaryCheckoutPath,
      process: vcsProcess,
      fileSystem,
      path,
    });
    const owned = compareProjectContextOwnership(
      ownershipBaselineFromRun(run),
      currentSnapshot.ownershipBaseline,
    );
    const workspace = auditProjectContextWorkspaceDrift(
      run.workspaceStatusManifest,
      currentWorkspaceStatus,
    );
    const gitState = auditProjectContextGitStateDrift(run.gitState, currentGitState);
    return {
      changes: owned.changes.map((change) => ({
        path: ProjectContextRunPath.make(change.relativePath),
        beforeRawContent: change.before.content,
        afterRawContent: change.after.content,
      })),
      scopeViolationPaths: [
        ...new Set([
          ...workspace.outsideAllowedScope.map((entry) => entry.relativePath),
          ...gitState.scopeViolationPaths,
        ]),
      ].toSorted(),
    };
  });

  const settleReview = Effect.fn("ProjectContextRunReactor.settleReview")(function* (
    run: OrchestrationProjectContextRun,
    result: string,
    source: string,
  ) {
    const fresh = yield* runs.getById({ projectContextRunId: run.id });
    if (fresh._tag !== "Some" || fresh.value.status !== "running") return;
    const inspection = yield* inspectChanges(fresh.value).pipe(
      Effect.catchCause((cause) =>
        failRun(
          fresh.value,
          `The provider finished, but Gedcode could not safely audit its workspace changes: ${Cause.pretty(cause)}`,
          `audit-${source}`,
        ).pipe(Effect.as(null)),
      ),
    );
    if (inspection === null) return;
    yield* engine.dispatch({
      type: "project.context.run.pending-review",
      commandId: commandId("review", run.id, source),
      projectContextRunId: run.id,
      result: boundResult(result),
      changes: inspection.changes,
      scopeViolationPaths: inspection.scopeViolationPaths,
      createdAt: yield* nowIso,
    });
  });

  const settleAbnormal = Effect.fn("ProjectContextRunReactor.settleAbnormal")(function* (
    run: OrchestrationProjectContextRun,
    message: string,
    source: string,
    terminal: "failed" | "interrupted",
  ) {
    const fresh = yield* runs.getById({ projectContextRunId: run.id });
    if (fresh._tag !== "Some") return;
    if (fresh.value.status === "running") {
      const inspection = yield* inspectChanges(fresh.value).pipe(
        Effect.catchCause((cause) =>
          failRun(
            fresh.value,
            `Gedcode could not safely audit changes after the provider stopped: ${Cause.pretty(cause)}`,
            `audit-${source}`,
          ).pipe(Effect.as(null)),
        ),
      );
      if (inspection === null) return;
      if (inspection.changes.length > 0 || inspection.scopeViolationPaths.length > 0) {
        yield* engine.dispatch({
          type: "project.context.run.pending-review",
          commandId: commandId("review-abnormal", run.id, source),
          projectContextRunId: run.id,
          result: boundResult(`${message} Any resulting workspace changes require review.`),
          changes: inspection.changes,
          scopeViolationPaths: inspection.scopeViolationPaths,
          createdAt: yield* nowIso,
        });
        return;
      }
    }
    if (terminal === "interrupted") {
      yield* engine.dispatch({
        type: "project.context.run.interrupt",
        commandId: commandId("interrupt", run.id, source),
        projectContextRunId: run.id,
        createdAt: yield* nowIso,
      });
      return;
    }
    yield* failRun(fresh.value, message, source);
  });

  const scheduleQuotaResetRecovery = Effect.fn(
    "ProjectContextRunReactor.scheduleQuotaResetRecovery",
  )(function* (providerInstanceId: string, resetAt: string) {
    if (scheduledQuotaResetAt.get(providerInstanceId) === resetAt) return;
    const resetAtMs = Date.parse(resetAt);
    if (!Number.isFinite(resetAtMs)) return;
    scheduledQuotaResetAt.set(providerInstanceId, resetAt);
    yield* Queue.offer(quotaResetSchedules, { providerInstanceId, resetAt });
  });

  const recoverScheduledQuotaReset = Effect.fn(
    "ProjectContextRunReactor.recoverScheduledQuotaReset",
  )(function* ({
    providerInstanceId,
    resetAt,
  }: {
    readonly providerInstanceId: string;
    readonly resetAt: string;
  }) {
    const now = yield* DateTime.now;
    const delay = Math.max(0, Date.parse(resetAt) - now.epochMilliseconds);
    yield* Effect.sleep(Duration.millis(delay));
    const recovered = yield* recoverElapsedProviderQuotaBlocks({ quota });
    if (recovered.some((row) => String(row.providerInstanceId) === providerInstanceId)) {
      yield* reconcile;
    }
    if (scheduledQuotaResetAt.get(providerInstanceId) === resetAt) {
      scheduledQuotaResetAt.delete(providerInstanceId);
    }
  });

  const launch = Effect.fn("ProjectContextRunReactor.launch")(function* (
    run: OrchestrationProjectContextRun,
  ) {
    const key = String(run.id);
    if (starting.has(key)) return;
    starting.add(key);
    yield* Effect.gen(function* () {
      const readModel = yield* snapshots.getCommandReadModel();
      const project = readModel.projects.find((candidate) => candidate.id === run.projectId);
      if (project === undefined || project.deletedAt !== null) {
        return yield* interruptUnavailableProject(run);
      }
      if (!(yield* fileSystem.exists(run.primaryCheckoutPath))) {
        return yield* failRun(
          run,
          `Primary checkout '${run.primaryCheckoutPath}' does not exist.`,
          "missing-checkout",
        );
      }
      const quotaState = yield* quota.isInstanceQuotaBlocked({
        providerInstanceId: run.providerInstanceId,
      });
      if (quotaState.blocked) {
        if (quotaState.status === "blocked-until" && quotaState.resetAt !== null) {
          yield* scheduleQuotaResetRecovery(String(run.providerInstanceId), quotaState.resetAt);
        }
        return;
      }

      const threadId = remember(run);
      const active = (yield* providers.listSessions()).find(
        (session) => session.threadId === threadId,
      );
      if (run.status === "running" && active !== undefined) return;
      if (run.status === "running") {
        return yield* settleAbnormal(
          run,
          "The project-context provider session was not available after restart.",
          "restart-orphaned-session",
          "interrupted",
        );
      }
      const info = yield* providers.getInstanceInfo(run.providerInstanceId);
      const policy = resolveOrchestratorPmRuntimePolicy(info.driverKind);
      const session = yield* providers.startSession(threadId, {
        threadId,
        provider: info.driverKind,
        providerInstanceId: run.providerInstanceId,
        cwd: run.primaryCheckoutPath,
        modelSelection: {
          instanceId: run.providerInstanceId,
          model: run.model,
          ...(run.modelOptions === null ? {} : { options: run.modelOptions }),
        },
        runtimeMode: policy.runtimeMode,
        ...(policy.approvalReviewer === undefined
          ? {}
          : { approvalReviewer: policy.approvalReviewer }),
        readOnly: false,
        enableOrchestrationTools: false,
        systemPromptAppend: SYSTEM_PROMPT,
      });
      yield* engine.dispatch({
        type: "project.context.run.start",
        commandId: commandId("start", run.id),
        projectContextRunId: run.id,
        providerThreadId: session.threadId,
        createdAt: yield* nowIso,
      });
      assistantText.delete(key);
      yield* providers.sendTurn({
        threadId: session.threadId,
        input: run.prompt,
        modelSelection: {
          instanceId: run.providerInstanceId,
          model: run.model,
          ...(run.modelOptions === null ? {} : { options: run.modelOptions }),
        },
      });
    }).pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause) ? Effect.void : failRun(run, Cause.pretty(cause), "launch"),
      ),
      Effect.ensuring(Effect.sync(() => starting.delete(key))),
    );
  });

  const reconcile: ProjectContextRunReactorShape["reconcile"] = runs.listAll().pipe(
    Effect.flatMap((allRuns) =>
      Effect.forEach(
        allRuns.filter((run) => run.status === "pending" || run.status === "running"),
        launch,
        { concurrency: 1, discard: true },
      ),
    ),
    Effect.catchCause((cause) =>
      Cause.hasInterruptsOnly(cause)
        ? Effect.void
        : Effect.logWarning("project-context reconciliation failed", {
            cause: Cause.pretty(cause),
          }),
    ),
  );

  const processDomainEvent = Effect.fn("ProjectContextRunReactor.processDomainEvent")(function* (
    event: OrchestrationEvent,
  ) {
    if (event.type === "project.context-run-requested") {
      const run = yield* runs.getById({
        projectContextRunId: event.payload.projectContextRunId,
      });
      if (run._tag === "Some") yield* launch(run.value);
      return;
    }
    if (event.type === "project.context-run-interrupted") {
      const threadId = projectContextRunThreadId(event.payload.projectContextRunId);
      yield* providers.interruptTurn({ threadId }).pipe(Effect.ignore);
      yield* stopSession(threadId).pipe(Effect.ignore);
      assistantText.delete(String(event.payload.projectContextRunId));
    }
  });

  const processProviderEvent = Effect.fn("ProjectContextRunReactor.processProviderEvent")(
    function* (event: ProviderRuntimeEvent) {
      if (event.type === "account.rate-limits.updated" && event.providerInstanceId !== undefined) {
        const change = yield* quota.observeRuntimeStatus({
          providerInstanceId: event.providerInstanceId,
          runtimeStatus: event.payload.status,
          resetAt: isoFromEpochMs(event.payload.resetAtEpochMs),
          updatedAt: event.createdAt,
        });
        if (
          change._tag === "Some" &&
          change.value.nextStatus === "ok" &&
          change.value.previousStatus !== null &&
          change.value.previousStatus !== "ok"
        ) {
          yield* reconcile;
        }
      }
      const runId = runByThread.get(String(event.threadId));
      if (runId === undefined) return;
      const current = yield* runs.getById({ projectContextRunId: runId });
      if (current._tag !== "Some" || current.value.status !== "running") return;
      const run = current.value;
      const key = String(runId);

      if (event.type === "content.delta" && event.payload.streamKind === "assistant_text") {
        assistantText.set(
          key,
          `${assistantText.get(key) ?? ""}${event.payload.delta}`.slice(
            0,
            PROJECT_CONTEXT_RUN_RESULT_MAX_CHARS,
          ),
        );
        return;
      }
      if (
        event.type === "item.completed" &&
        event.payload.itemType === "assistant_message" &&
        (assistantText.get(key)?.length ?? 0) === 0 &&
        event.payload.detail !== undefined
      ) {
        assistantText.set(key, event.payload.detail.slice(0, PROJECT_CONTEXT_RUN_RESULT_MAX_CHARS));
        return;
      }
      if (event.type === "turn.completed") {
        if (event.payload.state === "completed") {
          yield* settleReview(run, assistantText.get(key) ?? "", String(event.eventId));
        } else if (event.payload.state === "interrupted" || event.payload.state === "cancelled") {
          yield* settleAbnormal(
            run,
            "The project-context agent was interrupted.",
            String(event.eventId),
            "interrupted",
          );
        } else {
          yield* settleAbnormal(
            run,
            event.payload.errorMessage ??
              `Provider turn ended with state '${event.payload.state}'.`,
            String(event.eventId),
            "failed",
          );
        }
        assistantText.delete(key);
        yield* stopSession(event.threadId).pipe(Effect.ignore);
        return;
      }
      if (event.type === "turn.aborted") {
        yield* settleAbnormal(
          run,
          "The project-context provider turn was aborted.",
          String(event.eventId),
          "interrupted",
        );
        assistantText.delete(key);
        yield* stopSession(event.threadId).pipe(Effect.ignore);
        return;
      }
      if (event.type === "runtime.error") {
        if (event.payload.class === "rate_limit") {
          yield* quota.markBlocked({
            providerInstanceId: run.providerInstanceId,
            resetAt: null,
            updatedAt: event.createdAt,
          });
        }
        yield* settleAbnormal(run, event.payload.message, String(event.eventId), "failed");
        assistantText.delete(key);
        yield* stopSession(event.threadId).pipe(Effect.ignore);
        return;
      }
      if (event.type === "request.opened" || event.type === "user-input.requested") {
        yield* settleAbnormal(
          run,
          "The project-context agent requested interactive access and was stopped.",
          String(event.eventId),
          "failed",
        );
        assistantText.delete(key);
        yield* providers.interruptTurn({ threadId: event.threadId }).pipe(Effect.ignore);
        yield* stopSession(event.threadId).pipe(Effect.ignore);
      }
    },
  );

  const domainWorker = yield* makeDrainableWorker((event: OrchestrationEvent) =>
    processDomainEvent(event).pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.void
          : Effect.logWarning("project-context domain event failed", {
              eventType: event.type,
              cause: Cause.pretty(cause),
            }),
      ),
    ),
  );
  const providerWorker = yield* makeDrainableWorker((event: ProviderRuntimeEvent) =>
    processProviderEvent(event).pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.void
          : Effect.logWarning("project-context provider event failed", {
              eventType: event.type,
              threadId: event.threadId,
              cause: Cause.pretty(cause),
            }),
      ),
    ),
  );

  const start: ProjectContextRunReactorShape["start"] = Effect.fn("ProjectContextRunReactor.start")(
    function* () {
      const domainEvents = yield* Stream.toQueue(engine.streamDomainEvents, {
        capacity: "unbounded",
      });
      const providerEvents = yield* Stream.toQueue(providers.streamEvents, {
        capacity: "unbounded",
      });
      yield* Effect.forkScoped(
        Stream.runForEach(Stream.fromQueue(domainEvents), (event) => domainWorker.enqueue(event)),
      );
      yield* Effect.forkScoped(
        Stream.runForEach(Stream.fromQueue(providerEvents), (event) =>
          providerWorker.enqueue(event),
        ),
      );
      yield* Effect.forkScoped(
        Stream.runForEach(Stream.fromQueue(quotaResetSchedules), (schedule) =>
          Effect.forkScoped(recoverScheduledQuotaReset(schedule)).pipe(Effect.asVoid),
        ),
      );
      yield* Effect.yieldNow;
      yield* reconcile;
    },
  );

  return {
    start,
    reconcile,
    drain: Effect.all([domainWorker.drain, providerWorker.drain], {
      concurrency: "unbounded",
      discard: true,
    }),
  } satisfies ProjectContextRunReactorShape;
});

export const ProjectContextRunReactorLive = Layer.effect(
  ProjectContextRunReactor,
  makeProjectContextRunReactor,
).pipe(
  Layer.provideMerge(ProjectionProjectContextRunRepositoryLive),
  Layer.provideMerge(ProviderQuotaStatusRepositoryLive),
);
