import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { clearSqliteSessionStorage } from "./LegacySessionStorage.ts";

const layer = it.layer(Layer.fresh(SqlitePersistenceMemory));

layer("LegacySessionStorage", (it) => {
  it.effect("clears stored legacy PM session rows for a session id only", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`
        INSERT INTO pm_sessions (session_id, created_at, leaf_id)
        VALUES
          ('pm:project-clear', '2026-06-14T00:00:00.000Z', 'clear-entry-1'),
          ('pm:project-keep', '2026-06-14T00:00:00.000Z', 'keep-entry-1')
      `;
      yield* sql`
        INSERT INTO pm_session_entries (
          entry_id,
          session_id,
          parent_id,
          type,
          timestamp,
          payload_json
        )
        VALUES
          (
            'clear-entry-1',
            'pm:project-clear',
            NULL,
            'message',
            '2026-06-14T00:00:00.000Z',
            '{"message":{"role":"user","content":"clear me","timestamp":0}}'
          ),
          (
            'keep-entry-1',
            'pm:project-keep',
            NULL,
            'message',
            '2026-06-14T00:00:00.000Z',
            '{"message":{"role":"user","content":"keep me","timestamp":0}}'
          )
      `;

      yield* clearSqliteSessionStorage({ sessionId: "pm:project-clear" });

      const sessions = yield* sql<{ readonly sessionId: string }>`
        SELECT session_id AS "sessionId"
        FROM pm_sessions
        ORDER BY session_id
      `;
      const entries = yield* sql<{ readonly entryId: string }>`
        SELECT entry_id AS "entryId"
        FROM pm_session_entries
        ORDER BY entry_id
      `;

      assert.deepStrictEqual(sessions, [{ sessionId: "pm:project-keep" }]);
      assert.deepStrictEqual(entries, [{ entryId: "keep-entry-1" }]);
    }),
  );
});
