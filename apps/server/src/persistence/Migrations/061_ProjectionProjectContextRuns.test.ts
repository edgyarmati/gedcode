import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()))(
  "061_ProjectionProjectContextRuns",
  (it) => {
    it.effect("creates durable context-run lifecycle storage and lookup indexes", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations({ toMigrationInclusive: 61 });
        const tables = yield* sql<{ readonly name: string }>`
          SELECT name FROM sqlite_master
          WHERE type = 'table' AND name = 'projection_project_context_runs'
        `;
        const indexes = yield* sql<{ readonly name: string; readonly sql: string }>`
          SELECT name, sql FROM sqlite_master
          WHERE type = 'index'
            AND tbl_name = 'projection_project_context_runs'
            AND name LIKE 'projection_project_context_runs_%'
          ORDER BY name
        `;
        assert.strictEqual(tables[0]?.name, "projection_project_context_runs");
        assert.deepStrictEqual(
          indexes.map((row) => row.name),
          [
            "projection_project_context_runs_active_idx",
            "projection_project_context_runs_project_updated_idx",
          ],
        );
        assert.match(indexes[0]?.sql ?? "", /pending-review/);
      }),
    );
  },
);
