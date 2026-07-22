import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()))(
  "071_PmLifecycleDeliveryRecovery",
  (it) => {
    it.effect("adds durable PM delivery and helper retry recovery state", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations({ toMigrationInclusive: 70 });

        yield* runMigrations({ toMigrationInclusive: 71 });
        const pmColumns = yield* sql<{ readonly name: string }>`
        SELECT name FROM pragma_table_info('pm_consumed_settlements')
        WHERE name IN ('retry_attempts', 'hold_reason', 'next_retry_at')
        ORDER BY name ASC
      `;
        const helperColumns = yield* sql<{ readonly name: string }>`
        SELECT name FROM pragma_table_info('projection_helper_runs')
        WHERE name = 'transient_retry_count'
      `;

        assert.deepStrictEqual(pmColumns, [
          { name: "hold_reason" },
          { name: "next_retry_at" },
          { name: "retry_attempts" },
        ]);
        assert.deepStrictEqual(helperColumns, [{ name: "transient_retry_count" }]);
      }),
    );
  },
);
