import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()))(
  "068_ProjectionPendingGatePullRequest",
  (it) => {
    it.effect("adds nullable approved PR proposal fields without rewriting legacy gates", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations({ toMigrationInclusive: 67 });
        yield* sql`
          INSERT INTO projection_pending_gates (
            gate_id, task_id, gate, content_hash, status, requested_at
          ) VALUES (
            'legacy-gate', 'task', 'land', 'abc123', 'pending', '2026-07-22T00:00:00.000Z'
          )
        `;

        yield* runMigrations({ toMigrationInclusive: 68 });
        yield* sql`
          UPDATE projection_pending_gates
          SET pull_request_title = 'fix: explain the behavior',
              pull_request_body = '## Summary'
          WHERE gate_id = 'legacy-gate'
        `;
        const rows = yield* sql<{
          readonly title: string;
          readonly body: string;
        }>`
          SELECT pull_request_title AS title, pull_request_body AS body
          FROM projection_pending_gates
          WHERE gate_id = 'legacy-gate'
        `;
        assert.deepStrictEqual(rows, [{ title: "fix: explain the behavior", body: "## Summary" }]);
      }),
    );
  },
);
