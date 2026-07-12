import { OrchestrationTaskLanding } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));
const LandingJson = Schema.fromJsonString(OrchestrationTaskLanding);
const encodeLandingJson = Schema.encodeEffect(LandingJson);
const decodeLandingJson = Schema.decodeUnknownEffect(LandingJson);

layer("047_ProjectionTaskLanding", (it) => {
  it.effect("adds nullable durable landing metadata without rewriting legacy rows", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 46 });
      yield* runMigrations({ toMigrationInclusive: 47 });

      const columns = yield* sql<{ readonly name: string; readonly notnull: number }>`
        PRAGMA table_info(projection_tasks)
      `;
      const column = columns.find((entry) => entry.name === "landing_json");
      assert.ok(column);
      assert.strictEqual(column.notnull, 0);
    }),
  );

  it.effect("round-trips landing JSON", () =>
    Effect.gen(function* () {
      yield* runMigrations({ toMigrationInclusive: 47 });
      const landing = {
        status: "failed" as const,
        failureMessage: "PR provider unavailable",
        branchPushed: true,
        updatedAt: "2026-07-12T00:00:00.000Z",
      };
      const encoded = yield* encodeLandingJson(landing);
      const decoded = yield* decodeLandingJson(encoded);
      assert.deepEqual(decoded, landing);
    }),
  );
});
