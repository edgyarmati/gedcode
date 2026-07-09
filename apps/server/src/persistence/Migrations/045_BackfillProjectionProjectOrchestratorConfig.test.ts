import { assert, it } from "@effect/vitest";
import { OrchestratorConfigJson } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));
const decodeConfigJson = Schema.decodeUnknownSync(Schema.fromJsonString(OrchestratorConfigJson));

layer("045_BackfillProjectionProjectOrchestratorConfig", (it) => {
  it.effect("backfills stale project orchestrator configs from historical events", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 44 });

      yield* sql`
        INSERT INTO projection_projects (
          project_id,
          title,
          workspace_root,
          default_model_selection_json,
          role_model_selections_json,
          role_prompt_prefixes_json,
          orchestrator_config_json,
          scripts_json,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES (
          'project-repair',
          'Project Repair',
          '/tmp/project-repair',
          NULL,
          '{}',
          '{}',
          '{}',
          '[]',
          '2026-07-09T00:00:00.000Z',
          '2026-07-09T00:00:00.000Z',
          NULL
        )
      `;

      yield* sql`
        INSERT INTO orchestration_events (
          event_id,
          aggregate_kind,
          stream_id,
          stream_version,
          event_type,
          occurred_at,
          command_id,
          causation_event_id,
          correlation_id,
          actor_kind,
          payload_json,
          metadata_json
        )
        VALUES
          (
            'evt-project-created',
            'project',
            'project-repair',
            0,
            'project.created',
            '2026-07-09T00:00:00.000Z',
            'cmd-project-created',
            NULL,
            'cmd-project-created',
            'client',
            '{"projectId":"project-repair","title":"Project Repair","workspaceRoot":"/tmp/project-repair","defaultModelSelection":null,"orchestratorConfig":{"enabled":true,"resourceLimits":{"removedLimit":12,"maxParallelTasks":2}},"scripts":[],"createdAt":"2026-07-09T00:00:00.000Z","updatedAt":"2026-07-09T00:00:00.000Z"}',
            '{}'
          ),
          (
            'evt-project-pm-selected',
            'project',
            'project-repair',
            1,
            'project.meta-updated',
            '2026-07-09T00:01:00.000Z',
            'cmd-project-pm-selected',
            NULL,
            'cmd-project-pm-selected',
            'client',
            '{"projectId":"project-repair","orchestratorConfig":{"pmModelSelection":{"instanceId":"codex","model":"gpt-5.5","options":[{"id":"effort","value":"high"}]}},"updatedAt":"2026-07-09T00:01:00.000Z"}',
            '{}'
          )
      `;

      yield* runMigrations({ toMigrationInclusive: 45 });

      const rows = yield* sql<{ readonly orchestratorConfigJson: string }>`
        SELECT orchestrator_config_json AS "orchestratorConfigJson"
        FROM projection_projects
        WHERE project_id = 'project-repair'
      `;

      assert.deepStrictEqual(decodeConfigJson(rows[0]?.orchestratorConfigJson ?? "{}"), {
        resourceLimits: { maxParallelTasks: 2 },
        pmModelSelection: {
          instanceId: "codex",
          model: "gpt-5.5",
          options: [{ id: "effort", value: "high" }],
        },
      });
    }),
  );

  it.effect("does not rewrite projects that already carry projected config", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 44 });

      yield* sql`
        INSERT INTO projection_projects (
          project_id,
          title,
          workspace_root,
          default_model_selection_json,
          role_model_selections_json,
          role_prompt_prefixes_json,
          orchestrator_config_json,
          scripts_json,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES (
          'project-current',
          'Project Current',
          '/tmp/project-current',
          NULL,
          '{}',
          '{}',
          '{"pmModelSelection":{"instanceId":"claudeAgent","model":"claude-sonnet-4-6"}}',
          '[]',
          '2026-07-09T00:00:00.000Z',
          '2026-07-09T00:00:00.000Z',
          NULL
        )
      `;

      yield* sql`
        INSERT INTO orchestration_events (
          event_id,
          aggregate_kind,
          stream_id,
          stream_version,
          event_type,
          occurred_at,
          command_id,
          causation_event_id,
          correlation_id,
          actor_kind,
          payload_json,
          metadata_json
        )
        VALUES (
          'evt-project-current-created',
          'project',
          'project-current',
          0,
          'project.created',
          '2026-07-09T00:00:00.000Z',
          'cmd-project-current-created',
          NULL,
          'cmd-project-current-created',
          'client',
            '{"projectId":"project-current","title":"Project Current","workspaceRoot":"/tmp/project-current","defaultModelSelection":null,"orchestratorConfig":{"pmModelSelection":{"instanceId":"codex","model":"gpt-5.5"}},"scripts":[],"createdAt":"2026-07-09T00:00:00.000Z","updatedAt":"2026-07-09T00:00:00.000Z"}',
          '{}'
        )
      `;

      yield* runMigrations({ toMigrationInclusive: 45 });

      const rows = yield* sql<{ readonly orchestratorConfigJson: string }>`
        SELECT orchestrator_config_json AS "orchestratorConfigJson"
        FROM projection_projects
        WHERE project_id = 'project-current'
      `;

      assert.deepStrictEqual(decodeConfigJson(rows[0]?.orchestratorConfigJson ?? "{}"), {
        pmModelSelection: { instanceId: "claudeAgent", model: "claude-sonnet-4-6" },
      });
    }),
  );
});
