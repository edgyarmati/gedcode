import { assert, it } from "@effect/vitest";
import { OrchestratorProjectConfig } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

const decodeConfigJson = Schema.decodeUnknownSync(Schema.fromJsonString(OrchestratorProjectConfig));

layer("037_ProjectionProjectOrchestratorConfig", (it) => {
  it.effect("adds orchestrator_config_json to projection_projects on a fresh DB", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 36 });
      yield* runMigrations({ toMigrationInclusive: 37 });

      const columns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_projects)
      `;
      assert.ok(columns.some((column) => column.name === "orchestrator_config_json"));
    }),
  );

  it.effect("default '{}' decodes to a safe-by-default OrchestratorProjectConfig", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 37 });

      yield* sql`
        INSERT INTO projection_projects (
          project_id, title, workspace_root, scripts_json, created_at, updated_at
        )
        VALUES (
          'project-1', 'Project 1', '/tmp/project-1', '[]',
          '2026-06-14T00:00:00.000Z', '2026-06-14T00:00:00.000Z'
        )
      `;

      const rows = yield* sql<{ readonly orchestrator_config_json: string }>`
        SELECT orchestrator_config_json
        FROM projection_projects
        WHERE project_id = 'project-1'
      `;
      const raw = rows[0]?.orchestrator_config_json;
      assert.strictEqual(raw, "{}");

      // The default JSON must decode to the fail-closed config: orchestrator
      // disabled and full-access workers forbidden (the runtime-mode clamp anchor).
      const config = decodeConfigJson(raw ?? "{}");
      assert.strictEqual(config.enabled, false);
      assert.strictEqual(config.resourceLimits.allowFullAccessWorkers, false);
    }),
  );

  it.effect("is idempotent when migrations re-run on an already-migrated DB", () =>
    Effect.gen(function* () {
      yield* runMigrations({ toMigrationInclusive: 37 });

      const replay = yield* runMigrations({ toMigrationInclusive: 37 });
      assert.ok(replay.every(([id]) => id !== 37));

      const sql = yield* SqlClient.SqlClient;
      const recorded = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count
        FROM effect_sql_migrations
        WHERE migration_id = 37
      `;
      assert.strictEqual(recorded[0]?.count, 1);
    }),
  );
});
