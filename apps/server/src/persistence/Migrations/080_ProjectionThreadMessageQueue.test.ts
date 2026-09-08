import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("080_ProjectionThreadMessageQueue", (it) => {
  it.effect("upgrades an existing 079 thread with safe empty queue defaults", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 79 });
      yield* sql`
        INSERT INTO projection_threads (
          thread_id,
          project_id,
          title,
          model_selection_json,
          runtime_mode,
          interaction_mode,
          created_at,
          updated_at,
          deleted_at
        ) VALUES (
          'thread-before-080',
          'project-before-080',
          'Existing chat',
          '{"instanceId":"codex","model":"gpt-5.6"}',
          'full-access',
          'default',
          '2026-08-30T00:00:00.000Z',
          '2026-08-30T00:01:00.000Z',
          NULL
        )
      `;

      yield* runMigrations({ toMigrationInclusive: 80 });

      const rows = yield* sql<{
        readonly title: string;
        readonly queuedMessagesJson: string;
        readonly messageQueueEnabled: number;
      }>`
        SELECT title,
               queued_messages_json AS "queuedMessagesJson",
               message_queue_enabled AS "messageQueueEnabled"
        FROM projection_threads
        WHERE thread_id = 'thread-before-080'
      `;
      assert.deepStrictEqual(rows, [
        {
          title: "Existing chat",
          queuedMessagesJson: "[]",
          messageQueueEnabled: 1,
        },
      ]);
    }),
  );

  it.effect("adds durable FIFO and queueing preference columns to the current schema", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations();

      const columns = yield* sql<{
        readonly name: string;
        readonly dfltValue: string | number | null;
      }>`
        SELECT name, dflt_value AS "dfltValue"
        FROM pragma_table_info('projection_threads')
        WHERE name IN ('queued_messages_json', 'message_queue_enabled')
        ORDER BY name
      `;

      assert.deepStrictEqual(columns, [
        { name: "message_queue_enabled", dfltValue: "1" },
        { name: "queued_messages_json", dfltValue: "'[]'" },
      ]);
    }),
  );
});
