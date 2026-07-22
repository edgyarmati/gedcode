import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()))(
  "072_ProjectionStageCapabilityPauseDeadline",
  (it) => {
    it.effect("adds a nullable deadline without inferring one for historical attempts", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations({ toMigrationInclusive: 71 });
        yield* sql`
          INSERT INTO projection_stage_history (
            stage_thread_id, project_id, task_id, role, provider_instance_id, model,
            status, started_at, ended_at
          ) VALUES (
            'stage-before-072', 'project', 'task', 'work', 'codex', 'gpt',
            'paused', '2026-07-22T00:00:00.000Z', NULL
          )
        `;

        yield* runMigrations({ toMigrationInclusive: 72 });
        const rows = yield* sql<{ readonly expiresAt: string | null }>`
          SELECT capability_pause_expires_at AS "expiresAt"
          FROM projection_stage_history
          WHERE stage_thread_id = 'stage-before-072'
        `;
        assert.deepStrictEqual(rows, [{ expiresAt: null }]);
      }),
    );
  },
);
