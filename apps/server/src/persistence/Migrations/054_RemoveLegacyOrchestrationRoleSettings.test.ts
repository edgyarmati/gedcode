import { assert, it } from "@effect/vitest";
import { GedRoleModelSelections, GedRolePromptPrefixes } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";
import RemoveLegacyOrchestrationRoleSettings from "./054_RemoveLegacyOrchestrationRoleSettings.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));
const decodeSelections = Schema.decodeUnknownSync(Schema.fromJsonString(GedRoleModelSelections));
const decodePrefixes = Schema.decodeUnknownSync(Schema.fromJsonString(GedRolePromptPrefixes));

const insertProject = (
  sql: SqlClient.SqlClient,
  id: string,
  selections: string,
  prefixes: string,
) =>
  sql`
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
      ${id},
      'Role migration project',
      '/tmp/role-migration',
      NULL,
      ${selections},
      ${prefixes},
      '{}',
      '[]',
      '2026-07-16T00:00:00.000Z',
      '2026-07-16T00:00:00.000Z',
      NULL
    )
  `;

const insertTask = (sql: SqlClient.SqlClient, id: string, selections: string) =>
  sql`
    INSERT INTO projection_tasks (
      task_id,
      project_id,
      type,
      title,
      status,
      stage_thread_ids_json,
      role_model_selections_json,
      created_at,
      updated_at
    )
    VALUES (
      ${id},
      'project-legacy-roles',
      'feature',
      'Legacy task',
      'draft',
      '[]',
      ${selections},
      '2026-07-16T00:00:00.000Z',
      '2026-07-16T00:00:00.000Z'
    )
  `;

layer("054_RemoveLegacyOrchestrationRoleSettings", (it) => {
  it.effect("removes obsolete project and task role settings while preserving current roles", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 53 });

      yield* insertProject(
        sql,
        "project-legacy-roles",
        '{"classify":{"instanceId":"codex","model":"gpt-old"},"plan":{"instanceId":"codex","model":"gpt-plan"},"review":{"instanceId":"claudeAgent","model":"claude-old"},"work":{"instanceId":"claudeAgent","model":"claude-work"},"verify":{"instanceId":"codex","model":"gpt-verify"}}',
        '{"classify":"Classify first","plan":"Plan carefully","review":"Review twice","verify":"Run all gates"}',
      );
      yield* insertTask(
        sql,
        "task-legacy-roles",
        '{"classify":{"instanceId":"codex","model":"gpt-old"},"work":{"instanceId":"codex","model":"gpt-work"},"review":{"instanceId":"claudeAgent","model":"claude-old"}}',
      );

      yield* RemoveLegacyOrchestrationRoleSettings;

      const projects = yield* sql<{
        readonly prefixes: string;
        readonly selections: string;
      }>`
        SELECT
          role_model_selections_json AS selections,
          role_prompt_prefixes_json AS prefixes
        FROM projection_projects
        WHERE project_id = 'project-legacy-roles'
      `;
      const tasks = yield* sql<{ readonly selections: string }>`
        SELECT role_model_selections_json AS selections
        FROM projection_tasks
        WHERE task_id = 'task-legacy-roles'
      `;

      const projectSelections = decodeSelections(projects[0]?.selections);
      assert.deepStrictEqual(Object.keys(projectSelections), ["plan", "work", "verify"]);
      assert.strictEqual(projectSelections.plan?.instanceId, "codex");
      assert.strictEqual(projectSelections.plan?.model, "gpt-plan");
      assert.strictEqual(projectSelections.work?.instanceId, "claudeAgent");
      assert.strictEqual(projectSelections.work?.model, "claude-work");
      assert.strictEqual(projectSelections.verify?.instanceId, "codex");
      assert.strictEqual(projectSelections.verify?.model, "gpt-verify");
      assert.deepStrictEqual(decodePrefixes(projects[0]?.prefixes), {
        plan: "Plan carefully",
        verify: "Run all gates",
      });
      const taskSelections = decodeSelections(tasks[0]?.selections);
      assert.deepStrictEqual(Object.keys(taskSelections), ["work"]);
      assert.strictEqual(taskSelections.work?.instanceId, "codex");
      assert.strictEqual(taskSelections.work?.model, "gpt-work");
    }),
  );

  it.effect("leaves already-current role JSON byte-for-byte unchanged", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 53 });
      const selections = '{ "verify": { "instanceId": "codex", "model": "gpt-verify" } }';
      const prefixes = '{ "work": "Keep spacing" }';
      yield* insertProject(sql, "project-current-roles", selections, prefixes);

      yield* runMigrations({ toMigrationInclusive: 54 });

      const rows = yield* sql<{ readonly prefixes: string; readonly selections: string }>`
        SELECT
          role_model_selections_json AS selections,
          role_prompt_prefixes_json AS prefixes
        FROM projection_projects
        WHERE project_id = 'project-current-roles'
      `;
      assert.strictEqual(rows[0]?.selections, selections);
      assert.strictEqual(rows[0]?.prefixes, prefixes);
    }),
  );

  it.effect("fails instead of replacing malformed persisted role JSON", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 53 });
      yield* insertProject(sql, "project-malformed-roles", "{not-json", "{}");

      const exit = yield* Effect.exit(RemoveLegacyOrchestrationRoleSettings);
      assert.isTrue(Exit.isFailure(exit));

      const rows = yield* sql<{ readonly selections: string }>`
        SELECT role_model_selections_json AS selections
        FROM projection_projects
        WHERE project_id = 'project-malformed-roles'
      `;
      assert.strictEqual(rows[0]?.selections, "{not-json");
    }),
  );
});
