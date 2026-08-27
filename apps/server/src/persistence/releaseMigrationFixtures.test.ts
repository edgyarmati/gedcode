import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { CURRENT_SCHEMA_MIGRATION_ID, runMigrations } from "./Migrations.ts";
import * as NodeSqliteClient from "./NodeSqliteClient.ts";
import { PUBLISHED_RELEASE_MIGRATION_FIXTURES } from "./releaseMigrationFixtures.ts";

for (const fixture of PUBLISHED_RELEASE_MIGRATION_FIXTURES) {
  it.effect(`forward-migrates the published ${fixture.tag} schema`, () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: fixture.migrationId });
      yield* runMigrations();

      const migrationRows = yield* sql<{
        readonly migration_id: number;
      }>`SELECT migration_id FROM effect_sql_migrations ORDER BY migration_id DESC LIMIT 1`;
      const integrityRows = yield* sql<{
        readonly integrity_check: string;
      }>`PRAGMA integrity_check;`;

      assert.strictEqual(migrationRows[0]?.migration_id, CURRENT_SCHEMA_MIGRATION_ID);
      assert.strictEqual(integrityRows[0]?.integrity_check, "ok");
    }).pipe(Effect.provide(NodeSqliteClient.layerMemory())),
  );
}
