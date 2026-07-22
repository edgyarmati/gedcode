import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()))(
  "073_PmLifecycleDeliveryEpisodes",
  (it) => {
    it.effect("adds a durable lifecycle delivery episode counter", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations({ toMigrationInclusive: 72 });

        yield* runMigrations({ toMigrationInclusive: 73 });
        const columns = yield* sql<{ readonly name: string }>`
          SELECT name FROM pragma_table_info('pm_consumed_settlements')
          WHERE name = 'delivery_episode'
        `;
        assert.deepStrictEqual(columns, [{ name: "delivery_episode" }]);
      }),
    );
  },
);
