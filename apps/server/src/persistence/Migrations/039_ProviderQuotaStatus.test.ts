import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("039_ProviderQuotaStatus", (it) => {
  it.effect("creates provider quota status projection table", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 39 });

      const columns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_provider_quota_status)
      `;
      assert.ok(columns.some((column) => column.name === "provider_instance_id"));
      assert.ok(columns.some((column) => column.name === "status"));
      assert.ok(columns.some((column) => column.name === "reset_at"));
      assert.ok(columns.some((column) => column.name === "updated_at"));
    }),
  );

  it.effect("is idempotent when migrations re-run on an already-migrated DB", () =>
    Effect.gen(function* () {
      yield* runMigrations({ toMigrationInclusive: 39 });

      const replay = yield* runMigrations({ toMigrationInclusive: 39 });
      assert.ok(replay.every(([id]) => id !== 39));

      const sql = yield* SqlClient.SqlClient;
      const recorded = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count
        FROM effect_sql_migrations
        WHERE migration_id = 39
      `;
      assert.strictEqual(recorded[0]?.count, 1);
    }),
  );
});
