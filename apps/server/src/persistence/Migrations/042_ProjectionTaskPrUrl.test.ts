import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("042_ProjectionTaskPrUrl", (it) => {
  it.effect("adds a nullable pr_url column to projection_tasks", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 41 });
      yield* runMigrations({ toMigrationInclusive: 42 });

      const columns = yield* sql<{
        readonly name: string;
        readonly notnull: number;
      }>`
        PRAGMA table_info(projection_tasks)
      `;
      const prUrlColumn = columns.find((column) => column.name === "pr_url");
      assert.ok(prUrlColumn);
      assert.strictEqual(prUrlColumn.notnull, 0);
    }),
  );

  it.effect("is idempotent when migrations re-run on an already-migrated DB", () =>
    Effect.gen(function* () {
      yield* runMigrations({ toMigrationInclusive: 42 });

      const replay = yield* runMigrations({ toMigrationInclusive: 42 });
      assert.ok(replay.every(([id]) => id !== 42));

      const sql = yield* SqlClient.SqlClient;
      const recorded = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count
        FROM effect_sql_migrations
        WHERE migration_id = 42
      `;
      assert.strictEqual(recorded[0]?.count, 1);
    }),
  );
});
