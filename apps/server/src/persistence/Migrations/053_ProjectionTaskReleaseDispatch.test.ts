import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("053_ProjectionTaskReleaseDispatch", (it) => {
  it.effect("adds nullable durable release dispatch state", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 52 });
      yield* runMigrations({ toMigrationInclusive: 53 });
      const columns = yield* sql<{ readonly name: string; readonly notnull: number }>`
        SELECT name, "notnull" FROM pragma_table_info('projection_tasks')
      `;
      const column = columns.find((entry) => entry.name === "release_dispatch_json");
      assert.ok(column);
      assert.strictEqual(column.notnull, 0);
    }),
  );
});
