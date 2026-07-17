import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("056_ProjectionTaskCompletionRecords", (it) => {
  it.effect("adds nullable change review, verification, and no-change records", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 55 });
      yield* runMigrations({ toMigrationInclusive: 56 });
      const columns = yield* sql<{ readonly name: string; readonly notnull: number }>`
        SELECT name, "notnull" FROM pragma_table_info('projection_tasks')
      `;
      for (const name of ["change_review_json", "verification_json", "no_changes_needed_json"]) {
        const column = columns.find((entry) => entry.name === name);
        assert.ok(column);
        assert.strictEqual(column.notnull, 0);
      }
    }),
  );
});
