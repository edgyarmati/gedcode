import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const LEGACY_COMMAND_FINGERPRINT = `sha256:${"0".repeat(64)}`;

it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()))(
  "079_OrchestrationCommandFingerprints",
  (it) => {
    it.effect("preserves old receipts with a fail-closed legacy fingerprint", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations({ toMigrationInclusive: 78 });
        yield* sql`
          INSERT INTO orchestration_command_receipts (
            command_id,
            aggregate_kind,
            aggregate_id,
            accepted_at,
            result_sequence,
            status,
            error
          ) VALUES (
            'cmd-before-079',
            'project',
            'project-before-079',
            '2026-08-30T00:00:00.000Z',
            42,
            'accepted',
            NULL
          )
        `;

        yield* runMigrations({ toMigrationInclusive: 79 });

        const columns = yield* sql<{
          readonly name: string;
          readonly notnull: number;
          readonly dflt_value: string | null;
        }>`PRAGMA table_info(orchestration_command_receipts)`;
        const rows = yield* sql<{
          readonly commandId: string;
          readonly commandFingerprint: string;
          readonly resultSequence: number;
        }>`
          SELECT
            command_id AS "commandId",
            command_fingerprint AS "commandFingerprint",
            result_sequence AS "resultSequence"
          FROM orchestration_command_receipts
        `;

        const fingerprintColumn = columns.find((column) => column.name === "command_fingerprint");
        assert.equal(fingerprintColumn?.notnull, 1);
        assert.isNull(fingerprintColumn?.dflt_value);
        assert.deepStrictEqual(rows, [
          {
            commandId: "cmd-before-079",
            commandFingerprint: LEGACY_COMMAND_FINGERPRINT,
            resultSequence: 42,
          },
        ]);
      }),
    );
  },
);
