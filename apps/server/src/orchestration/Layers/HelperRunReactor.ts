import {
  CommandId,
  HELPER_RUN_FAILURE_MAX_CHARS,
  HELPER_RUN_RESULT_MAX_CHARS,
  HelperRunId,
  ThreadId,
  type OrchestrationEvent,
  type OrchestrationHelperRun,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { ProjectionHelperRunRepositoryLive } from "../../persistence/Layers/ProjectionHelperRuns.ts";
import { ProviderQuotaStatusRepositoryLive } from "../../persistence/Layers/ProviderQuotaStatus.ts";
import { ProjectionHelperRunRepository } from "../../persistence/Services/ProjectionHelperRuns.ts";
import { ProviderQuotaStatusRepository } from "../../persistence/Services/ProviderQuotaStatus.ts";
import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { HelperRunReactor, type HelperRunReactorShape } from "../Services/HelperRunReactor.ts";
import { sanitizeHelperResult } from "../helperRunContext.ts";

const HELPER_THREAD_PREFIX = "helper:";
const HELPER_SYSTEM_PROMPT = [
  "You are a bounded read-only exploration helper.",
  "Inspect only the supplied project or task checkout. Do not edit files, run mutating commands, delegate to another agent, or ask the user questions.",
  "Return a concise evidence-based result for the requesting project manager or subsequent worker stage.",
].join(" ");
const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

export const helperRunThreadId = (helperRunId: HelperRunId): ThreadId =>
  ThreadId.make(`${HELPER_THREAD_PREFIX}${helperRunId}`);

const helperCommandId = (kind: string, helperRunId: HelperRunId, source = "runtime"): CommandId =>
  CommandId.make(`server:helper-${kind}:${helperRunId}:${source}`);

const boundedFailure = (message: string): string => {
  const trimmed = message.trim();
  return (trimmed.length > 0 ? trimmed : "Helper run failed.").slice(
    0,
    HELPER_RUN_FAILURE_MAX_CHARS,
  );
};

const isoFromEpochMs = (value: number | undefined): string | null =>
  value === undefined || !Number.isFinite(value) || value <= 0
    ? null
    : DateTime.formatIso(DateTime.makeUnsafe(value));

export const makeHelperRunReactor = Effect.gen(function* () {
  const engine = yield* OrchestrationEngineService;
  const snapshots = yield* ProjectionSnapshotQuery;
  const helpers = yield* ProjectionHelperRunRepository;
  const quota = yield* ProviderQuotaStatusRepository;
  const providers = yield* ProviderService;
  const fileSystem = yield* FileSystem.FileSystem;
  const helperByThread = new Map<string, HelperRunId>();
  const assistantText = new Map<string, string>();
  const starting = new Set<string>();

  const remember = (run: OrchestrationHelperRun) => {
    const threadId = run.providerThreadId ?? helperRunThreadId(run.id);
    helperByThread.set(String(threadId), run.id);
    return threadId;
  };

  const stopSession = (threadId: ThreadId) =>
    providers.stopSession({ threadId }).pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.void
          : Effect.logDebug("helper run session was already stopped", {
              threadId,
              cause: Cause.pretty(cause),
            }),
      ),
    );

  const failRun = Effect.fn("HelperRunReactor.failRun")(function* (
    run: OrchestrationHelperRun,
    message: string,
    source: string,
  ) {
    const fresh = yield* helpers.getById({ helperRunId: run.id });
    if (
      fresh._tag !== "Some" ||
      (fresh.value.status !== "pending" && fresh.value.status !== "running")
    ) {
      return;
    }
    yield* engine.dispatch({
      type: "helper.run.fail",
      commandId: helperCommandId("fail", run.id, source),
      helperRunId: run.id,
      message: boundedFailure(message),
      createdAt: yield* nowIso,
    });
    yield* stopSession(remember(run)).pipe(Effect.ignore);
  });

  const resolveCwd = Effect.fn("HelperRunReactor.resolveCwd")(function* (
    run: OrchestrationHelperRun,
  ) {
    const readModel = yield* snapshots.getCommandReadModel();
    const project = readModel.projects.find((entry) => entry.id === run.projectId);
    if (project === undefined) throw new Error(`Project '${run.projectId}' no longer exists.`);
    if (run.attachment.kind === "pm") return project.workspaceRoot;
    const taskId = run.attachment.taskId;
    const task = readModel.tasks.find((entry) => entry.id === taskId);
    if (task === undefined || task.projectId !== run.projectId) {
      throw new Error(`Task '${run.attachment.taskId}' no longer belongs to this project.`);
    }
    if (task.worktreePath === null) {
      throw new Error(`Task '${task.id}' has no provisioned worktree.`);
    }
    return task.worktreePath;
  });

  const launch = Effect.fn("HelperRunReactor.launch")(function* (run: OrchestrationHelperRun) {
    const key = String(run.id);
    if (starting.has(key)) return;
    starting.add(key);
    yield* Effect.gen(function* () {
      const cwd = yield* resolveCwd(run);
      if (!(yield* fileSystem.exists(cwd))) {
        return yield* failRun(
          run,
          `Helper workspace '${cwd}' does not exist.`,
          "missing-workspace",
        );
      }
      const quotaState = yield* quota.isInstanceQuotaBlocked({
        providerInstanceId: run.providerInstanceId,
      });
      if (quotaState.blocked) {
        yield* Effect.logInfo("helper run held because its provider is quota-blocked", {
          helperRunId: run.id,
          providerInstanceId: run.providerInstanceId,
          resetAt: quotaState.resetAt,
        });
        return;
      }

      const threadId = remember(run);
      const active = (yield* providers.listSessions()).find(
        (session) => session.threadId === threadId,
      );
      if (run.status === "running" && active !== undefined) return;
      const info = yield* providers.getInstanceInfo(run.providerInstanceId);
      const session = yield* providers.startSession(threadId, {
        threadId,
        provider: info.driverKind,
        providerInstanceId: run.providerInstanceId,
        cwd,
        modelSelection: {
          instanceId: run.providerInstanceId,
          model: run.model,
          ...(run.modelOptions === null ? {} : { options: run.modelOptions }),
        },
        runtimeMode: "approval-required",
        readOnly: true,
        enableOrchestrationTools: false,
        systemPromptAppend: HELPER_SYSTEM_PROMPT,
      });
      if (run.status === "pending") {
        yield* engine.dispatch({
          type: "helper.run.start",
          commandId: helperCommandId("start", run.id),
          helperRunId: run.id,
          providerThreadId: session.threadId,
          createdAt: yield* nowIso,
        });
      }
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

  const reconcile: HelperRunReactorShape["reconcile"] = helpers.listAll().pipe(
    Effect.flatMap((runs) =>
      Effect.forEach(
        runs.filter((run) => run.status === "pending" || run.status === "running"),
        launch,
        { concurrency: 1, discard: true },
      ),
    ),
    Effect.catchCause((cause) =>
      Cause.hasInterruptsOnly(cause)
        ? Effect.void
        : Effect.logWarning("helper run reconciliation failed", { cause: Cause.pretty(cause) }),
    ),
  );

  const processDomainEvent = Effect.fn("HelperRunReactor.processDomainEvent")(function* (
    event: OrchestrationEvent,
  ) {
    if (event.type === "helper.run-requested") {
      const run = yield* helpers.getById({ helperRunId: event.payload.helperRunId });
      if (run._tag === "Some") yield* launch(run.value);
      return;
    }
    if (event.type === "helper.run-interrupted") {
      const threadId = helperRunThreadId(event.payload.helperRunId);
      yield* providers.interruptTurn({ threadId }).pipe(Effect.ignore);
      yield* stopSession(threadId).pipe(Effect.ignore);
      assistantText.delete(String(event.payload.helperRunId));
    }
  });

  const processProviderEvent = Effect.fn("HelperRunReactor.processProviderEvent")(function* (
    event: ProviderRuntimeEvent,
  ) {
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
    const helperRunId = helperByThread.get(String(event.threadId));
    if (helperRunId === undefined) return;
    const current = yield* helpers.getById({ helperRunId });
    if (current._tag !== "Some" || current.value.status !== "running") return;
    const run = current.value;
    const key = String(helperRunId);

    if (event.type === "content.delta" && event.payload.streamKind === "assistant_text") {
      const next = `${assistantText.get(key) ?? ""}${event.payload.delta}`.slice(
        0,
        HELPER_RUN_RESULT_MAX_CHARS,
      );
      assistantText.set(key, next);
      return;
    }
    if (
      event.type === "item.completed" &&
      event.payload.itemType === "assistant_message" &&
      (assistantText.get(key)?.length ?? 0) === 0 &&
      event.payload.detail !== undefined
    ) {
      assistantText.set(key, event.payload.detail.slice(0, HELPER_RUN_RESULT_MAX_CHARS));
      return;
    }
    if (event.type === "turn.completed") {
      if (event.payload.state === "completed") {
        yield* engine.dispatch({
          type: "helper.run.complete",
          commandId: helperCommandId("complete", helperRunId, String(event.eventId)),
          helperRunId,
          result: sanitizeHelperResult(assistantText.get(key) ?? ""),
          createdAt: event.createdAt,
        });
      } else if (event.payload.state === "interrupted" || event.payload.state === "cancelled") {
        yield* engine.dispatch({
          type: "helper.run.interrupt",
          commandId: helperCommandId("interrupt", helperRunId, String(event.eventId)),
          helperRunId,
          createdAt: event.createdAt,
        });
      } else {
        yield* failRun(
          run,
          event.payload.errorMessage ?? `Provider turn ended with state '${event.payload.state}'.`,
          String(event.eventId),
        );
      }
      assistantText.delete(key);
      yield* stopSession(event.threadId).pipe(Effect.ignore);
      return;
    }
    if (event.type === "turn.aborted") {
      yield* engine.dispatch({
        type: "helper.run.interrupt",
        commandId: helperCommandId("interrupt", helperRunId, String(event.eventId)),
        helperRunId,
        createdAt: event.createdAt,
      });
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
      yield* failRun(run, event.payload.message, String(event.eventId));
      assistantText.delete(key);
      return;
    }
    if (event.type === "request.opened" || event.type === "user-input.requested") {
      yield* failRun(
        run,
        "The read-only helper requested interactive access and was stopped.",
        String(event.eventId),
      );
      assistantText.delete(key);
    }
  });

  const domainWorker = yield* makeDrainableWorker((event: OrchestrationEvent) =>
    processDomainEvent(event).pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.void
          : Effect.logWarning("helper run domain event failed", {
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
          : Effect.logWarning("helper run provider event failed", {
              eventType: event.type,
              threadId: event.threadId,
              cause: Cause.pretty(cause),
            }),
      ),
    ),
  );

  const start: HelperRunReactorShape["start"] = Effect.fn("HelperRunReactor.start")(function* () {
    // Establish both hot-stream subscriptions before reconciliation. A helper
    // can finish immediately after sendTurn, so subscribing afterward can lose
    // its terminal event and leave the persisted run stuck as running.
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
      Stream.runForEach(Stream.fromQueue(providerEvents), (event) => providerWorker.enqueue(event)),
    );
    // Let the queue producer fibers acquire their upstream subscriptions before
    // reconciliation can start provider turns that may emit immediately.
    yield* Effect.yieldNow;
    yield* reconcile;
  });

  return {
    start,
    reconcile,
    drain: Effect.all([domainWorker.drain, providerWorker.drain], {
      concurrency: "unbounded",
      discard: true,
    }),
  } satisfies HelperRunReactorShape;
});

export const HelperRunReactorLive = Layer.effect(HelperRunReactor, makeHelperRunReactor).pipe(
  Layer.provideMerge(ProjectionHelperRunRepositoryLive),
  Layer.provideMerge(ProviderQuotaStatusRepositoryLive),
);
