import {
  CommandId,
  type OrchestrationReadModel,
  type OrchestrationSession,
  type ProviderSession,
  type ThreadId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import {
  OrphanTurnReconciler,
  type OrphanTurnReconcilerShape,
} from "../Services/OrphanTurnReconciler.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
const RECONCILE_LAST_ERROR = "Provider session was not live during server startup reconciliation.";

export interface OrphanedStageSession {
  readonly threadId: ThreadId;
  readonly session: OrchestrationSession & {
    readonly activeTurnId: NonNullable<OrchestrationSession["activeTurnId"]>;
  };
}

export function findOrphanedStageSessions(input: {
  readonly readModel: OrchestrationReadModel;
  readonly liveProviderSessions: ReadonlyArray<ProviderSession>;
}): ReadonlyArray<OrphanedStageSession> {
  const stageThreadIds = new Set(
    input.readModel.tasks.flatMap((task) =>
      task.stageThreadIds.map((threadId) => String(threadId)),
    ),
  );
  const liveThreadIds = new Set(
    input.liveProviderSessions.map((session) => String(session.threadId)),
  );

  return input.readModel.threads.flatMap((thread) => {
    const session = thread.session;
    if (!stageThreadIds.has(String(thread.id))) {
      return [];
    }
    if (liveThreadIds.has(String(thread.id))) {
      return [];
    }
    if (session?.status !== "running" || session.activeTurnId === null) {
      return [];
    }
    return [
      {
        threadId: thread.id,
        session: {
          ...session,
          activeTurnId: session.activeTurnId,
        },
      },
    ];
  });
}

function interruptedSession(
  session: OrphanedStageSession["session"],
  updatedAt: string,
): OrchestrationSession {
  return {
    ...session,
    status: "interrupted",
    activeTurnId: null,
    lastError: RECONCILE_LAST_ERROR,
    updatedAt,
  };
}

const make = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const providerService = yield* ProviderService;

  const reconcileOnce = Effect.fn("OrphanTurnReconciler.reconcileOnce")(function* () {
    const readModel = yield* projectionSnapshotQuery.getSnapshot();
    const liveProviderSessions = yield* providerService.listSessions();
    const orphanedSessions = findOrphanedStageSessions({
      readModel,
      liveProviderSessions,
    });
    if (orphanedSessions.length === 0) {
      return 0;
    }

    const updatedAt = yield* nowIso;
    yield* Effect.forEach(
      orphanedSessions,
      ({ threadId, session }) =>
        orchestrationEngine
          .dispatch({
            type: "thread.session.set",
            commandId: CommandId.make(
              `server:orphan-turn-reconcile:${String(threadId)}:${String(session.activeTurnId)}`,
            ),
            threadId,
            session: interruptedSession(session, updatedAt),
            createdAt: updatedAt,
          })
          .pipe(Effect.asVoid),
      { discard: true, concurrency: 4 },
    );

    yield* Effect.logInfo("orphan turn reconciler repaired stage turns", {
      count: orphanedSessions.length,
    });
    return orphanedSessions.length;
  });

  const reconcile: OrphanTurnReconcilerShape["reconcile"] = () =>
    reconcileOnce().pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("orphan turn reconciler failed", {
          cause: Cause.pretty(cause),
        }).pipe(Effect.as(0)),
      ),
    );

  return {
    reconcile,
  } satisfies OrphanTurnReconcilerShape;
});

export const OrphanTurnReconcilerLive = Layer.effect(OrphanTurnReconciler, make);
