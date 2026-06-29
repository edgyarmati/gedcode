import {
  SessionError,
  uuidv7,
  type SessionMetadata,
  type SessionStorage,
  type SessionTreeEntry,
} from "@earendil-works/pi-agent-core";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { withBusyRetry } from "../../persistence/retryPolicy.ts";

type PmSessionEntryRow = {
  readonly entryId: string;
  readonly parentId: string | null;
  readonly type: SessionTreeEntry["type"];
  readonly timestamp: string;
  readonly payloadJson: string;
};

type PmSessionRow = {
  readonly sessionId: string;
  readonly createdAt: string;
  readonly leafId: string | null;
};

type PmSessionStorageOptions<TMetadata extends SessionMetadata> = {
  readonly sessionId: string;
  readonly metadata?: Omit<TMetadata, "id" | "createdAt">;
  readonly createdAt?: string;
};

type ClearPmSessionStorageOptions = {
  readonly sessionId: string;
};

const leafIdAfterEntry = (entry: SessionTreeEntry): string | null =>
  entry.type === "leaf" ? entry.targetId : entry.id;

const splitEntry = (entry: SessionTreeEntry) => {
  const { id, parentId, timestamp, type, ...payload } = entry;
  return {
    id,
    parentId,
    timestamp,
    type,
    payloadJson: JSON.stringify(payload),
  };
};

const parseEntry = (row: PmSessionEntryRow): SessionTreeEntry => {
  const payload = JSON.parse(row.payloadJson) as Record<string, unknown>;
  return {
    id: row.entryId,
    parentId: row.parentId,
    timestamp: row.timestamp,
    type: row.type,
    ...payload,
  } as SessionTreeEntry;
};

const generateEntryId = (exists: (id: string) => Promise<boolean>): Promise<string> =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (let i = 0; i < 100; i += 1) {
        const id = uuidv7().slice(0, 8);
        if (!(yield* Effect.promise(() => exists(id)))) {
          return id;
        }
      }
      return uuidv7();
    }),
  );

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

export const makeSqliteSessionStorage = <TMetadata extends SessionMetadata = SessionMetadata>({
  sessionId,
  metadata,
  createdAt,
}: PmSessionStorageOptions<TMetadata>): Effect.Effect<
  SessionStorage<TMetadata>,
  never,
  SqlClient.SqlClient
> =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const runtimeContext = yield* Effect.context<never>();
    const runPromise = Effect.runPromiseWith(runtimeContext);
    const sessionCreatedAt =
      createdAt ?? (yield* DateTime.now.pipe(Effect.map(DateTime.formatIso)));

    const ensureSession = sql`
      INSERT INTO pm_sessions (session_id, created_at, leaf_id)
      VALUES (${sessionId}, ${sessionCreatedAt}, NULL)
      ON CONFLICT (session_id) DO NOTHING
    `;

    const readSession = Effect.map(
      sql<PmSessionRow>`
        SELECT
          session_id AS "sessionId",
          created_at AS "createdAt",
          leaf_id AS "leafId"
        FROM pm_sessions
        WHERE session_id = ${sessionId}
        LIMIT 1
      `,
      (rows) => rows[0],
    );

    const readEntry = (id: string) =>
      Effect.map(
        sql<PmSessionEntryRow>`
          SELECT
            entry_id AS "entryId",
            parent_id AS "parentId",
            type,
            timestamp,
            payload_json AS "payloadJson"
          FROM pm_session_entries
          WHERE session_id = ${sessionId}
            AND entry_id = ${id}
          LIMIT 1
        `,
        (rows) => rows[0],
      );

    const entryExists = (id: string) =>
      Effect.map(
        sql<{ readonly count: number }>`
          SELECT COUNT(*) AS count
          FROM pm_session_entries
          WHERE session_id = ${sessionId}
            AND entry_id = ${id}
        `,
        (rows) => (rows[0]?.count ?? 0) > 0,
      );

    const getLeafId = async (): Promise<string | null> => {
      await runPromise(ensureSession);
      const row = await runPromise(readSession);
      if (!row) {
        throw new SessionError("invalid_session", `Session ${sessionId} not found`);
      }
      if (row.leafId !== null && !(await runPromise(entryExists(row.leafId)))) {
        throw new SessionError("invalid_session", `Entry ${row.leafId} not found`);
      }
      return row.leafId;
    };

    const appendEntry = async (entry: SessionTreeEntry): Promise<void> => {
      const row = splitEntry(entry);
      await runPromise(
        withBusyRetry(
          sql.withTransaction(
            Effect.gen(function* () {
              yield* ensureSession;
              yield* sql`
              INSERT INTO pm_session_entries (
                entry_id,
                session_id,
                parent_id,
                type,
                timestamp,
                payload_json
              )
              VALUES (
                ${row.id},
                ${sessionId},
                ${row.parentId},
                ${row.type},
                ${row.timestamp},
                ${row.payloadJson}
              )
            `;
              yield* sql`
              UPDATE pm_sessions
              SET leaf_id = ${leafIdAfterEntry(entry)}
              WHERE session_id = ${sessionId}
            `;
            }),
          ),
        ),
      );
    };

    return {
      getMetadata: async () => {
        await runPromise(ensureSession);
        const row = await runPromise(readSession);
        if (!row) {
          throw new SessionError("invalid_session", `Session ${sessionId} not found`);
        }
        return {
          ...metadata,
          id: row.sessionId,
          createdAt: row.createdAt,
        } as TMetadata;
      },

      getLeafId,

      setLeafId: async (leafId) => {
        const currentLeafId = await getLeafId();
        if (leafId !== null && !(await runPromise(entryExists(leafId)))) {
          throw new SessionError("not_found", `Entry ${leafId} not found`);
        }
        await appendEntry({
          type: "leaf",
          id: await generateEntryId((id) => runPromise(entryExists(id))),
          parentId: currentLeafId,
          timestamp: await runPromise(DateTime.now.pipe(Effect.map(DateTime.formatIso))),
          targetId: leafId,
        });
      },

      createEntryId: () => generateEntryId((id) => runPromise(entryExists(id))),

      appendEntry,

      getEntry: async (id) => {
        await runPromise(ensureSession);
        const row = await runPromise(readEntry(id));
        return row ? parseEntry(row) : undefined;
      },

      findEntries: async (type) => {
        await runPromise(ensureSession);
        const rows = await runPromise(
          sql<PmSessionEntryRow>`
            SELECT
              entry_id AS "entryId",
              parent_id AS "parentId",
              type,
              timestamp,
              payload_json AS "payloadJson"
            FROM pm_session_entries
            WHERE session_id = ${sessionId}
              AND type = ${type}
            ORDER BY timestamp ASC, entry_id ASC
          `,
        );
        return rows.map(parseEntry) as never;
      },

      getLabel: async (id) => {
        const labels = await runPromise(
          sql<PmSessionEntryRow>`
            SELECT
              entry_id AS "entryId",
              parent_id AS "parentId",
              type,
              timestamp,
              payload_json AS "payloadJson"
            FROM pm_session_entries
            WHERE session_id = ${sessionId}
              AND type = 'label'
            ORDER BY timestamp ASC, entry_id ASC
          `,
        );
        let value: string | undefined;
        for (const row of labels) {
          const entry = parseEntry(row);
          if (entry.type !== "label" || entry.targetId !== id) continue;
          const label = entry.label?.trim();
          value = label ? label : undefined;
        }
        return value;
      },

      getPathToRoot: async (leafId) => {
        await runPromise(ensureSession);
        if (leafId === null) return [];

        const path: SessionTreeEntry[] = [];
        let currentId: string | null = leafId;
        while (currentId !== null) {
          const row = await runPromise(readEntry(currentId));
          if (!row) {
            throw new SessionError("not_found", `Entry ${currentId} not found`);
          }
          const entry = parseEntry(row);
          path.unshift(entry);
          currentId = entry.parentId;
        }
        return path;
      },

      getEntries: async () => {
        await runPromise(ensureSession);
        const rows = await runPromise(
          sql<PmSessionEntryRow>`
            SELECT
              entry_id AS "entryId",
              parent_id AS "parentId",
              type,
              timestamp,
              payload_json AS "payloadJson"
            FROM pm_session_entries
            WHERE session_id = ${sessionId}
            ORDER BY timestamp ASC, entry_id ASC
          `,
        );
        return rows.map(parseEntry);
      },
    } satisfies SessionStorage<TMetadata>;
  });
