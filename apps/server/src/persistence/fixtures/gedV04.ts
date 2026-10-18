// @effect-diagnostics nodeBuiltinImport:off -- Synchronous synthetic SQLite fixture setup before Effect runs.
import * as NodeFS from "node:fs";
import * as NodeSqlite from "node:sqlite";

import { GED_V04_MIGRATIONS } from "../gedV04Import.ts";

export const attachments = [
  {
    type: "image",
    id: "synthetic-image",
    name: "diagram.png",
    mimeType: "image/png",
    sizeBytes: 42,
  },
];

/** Historical released schema, not today's migrations relabeled as legacy. */
export const seedGedV04 = (
  path: string,
  options: { omni?: boolean; missingSummary?: boolean; through?: 76 | 80 } = {},
) => {
  const database = new NodeSqlite.DatabaseSync(path);
  try {
    database.exec(NodeFS.readFileSync(new URL("./ged-v04-schema76.sql", import.meta.url), "utf8"));
    // The final four published 0.4 migrations, with no credentials/receipts to convert.
    if (options.through !== 76) {
      database.exec(`
      ALTER TABLE projection_threads DROP COLUMN inbox_lifecycle;
      ALTER TABLE projection_threads DROP COLUMN inbox_wake_at;
      ALTER TABLE auth_pairing_links RENAME COLUMN credential TO credential_digest;
      ALTER TABLE orchestration_command_receipts ADD COLUMN command_fingerprint TEXT NOT NULL;
      ALTER TABLE projection_threads ADD COLUMN queued_messages_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE projection_threads ADD COLUMN message_queue_enabled INTEGER NOT NULL DEFAULT 1;
    `);
      for (const [id, name] of GED_V04_MIGRATIONS) {
        if (id > 76)
          database
            .prepare("INSERT INTO effect_sql_migrations (migration_id, name) VALUES (?, ?)")
            .run(id, name);
      }
    }
    if (options.omni)
      database.exec(`
      UPDATE effect_sql_migrations SET name = 'OmniPromptProjectionTables' WHERE migration_id = 23;
      UPDATE effect_sql_migrations SET name = 'OmniPromptProjectionIndexes' WHERE migration_id = 24;
    `);
    if (options.missingSummary) {
      for (const name of [
        "latest_user_message_at",
        "pending_approval_count",
        "pending_user_input_count",
        "has_actionable_proposed_plan",
      ])
        database.exec(`ALTER TABLE projection_threads DROP COLUMN ${name}`);
    }
    database.exec(`
      INSERT INTO projection_projects (project_id, title, workspace_root, scripts_json, created_at, updated_at)
      VALUES ('project', 'Project', '/tmp/synthetic-project', '[]', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
      INSERT INTO projection_threads (thread_id, project_id, title, model_selection_json, runtime_mode, interaction_mode, created_at, updated_at)
      VALUES ('legacy-thread', 'project', 'Legacy conversation', '{"instanceId":"codex","model":"gpt-5.4"}', 'full-access', 'default', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    `);
    for (let index = 0; index < 6; index++)
      database
        .prepare(`
      INSERT INTO projection_thread_messages (message_id, thread_id, role, text, attachments_json, is_streaming, created_at, updated_at)
      VALUES (?, 'legacy-thread', ?, ?, ?, 0, ?, ?)
    `)
        .run(
          `message-${index}`,
          index % 2 ? "assistant" : "user",
          `Text ${index}`,
          index === 0 ? JSON.stringify(attachments) : null,
          `2026-01-0${index + 1}T00:00:00.000Z`,
          `2026-01-0${index + 1}T00:00:00.000Z`,
        );
    database.exec(`INSERT INTO projection_thread_activities (activity_id, thread_id, tone, kind, summary, payload_json, created_at)
      VALUES ('approval', 'legacy-thread', 'info', 'approval.requested', 'Synthetic approval', '{"requestId":"request"}', '2026-01-01T00:00:00.000Z'),
        ('input', 'legacy-thread', 'info', 'user-input.requested', 'Synthetic input', '{"requestId":"input"}', '2026-01-01T00:00:00.000Z');
      INSERT INTO projection_thread_proposed_plans (plan_id, thread_id, turn_id, plan_markdown, created_at, updated_at)
      VALUES ('plan', 'legacy-thread', 'turn', 'Synthetic plan', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`);
  } finally {
    database.close();
  }
};
