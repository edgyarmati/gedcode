import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("038_PmConsumedSettlementsStatus", (it) => {
  it.effect("adds status to pm_consumed_settlements", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 37 });
      yield* runMigrations({ toMigrationInclusive: 38 });

      const columns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(pm_consumed_settlements)
      `;
      assert.ok(columns.some((column) => column.name === "status"));
    }),
  );

  it.effect("backfills existing consumed markers to acted", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 36 });
      yield* sql`
        INSERT INTO pm_consumed_settlements (project_id, kind, settlement_key, consumed_at)
        VALUES ('project-1', 'stage', 'thread-1::turn-1', '2026-06-14T00:00:00.000Z')
      `;

      yield* runMigrations({ toMigrationInclusive: 38 });

      const rows = yield* sql<{ readonly status: string }>`
        SELECT status
        FROM pm_consumed_settlements
        WHERE project_id = 'project-1'
      `;
      assert.strictEqual(rows[0]?.status, "acted");
    }),
  );

  it.effect("is idempotent when migrations re-run on an already-migrated DB", () =>
    Effect.gen(function* () {
      yield* runMigrations({ toMigrationInclusive: 38 });

      const replay = yield* runMigrations({ toMigrationInclusive: 38 });
      assert.ok(replay.every(([id]) => id !== 38));

      const sql = yield* SqlClient.SqlClient;
      const recorded = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count
        FROM effect_sql_migrations
        WHERE migration_id = 38
      `;
      assert.strictEqual(recorded[0]?.count, 1);
    }),
  );
});
