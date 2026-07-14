import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("049_ProjectionTaskSupersession", (it) => {
  it.effect("adds nullable bidirectional replacement columns and a unique predecessor index", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 48 });
      yield* runMigrations({ toMigrationInclusive: 49 });

      const columns = yield* sql<{ readonly name: string; readonly notnull: number }>`
        PRAGMA table_info(projection_tasks)
      `;
      for (const name of ["supersedes_task_id", "superseded_by_task_id"]) {
        const column = columns.find((entry) => entry.name === name);
        assert.ok(column);
        assert.strictEqual(column.notnull, 0);
      }
      const indexes = yield* sql<{ readonly name: string; readonly unique: number }>`
        PRAGMA index_list(projection_tasks)
      `;
      assert.ok(
        indexes.some(
          (index) => index.name === "idx_projection_tasks_superseded_by" && index.unique === 1,
        ),
      );
    }),
  );
});
