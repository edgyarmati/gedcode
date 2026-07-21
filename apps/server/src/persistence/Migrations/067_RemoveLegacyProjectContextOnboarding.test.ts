import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()))(
  "067_RemoveLegacyProjectContextOnboarding",
  (it) => {
    it.effect("drops onboarding state and compacts streams after retiring legacy events", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations({ toMigrationInclusive: 66 });
        yield* sql`
          INSERT INTO projection_projects (
            project_id, title, workspace_root, default_model_selection_json,
            role_model_selections_json, role_prompt_prefixes_json, orchestrator_config_json,
            project_context_onboarding_json, scripts_json, created_at, updated_at, deleted_at
          ) VALUES (
            'project-before-067', 'Before 067', '/repo', NULL, '{}', '{}', '{}',
            '{"outcome":"dismissed"}', '[]', '2026-07-21T00:00:00.000Z',
            '2026-07-21T00:00:00.000Z', NULL
          )
        `;
        yield* sql`
          INSERT INTO orchestration_events (
            event_id, aggregate_kind, stream_id, stream_version, event_type, occurred_at,
            command_id, causation_event_id, correlation_id, actor_kind, payload_json, metadata_json
          ) VALUES
            ('created', 'project', 'project-before-067', 1, 'project.created',
             '2026-07-21T00:00:00.000Z', NULL, NULL, NULL, 'system', '{}', '{}'),
            ('dismissed', 'project', 'project-before-067', 2, 'project.context-dismissed',
             '2026-07-21T00:01:00.000Z', NULL, NULL, NULL, 'system', '{}', '{}'),
            ('updated', 'project', 'project-before-067', 3, 'project.meta-updated',
             '2026-07-21T00:02:00.000Z', NULL, NULL, NULL, 'system', '{}', '{}'),
            ('completed', 'project', 'project-before-067', 4, 'project.context-completed',
             '2026-07-21T00:03:00.000Z', NULL, NULL, NULL, 'system', '{}', '{}')
        `;

        yield* runMigrations({ toMigrationInclusive: 67 });

        const columns = yield* sql<{
          readonly name: string;
        }>`PRAGMA table_info(projection_projects)`;
        assert.strictEqual(
          columns.some((column) => column.name === "project_context_onboarding_json"),
          false,
        );
        const events = yield* sql<{
          readonly eventType: string;
          readonly streamVersion: number;
        }>`
          SELECT event_type AS "eventType", stream_version AS "streamVersion"
          FROM orchestration_events
          WHERE stream_id = 'project-before-067'
          ORDER BY sequence
        `;
        assert.deepStrictEqual(events, [
          { eventType: "project.created", streamVersion: 1 },
          { eventType: "project.meta-updated", streamVersion: 2 },
        ]);
      }),
    );
  },
);
