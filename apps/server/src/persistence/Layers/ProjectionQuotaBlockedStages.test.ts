import { ProviderInstanceId, TaskId, ThreadId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ProjectionQuotaBlockedStageRepository } from "../Services/ProjectionQuotaBlockedStages.ts";
import { SqlitePersistenceMemory } from "./Sqlite.ts";
import { ProjectionQuotaBlockedStageRepositoryLive } from "./ProjectionQuotaBlockedStages.ts";

const TestLayer = ProjectionQuotaBlockedStageRepositoryLive.pipe(
  Layer.provide(SqlitePersistenceMemory),
);
const layer = it.layer(Layer.fresh(TestLayer));

layer("ProjectionQuotaBlockedStageRepository", (it) => {
  it.effect("stores blocked stages and filters open rows by provider", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectionQuotaBlockedStageRepository;
      const providerInstanceId = ProviderInstanceId.make("codex");

      yield* repository.upsert({
        taskId: TaskId.make("task-1"),
        stageThreadId: ThreadId.make("stage-1"),
        role: "work",
        providerInstanceId,
        resetAt: null,
        status: "blocked",
        retryCount: 1,
        blockedAt: "2026-06-21T10:00:00.000Z",
        resumedAt: null,
      });
      yield* repository.upsert({
        taskId: TaskId.make("task-1"),
        stageThreadId: ThreadId.make("stage-1"),
        role: "work",
        providerInstanceId,
        resetAt: null,
        status: "resumed",
        retryCount: 1,
        blockedAt: "2026-06-21T10:00:00.000Z",
        resumedAt: "2026-06-21T10:05:00.000Z",
      });
      yield* repository.upsert({
        taskId: TaskId.make("task-2"),
        stageThreadId: ThreadId.make("stage-2"),
        role: "plan",
        providerInstanceId,
        resetAt: "2026-06-21T11:00:00.000Z",
        status: "blocked",
        retryCount: 2,
        blockedAt: "2026-06-21T10:10:00.000Z",
        resumedAt: null,
      });

      const taskRows = yield* repository.listByTaskId({ taskId: TaskId.make("task-1") });
      assert.deepStrictEqual(
        taskRows.map((row) => ({ stageThreadId: row.stageThreadId, status: row.status })),
        [{ stageThreadId: ThreadId.make("stage-1"), status: "resumed" }],
      );

      const blockedRows = yield* repository.listBlockedByProviderInstanceId({
        providerInstanceId,
      });
      assert.deepStrictEqual(
        blockedRows.map((row) => ({
          taskId: row.taskId,
          status: row.status,
          retryCount: row.retryCount,
        })),
        [{ taskId: TaskId.make("task-2"), status: "blocked", retryCount: 2 }],
      );
    }),
  );
});
