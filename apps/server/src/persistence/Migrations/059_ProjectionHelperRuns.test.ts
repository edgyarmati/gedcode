import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()))("059_ProjectionHelperRuns", (it) => {
  it.effect("creates durable helper lifecycle storage and lookup indexes", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 59 });
      const tables = yield* sql<{ readonly name: string }>`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name = 'projection_helper_runs'
      `;
      const indexes = yield* sql<{ readonly name: string }>`
        SELECT name FROM sqlite_master
        WHERE type = 'index'
          AND tbl_name = 'projection_helper_runs'
          AND name LIKE 'projection_helper_runs_%'
        ORDER BY name
      `;
      assert.strictEqual(tables[0]?.name, "projection_helper_runs");
      assert.deepStrictEqual(
        indexes.map((row) => row.name),
        ["projection_helper_runs_project_idx", "projection_helper_runs_status_idx"],
      );
    }),
  );
});
