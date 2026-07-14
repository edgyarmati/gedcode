import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("052_ProjectionTaskSplitDetails", (it) => {
  it.effect("adds non-null empty split-detail arrays for existing tasks", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 51 });
      yield* runMigrations({ toMigrationInclusive: 52 });

      const columns = yield* sql<{
        readonly name: string;
        readonly notnull: number;
        readonly defaultValue: string | null;
      }>`
        SELECT name, "notnull", dflt_value AS "defaultValue"
        FROM pragma_table_info('projection_tasks')
      `;
      for (const name of ["acceptance_criteria_json", "depends_on_task_ids_json"]) {
        const column = columns.find((entry) => entry.name === name);
        assert.ok(column);
        assert.strictEqual(column.notnull, 1);
        assert.strictEqual(column.defaultValue, "'[]'");
      }
    }),
  );
});
