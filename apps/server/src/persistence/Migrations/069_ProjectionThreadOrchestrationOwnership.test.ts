import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("069_ProjectionThreadOrchestrationOwnership", (it) => {
  it.effect("adds a nullable ownership column without backfilling legacy threads", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 68 });
      yield* sql`
        INSERT INTO projection_threads (
          thread_id, project_id, title, model_selection_json, runtime_mode, interaction_mode,
          created_at, updated_at
        ) VALUES (
          'legacy-thread', 'project-1', 'Legacy thread',
          '{"instanceId":"codex","model":"gpt-5"}', 'full-access', 'default',
          '2026-07-22T00:00:00.000Z', '2026-07-22T00:00:00.000Z'
        )
      `;

      yield* runMigrations({ toMigrationInclusive: 69 });
      const rows = yield* sql<{ readonly ownership: string | null }>`
        SELECT orchestration_ownership_json AS "ownership"
        FROM projection_threads
        WHERE thread_id = 'legacy-thread'
      `;
      assert.strictEqual(rows[0]?.ownership, null);
    }),
  );
});
