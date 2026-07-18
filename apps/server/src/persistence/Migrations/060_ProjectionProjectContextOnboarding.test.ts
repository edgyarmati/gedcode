import { ProjectContextResolution } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));
const ProjectContextResolutionJson = Schema.fromJsonString(ProjectContextResolution);
const decodeProjectContextResolution = Schema.decodeUnknownEffect(ProjectContextResolution);
const encodeProjectContextResolutionJson = Schema.encodeEffect(ProjectContextResolutionJson);
const decodeProjectContextResolutionJson = Schema.decodeUnknownEffect(ProjectContextResolutionJson);

layer("060_ProjectionProjectContextOnboarding", (it) => {
  it.effect("adds nullable onboarding metadata without rewriting legacy project rows", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 59 });
      yield* sql`
        INSERT INTO projection_projects (
          project_id,
          title,
          workspace_root,
          default_model_selection_json,
          scripts_json,
          created_at,
          updated_at,
          deleted_at
        ) VALUES (
          'legacy-project',
          'Legacy project',
          '/tmp/legacy-project',
          NULL,
          '[]',
          '2026-07-18T00:00:00.000Z',
          '2026-07-18T00:00:00.000Z',
          NULL
        )
      `;

      yield* runMigrations({ toMigrationInclusive: 60 });

      const columns = yield* sql<{ readonly name: string; readonly notnull: number }>`
        PRAGMA table_info(projection_projects)
      `;
      const column = columns.find((entry) => entry.name === "project_context_onboarding_json");
      assert.ok(column);
      assert.strictEqual(column.notnull, 0);

      const rows = yield* sql<{ readonly projectContextOnboarding: string | null }>`
        SELECT project_context_onboarding_json AS "projectContextOnboarding"
        FROM projection_projects
        WHERE project_id = 'legacy-project'
      `;
      assert.strictEqual(rows[0]?.projectContextOnboarding, null);
    }),
  );

  it.effect("round-trips only strict onboarding-resolution JSON", () =>
    Effect.gen(function* () {
      const resolution = {
        schemaVersion: 1,
        fingerprint: "sha256:4de5861c53fa4d598c6c5f4a0b6b6ef30c9be6e9b5678ed5f8ff643c2b07c27a",
        outcome: "dismissed" as const,
        resolvedAt: "2026-07-18T00:00:00.000Z",
      };
      const parsedResolution = yield* decodeProjectContextResolution(resolution);
      const encoded = yield* encodeProjectContextResolutionJson(parsedResolution);
      const decoded = yield* decodeProjectContextResolutionJson(encoded);
      assert.deepStrictEqual(decoded, parsedResolution);
    }),
  );
});
