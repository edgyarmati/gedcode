import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()))("065_ProjectionStageStartHead", (it) => {
  it.effect("adds a nullable stage baseline without disturbing existing history", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 64 });
      yield* sql`
        INSERT INTO projection_stage_history (
          stage_thread_id, project_id, task_id, role, provider_instance_id, model,
          status, started_at, ended_at
        ) VALUES (
          'stage-before-065', 'project', 'task', 'verify', 'codex', 'gpt',
          'running', '2026-07-21T00:00:00.000Z', NULL
        )
      `;

      yield* runMigrations({ toMigrationInclusive: 65 });
      yield* sql`
        UPDATE projection_stage_history
        SET start_head = 'abc123'
        WHERE stage_thread_id = 'stage-before-065'
      `;
      const rows = yield* sql<{ readonly startHead: string }>`
        SELECT start_head AS "startHead"
        FROM projection_stage_history
        WHERE stage_thread_id = 'stage-before-065'
      `;
      assert.deepStrictEqual(rows, [{ startHead: "abc123" }]);
    }),
  );
});
