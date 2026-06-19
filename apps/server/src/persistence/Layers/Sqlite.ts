import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import {
  DEFAULT_PERSISTENCE_RETRY_POLICY,
  type PersistenceRetryPolicy,
  PersistenceRetryPolicyService,
} from "../retryPolicy.ts";
import { ServerConfig } from "../../config.ts";

type RuntimeSqliteLayerConfig = {
  readonly filename: string;
  readonly spanAttributes?: Record<string, unknown>;
};

type Loader = {
  layer: (config: RuntimeSqliteLayerConfig) => Layer.Layer<SqlClient.SqlClient>;
};
const defaultSqliteClientLoaders = {
  bun: () => import("@effect/sql-sqlite-bun/SqliteClient"),
  node: () => import("../NodeSqliteClient.ts"),
} satisfies Record<string, () => Promise<Loader>>;

const makeRuntimeSqliteLayer = Effect.fn("makeRuntimeSqliteLayer")(function* (
  config: RuntimeSqliteLayerConfig,
) {
  const runtime = process.versions.bun !== undefined ? "bun" : "node";
  const loader = defaultSqliteClientLoaders[runtime];
  const clientModule = yield* Effect.promise<Loader>(loader);
  return clientModule.layer(config);
}, Layer.unwrap);

/**
 * Connection setup applied once per SQLite client, for *both* the node and bun
 * loaders (they share this layer). `busy_timeout` makes SQLite block — rather
 * than immediately fail with `SQLITE_BUSY` — for up to `busyTimeoutMs` while a
 * concurrent writer holds the lock; the application-level {@link withBusyRetry}
 * backstops the residual cases. The value is a controlled integer (no binding
 * is possible for PRAGMA arguments), so `sql.unsafe` is safe here.
 */
const makeSetup = (busyTimeoutMs: number) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`PRAGMA journal_mode = WAL;`;
      yield* sql`PRAGMA foreign_keys = ON;`;
      yield* sql.unsafe(`PRAGMA busy_timeout = ${Math.trunc(busyTimeoutMs)};`);
      yield* runMigrations();
    }),
  );

export const makeSqlitePersistenceLive = Effect.fn("makeSqlitePersistenceLive")(function* (
  dbPath: string,
  policy: PersistenceRetryPolicy = DEFAULT_PERSISTENCE_RETRY_POLICY,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fs.makeDirectory(path.dirname(dbPath), { recursive: true });

  return Layer.merge(
    Layer.provideMerge(
      makeSetup(policy.busyTimeoutMs),
      makeRuntimeSqliteLayer({
        filename: dbPath,
        spanAttributes: {
          "db.name": path.basename(dbPath),
          "service.name": "t3-server",
        },
      }),
    ),
    PersistenceRetryPolicyService.layer(policy),
  );
}, Layer.unwrap);

export const makeSqlitePersistenceMemory = (
  policy: PersistenceRetryPolicy = DEFAULT_PERSISTENCE_RETRY_POLICY,
) =>
  Layer.merge(
    Layer.provideMerge(
      makeSetup(policy.busyTimeoutMs),
      makeRuntimeSqliteLayer({ filename: ":memory:" }),
    ),
    PersistenceRetryPolicyService.layer(policy),
  );

export const SqlitePersistenceMemory = makeSqlitePersistenceMemory();

export const layerConfig = Layer.unwrap(
  Effect.map(Effect.service(ServerConfig), ({ dbPath, persistence }) =>
    makeSqlitePersistenceLive(dbPath, persistence ?? DEFAULT_PERSISTENCE_RETRY_POLICY),
  ),
);
