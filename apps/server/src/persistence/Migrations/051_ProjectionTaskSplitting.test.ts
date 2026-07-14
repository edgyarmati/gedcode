import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("051_ProjectionTaskSplitting", (it) => {
  it.effect("adds nullable task hierarchy columns and unique sibling order", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 50 });
      yield* runMigrations({ toMigrationInclusive: 51 });

      const columns = yield* sql<{ readonly name: string; readonly notnull: number }>`
        PRAGMA table_info(projection_tasks)
      `;
      for (const name of ["parent_task_id", "child_order", "aggregate_progress_json"]) {
        const column = columns.find((entry) => entry.name === name);
        assert.ok(column);
        assert.strictEqual(column.notnull, 0);
      }
      const indexes = yield* sql<{ readonly name: string; readonly unique: number }>`
        PRAGMA index_list(projection_tasks)
      `;
      assert.ok(
        indexes.some(
          (index) => index.name === "idx_projection_tasks_parent_child_order" && index.unique === 1,
        ),
      );
    }),
  );
});
