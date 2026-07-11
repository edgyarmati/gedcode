import { OrchestrationTaskCancellation } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));
const CancellationJson = Schema.fromJsonString(OrchestrationTaskCancellation);
const encodeCancellationJson = Schema.encodeEffect(CancellationJson);
const decodeCancellationJson = Schema.decodeUnknownEffect(CancellationJson);

layer("046_ProjectionTaskCancellation", (it) => {
  it.effect("adds durable nullable cancellation metadata", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 45 });
      yield* runMigrations({ toMigrationInclusive: 46 });

      const columns = yield* sql<{
        readonly name: string;
        readonly notnull: number;
      }>`
        PRAGMA table_info(projection_tasks)
      `;
      const column = columns.find((entry) => entry.name === "cancellation_json");
      assert.ok(column);
      assert.strictEqual(column.notnull, 0);
    }),
  );

  it.effect("preserves legacy rows and round-trips cancellation JSON", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 45 });
      yield* sql`
        INSERT INTO projection_tasks (
          task_id,
          project_id,
          type,
          title,
          status,
          branch,
          worktree_path,
          pr_url,
          pm_message_id,
          stage_thread_ids_json,
          current_stage_thread_id,
          role_model_selections_json,
          playbook_version,
          created_at,
          updated_at
        ) VALUES (
          'task-legacy',
          'project-1',
          'feature',
          'Legacy task',
          'working',
          'orchestrator/task-legacy',
          '/tmp/task-legacy',
          NULL,
          NULL,
          '["thread-work"]',
          'thread-work',
          '{}',
          'feature@v1',
          '2026-07-11T00:00:00.000Z',
          '2026-07-11T00:01:00.000Z'
        )
      `;

      yield* runMigrations({ toMigrationInclusive: 46 });

      const afterMigration = yield* sql<{
        readonly cancellation: string | null;
      }>`
        SELECT cancellation_json AS cancellation
        FROM projection_tasks
        WHERE task_id = 'task-legacy'
      `;
      assert.deepEqual(afterMigration, [{ cancellation: null }]);

      const cancellation: OrchestrationTaskCancellation = {
        requestedAt: "2026-07-11T00:02:00.000Z",
        completedPhases: ["interrupt-turn"],
        failurePhase: "stop-session",
        failureMessage: "provider session did not stop",
        failedAt: "2026-07-11T00:03:00.000Z",
      };
      const cancellationJson = yield* encodeCancellationJson(cancellation);
      yield* sql`
        UPDATE projection_tasks
        SET cancellation_json = ${cancellationJson}
        WHERE task_id = 'task-legacy'
      `;
      const roundTrip = yield* sql<{ readonly cancellation: string | null }>`
        SELECT cancellation_json AS cancellation
        FROM projection_tasks
        WHERE task_id = 'task-legacy'
      `;
      const persistedCancellation = yield* decodeCancellationJson(roundTrip[0]?.cancellation);
      assert.deepEqual(persistedCancellation, cancellation);
    }),
  );

  it.effect("is idempotent when migrations re-run on an already-migrated DB", () =>
    Effect.gen(function* () {
      yield* runMigrations({ toMigrationInclusive: 46 });

      const replay = yield* runMigrations({ toMigrationInclusive: 46 });
      assert.ok(replay.every(([id]) => id !== 46));

      const sql = yield* SqlClient.SqlClient;
      const recorded = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count
        FROM effect_sql_migrations
        WHERE migration_id = 46
      `;
      assert.strictEqual(recorded[0]?.count, 1);
    }),
  );
});
