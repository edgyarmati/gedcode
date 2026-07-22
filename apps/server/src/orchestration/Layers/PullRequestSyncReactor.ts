import { CommandId, type OrchestrationEvent } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import { SourceControlProviderRegistry } from "../../sourceControl/SourceControlProviderRegistry.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import {
  PullRequestSyncReactor,
  type PullRequestSyncReactorShape,
} from "../Services/PullRequestSyncReactor.ts";
import {
  listTrackedPullRequests,
  synchronizeTrackedPullRequests,
} from "../trackedPullRequestSync.ts";

const DEFAULT_ACTIVE_POLL_INTERVAL_MS = 15_000;
const DEFAULT_BACKGROUND_POLL_INTERVAL_MS = 60_000;
const DEFAULT_FAILURE_RETRY_INTERVAL_MS = 60_000;
// `gh api --cache` persists an HTTP cache and sends conditional revalidation
// requests after this brief active window. Keep it smaller than the polling
// cadence so normal polling remains a lightweight ETag check rather than a
// stale in-memory result.
const CONDITIONAL_REQUEST_CACHE_TTL_SECONDS = 10;

export interface PullRequestSyncReactorLiveOptions {
  /** Kept injectable so the reactor is deterministic in focused tests. */
  readonly activePollIntervalMsOverride?: number;
  /** Stable tracked PRs use this lower-frequency cadence after their first check. */
  readonly backgroundPollIntervalMsOverride?: number;
  readonly failureRetryIntervalMsOverride?: number;
}

export const pullRequestPollDelayMs = (input: {
  readonly active: boolean;
  readonly retrying: boolean;
  readonly activePollIntervalMs: number;
  readonly backgroundPollIntervalMs: number;
  readonly failureRetryIntervalMs: number;
}): number =>
  input.retrying
    ? input.failureRetryIntervalMs
    : input.active
      ? input.activePollIntervalMs
      : input.backgroundPollIntervalMs;

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

const commandId = (kind: "merged" | "closed", taskId: string, prUrl: string): CommandId =>
  CommandId.make(`task-pr-${kind}:${taskId}:${prUrl}`);

type PullRequestLifecycleEvent = Extract<OrchestrationEvent, { readonly type: "task.pr-opened" }>;

export const makePullRequestSyncReactor = (options?: PullRequestSyncReactorLiveOptions) =>
  Effect.gen(function* () {
    const engine = yield* OrchestrationEngineService;
    const snapshots = yield* ProjectionSnapshotQuery;
    const providers = yield* SourceControlProviderRegistry;
    const semaphore = yield* Semaphore.make(1);
    const activePollIntervalMs =
      options?.activePollIntervalMsOverride ?? DEFAULT_ACTIVE_POLL_INTERVAL_MS;
    const backgroundPollIntervalMs =
      options?.backgroundPollIntervalMsOverride ?? DEFAULT_BACKGROUND_POLL_INTERVAL_MS;
    const failureRetryIntervalMs =
      options?.failureRetryIntervalMsOverride ?? DEFAULT_FAILURE_RETRY_INTERVAL_MS;
    let polling = false;

    const synchronize = Effect.fn("PullRequestSyncReactor.synchronize")(function* () {
      const readModel = yield* snapshots.getCommandReadModel();
      const tracked = listTrackedPullRequests(readModel);
      if (tracked.length === 0) return false;

      const results = yield* synchronizeTrackedPullRequests({
        tracked,
        getChangeRequest: (entry) =>
          Effect.gen(function* () {
            const handle = yield* providers.resolveHandle({ cwd: entry.cwd });
            return yield* handle.provider.getChangeRequest({
              cwd: entry.cwd,
              reference: entry.reference,
              cacheTtlSeconds: CONDITIONAL_REQUEST_CACHE_TTL_SECONDS,
            });
          }),
      });
      const createdAt = yield* nowIso;
      yield* Effect.forEach(
        results,
        (result) => {
          if (result.state === "open") return Effect.void;
          return engine.dispatch({
            type: result.state === "merged" ? "task.pr.merged" : "task.pr.closed",
            commandId: commandId(
              result.state,
              String(result.tracked.taskId),
              result.tracked.reference,
            ),
            taskId: result.tracked.taskId,
            prUrl: result.tracked.reference,
            createdAt,
          });
        },
        { concurrency: 1, discard: true },
      );
      // A merge/closure may have consumed the final tracked PR. Re-read the
      // durable projection after dispatch so the scheduler stops immediately
      // instead of sleeping through one needless background interval.
      if (results.some((result) => result.state !== "open")) {
        const nextReadModel = yield* snapshots.getCommandReadModel();
        return listTrackedPullRequests(nextReadModel).length > 0;
      }
      return true;
    });

    const synchronizeSafely = () =>
      semaphore
        .withPermits(1)(synchronize())
        .pipe(
          Effect.map((hasTrackedPullRequests) => ({ hasTrackedPullRequests, failed: false })),
          Effect.catchCause((cause) =>
            Effect.logWarning(
              "tracked pull-request synchronization failed; retaining durable retry",
              {
                cause: Cause.pretty(cause),
              },
            ).pipe(Effect.as({ hasTrackedPullRequests: true, failed: true })),
          ),
        );

    const startPolling = () => {
      if (polling) return Effect.void;
      polling = true;
      return Effect.forkScoped(
        Effect.gen(function* () {
          let retrying = false;
          let active = true;
          while (true) {
            yield* Effect.sleep(
              Duration.millis(
                pullRequestPollDelayMs({
                  active,
                  retrying,
                  activePollIntervalMs,
                  backgroundPollIntervalMs,
                  failureRetryIntervalMs,
                }),
              ),
            );
            const result = yield* synchronizeSafely();
            if (!result.hasTrackedPullRequests) return;
            retrying = result.failed;
            // A durable `task.pr-opened` triggers an immediate refresh in
            // `react`, so only the first queued background interval needs the
            // fast cadence. Healthy tracked PRs then cost one conditional
            // request per background interval.
            active = false;
          }
        }).pipe(Effect.ensuring(Effect.sync(() => (polling = false)))),
      );
    };

    const react = (event: PullRequestLifecycleEvent) =>
      Effect.gen(function* () {
        const result = yield* synchronizeSafely();
        if (result.hasTrackedPullRequests) {
          yield* startPolling();
        }
      }).pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.void
            : Effect.logWarning("pull-request sync reactor failed to process PR-open event", {
                taskId: String(event.payload.taskId),
                cause: Cause.pretty(cause),
              }),
        ),
      );

    const start: PullRequestSyncReactorShape["start"] = Effect.fn("start")(function* () {
      const liveEvents = yield* Stream.toQueue(engine.streamDomainEvents, {
        capacity: "unbounded",
      });
      const result = yield* synchronizeSafely();
      if (result.hasTrackedPullRequests) {
        yield* startPolling();
      }
      yield* Effect.forkScoped(
        Stream.fromQueue(liveEvents).pipe(
          Stream.filter(
            (event): event is PullRequestLifecycleEvent => event.type === "task.pr-opened",
          ),
          Stream.runForEach(react),
        ),
      );
    });

    return { start } satisfies PullRequestSyncReactorShape;
  });

export const makePullRequestSyncReactorLive = (options?: PullRequestSyncReactorLiveOptions) =>
  Layer.effect(PullRequestSyncReactor, makePullRequestSyncReactor(options));

export const PullRequestSyncReactorLive = makePullRequestSyncReactorLive();
