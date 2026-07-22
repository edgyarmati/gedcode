import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()))(
  "070_ProjectionStageHistoryNetworkAccess",
  (it) => {
    it.effect("adds a nullable per-attempt policy without rewriting existing history", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations({ toMigrationInclusive: 69 });
        yield* sql`
          INSERT INTO projection_stage_history (
            stage_thread_id, project_id, task_id, role, provider_instance_id, model,
            status, started_at, ended_at
          ) VALUES (
            'stage-before-070', 'project', 'task', 'work', 'codex', 'gpt',
            'running', '2026-07-22T00:00:00.000Z', NULL
          )
        `;

        yield* runMigrations({ toMigrationInclusive: 70 });
        const rows = yield* sql<{ readonly networkAccess: number | null }>`
          SELECT network_access AS "networkAccess"
          FROM projection_stage_history
          WHERE stage_thread_id = 'stage-before-070'
        `;
        assert.deepStrictEqual(rows, [{ networkAccess: null }]);
      }),
    );
  },
);
