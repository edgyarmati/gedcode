import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { withBusyRetry } from "../../persistence/retryPolicy.ts";

type ClearPmSessionStorageOptions = {
  readonly sessionId: string;
};

export const clearSqliteSessionStorage = ({ sessionId }: ClearPmSessionStorageOptions) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* withBusyRetry(
      sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`
            DELETE FROM pm_session_entries
            WHERE session_id = ${sessionId}
          `;
          yield* sql`
            DELETE FROM pm_sessions
            WHERE session_id = ${sessionId}
          `;
        }),
      ),
    );
  });
