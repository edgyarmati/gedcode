import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";
import { OrchestrationEventStore } from "../Services/OrchestrationEventStore.ts";
import { OrchestrationEventStoreLive } from "../Layers/OrchestrationEventStore.ts";

const layer = it.layer(
  OrchestrationEventStoreLive.pipe(Layer.provideMerge(NodeSqliteClient.layerMemory())),
);

layer("077_RemoveProjectionThreadInboxLifecycle", (it) => {
  it.effect("upgrades an Inbox-era schema without losing projected thread data", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 76 });
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
          inbox_lifecycle,
          inbox_wake_at,
          deleted_at
        ) VALUES (
          'thread-before-077',
          'project-before-077',
          'Plain chat survives',
          '{"instanceId":"codex","model":"gpt-5.4"}',
          'full-access',
          'default',
          '2026-08-30T00:00:00.000Z',
          '2026-08-30T00:01:00.000Z',
          'snoozed',
          '2026-08-31T00:00:00.000Z',
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
        ) VALUES
          (
            'thread-created-before-077',
            'thread',
            'thread-before-077',
            1,
            'thread.created',
            '2026-08-30T00:00:00.000Z',
            NULL,
            NULL,
            NULL,
            'system',
            '{"threadId":"thread-before-077","projectId":"project-before-077","title":"Plain chat survives","modelSelection":{"instanceId":"codex","model":"gpt-5.4"},"runtimeMode":"full-access","interactionMode":"default","branch":null,"worktreePath":null,"createdAt":"2026-08-30T00:00:00.000Z","updatedAt":"2026-08-30T00:00:00.000Z"}',
            '{}'
          ),
          (
            'thread-inbox-settled-before-077',
            'thread',
            'thread-before-077',
            2,
            'thread.inbox-settled',
            '2026-08-30T00:01:00.000Z',
            NULL,
            NULL,
            NULL,
            'system',
            '{}',
            '{}'
          ),
          (
            'thread-meta-before-077',
            'thread',
            'thread-before-077',
            3,
            'thread.meta-updated',
            '2026-08-30T00:02:00.000Z',
            NULL,
            NULL,
            NULL,
            'system',
            '{"threadId":"thread-before-077","title":"Still plain chat","updatedAt":"2026-08-30T00:02:00.000Z"}',
            '{}'
          ),
          (
            'thread-inbox-snoozed-before-077',
            'thread',
            'thread-before-077',
            4,
            'thread.inbox-snoozed',
            '2026-08-30T00:03:00.000Z',
            NULL,
            NULL,
            NULL,
            'system',
            '{}',
            '{}'
          ),
          (
            'thread-inbox-reopened-before-077',
            'thread',
            'thread-before-077',
            5,
            'thread.inbox-reopened',
            '2026-08-30T00:04:00.000Z',
            NULL,
            NULL,
            NULL,
            'system',
            '{}',
            '{}'
          ),
          (
            'thread-meta-after-inbox-before-077',
            'thread',
            'thread-before-077',
            6,
            'thread.meta-updated',
            '2026-08-30T00:05:00.000Z',
            NULL,
            NULL,
            NULL,
            'system',
            '{"threadId":"thread-before-077","title":"Inbox-free","updatedAt":"2026-08-30T00:05:00.000Z"}',
            '{}'
          )
      `;

      yield* runMigrations({ toMigrationInclusive: 77 });

      const columns = yield* sql<{ readonly name: string }>`PRAGMA table_info(projection_threads)`;
      const rows = yield* sql<{ readonly threadId: string; readonly title: string }>`
        SELECT thread_id AS "threadId", title
        FROM projection_threads
        WHERE thread_id = 'thread-before-077'
      `;
      assert.notInclude(
        columns.map((column) => column.name),
        "inbox_lifecycle",
      );
      assert.notInclude(
        columns.map((column) => column.name),
        "inbox_wake_at",
      );
      assert.deepStrictEqual(rows, [
        { threadId: "thread-before-077", title: "Plain chat survives" },
      ]);

      const events = yield* sql<{
        readonly eventType: string;
        readonly streamVersion: number;
      }>`
        SELECT event_type AS "eventType", stream_version AS "streamVersion"
        FROM orchestration_events
        WHERE stream_id = 'thread-before-077'
        ORDER BY sequence
      `;
      assert.deepStrictEqual(events, [
        { eventType: "thread.created", streamVersion: 1 },
        { eventType: "thread.meta-updated", streamVersion: 2 },
        { eventType: "thread.meta-updated", streamVersion: 3 },
      ]);

      const eventStore = yield* OrchestrationEventStore;
      const replayedEvents = yield* Stream.runCollect(eventStore.readFromSequence(0, 10)).pipe(
        Effect.map((events) => Array.from(events)),
      );
      assert.deepStrictEqual(
        replayedEvents.map((event) => event.type),
        ["thread.created", "thread.meta-updated", "thread.meta-updated"],
      );
    }),
  );

  it.effect("keeps withdrawn Inbox lifecycle columns out of the current schema", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations();

      const columns = yield* sql<{ readonly name: string }>`PRAGMA table_info(projection_threads)`;
      const columnNames = columns.map((column) => column.name);
      assert.notInclude(columnNames, "inbox_lifecycle");
      assert.notInclude(columnNames, "inbox_wake_at");
    }),
  );
});
