import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("055_RemoveLegacyOrchestrationStageHistory", (it) => {
  it.effect("removes only retired stage-history rows", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 54 });

      for (const [threadId, role] of [
        ["thread-classify", "classify"],
        ["thread-plan", "plan"],
        ["thread-review", "review"],
        ["thread-work", "work"],
        ["thread-verify", "verify"],
      ] as const) {
        yield* sql`
          INSERT INTO projection_stage_history (
            stage_thread_id,
            project_id,
            task_id,
            role,
            provider_instance_id,
            model,
            runtime_mode,
            status,
            started_at,
            ended_at
          ) VALUES (
            ${threadId},
            'project-1',
            'task-1',
            ${role},
            'codex',
            'gpt-test',
            'auto-accept-edits',
            'completed',
            '2026-07-16T00:00:00.000Z',
            '2026-07-16T00:01:00.000Z'
          )
        `;
      }

      yield* runMigrations({ toMigrationInclusive: 55 });

      const rows = yield* sql<{ readonly role: string; readonly stageThreadId: string }>`
        SELECT stage_thread_id AS "stageThreadId", role
        FROM projection_stage_history
        ORDER BY stage_thread_id
      `;
      assert.deepStrictEqual(rows, [
        { stageThreadId: "thread-plan", role: "plan" },
        { stageThreadId: "thread-verify", role: "verify" },
        { stageThreadId: "thread-work", role: "work" },
      ]);
    }),
  );
});
