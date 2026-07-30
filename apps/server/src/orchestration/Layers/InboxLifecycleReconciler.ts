import { CommandId, type OrchestrationReadModel, type ThreadId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";

import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import {
  InboxLifecycleReconciler,
  type InboxLifecycleReconcilerShape,
} from "../Services/InboxLifecycleReconciler.ts";

const DEFAULT_RECONCILIATION_INTERVAL = Duration.minutes(1);

type DueInboxWake = {
  readonly threadId: ThreadId;
  readonly wakeAt: string;
};

export function findDueInboxWakes(
  readModel: OrchestrationReadModel,
  now: string,
): ReadonlyArray<DueInboxWake> {
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)) return [];
  return readModel.threads.flatMap((thread) => {
    if (
      thread.orchestrationOwnership != null ||
      thread.inboxLifecycle !== "snoozed" ||
      thread.inboxWakeAt == null
    ) {
      return [];
    }
    const wakeAtMs = Date.parse(thread.inboxWakeAt);
    return Number.isFinite(wakeAtMs) && wakeAtMs <= nowMs
      ? [{ threadId: thread.id, wakeAt: thread.inboxWakeAt }]
      : [];
  });
}

export const makeInboxLifecycleReconciler = (options?: {
  readonly reconciliationIntervalMs?: number;
}) =>
  Effect.gen(function* () {
    const engine = yield* OrchestrationEngineService;
    const snapshots = yield* ProjectionSnapshotQuery;
    const interval = Duration.millis(
      Math.max(
        1,
        options?.reconciliationIntervalMs ?? Duration.toMillis(DEFAULT_RECONCILIATION_INTERVAL),
      ),
    );

    const reconcile: InboxLifecycleReconcilerShape["reconcile"] = () =>
      Effect.gen(function* () {
        const reconciledAt = DateTime.formatIso(yield* DateTime.now);
        const due = findDueInboxWakes(yield* snapshots.getCommandReadModel(), reconciledAt);
        const results = yield* Effect.forEach(
          due,
          (wake) =>
            engine
              .dispatch({
                type: "thread.inbox.wake-due",
                commandId: CommandId.make(
                  `server:thread-inbox-wake-due:${wake.threadId}:${wake.wakeAt}`,
                ),
                threadId: wake.threadId,
              })
              .pipe(
                Effect.as(true),
                Effect.catchCause((cause) =>
                  Effect.logWarning("Inbox lifecycle wake reconciliation failed", {
                    threadId: wake.threadId,
                    wakeAt: wake.wakeAt,
                    cause: Cause.pretty(cause),
                  }).pipe(Effect.as(false)),
                ),
              ),
          { concurrency: 4 },
        );
        return results.filter(Boolean).length;
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Inbox lifecycle reconciliation failed", {
            cause: Cause.pretty(cause),
          }).pipe(Effect.as(0)),
        ),
      );

    const start: InboxLifecycleReconcilerShape["start"] = () =>
      Effect.gen(function* () {
        yield* reconcile();
        yield* Effect.forkScoped(reconcile().pipe(Effect.repeat(Schedule.spaced(interval))));
      });

    return { start, reconcile } satisfies InboxLifecycleReconcilerShape;
  });

export const InboxLifecycleReconcilerLive = Layer.effect(
  InboxLifecycleReconciler,
  makeInboxLifecycleReconciler(),
);
