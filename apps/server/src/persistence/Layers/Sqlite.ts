import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Option from "effect/Option";

import { CURRENT_SCHEMA_MIGRATION_ID, runMigrations } from "../Migrations.ts";
import { PersistenceMigrationError } from "../Errors.ts";
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
const migrationMarkerPath = (dbPath: string) => `${dbPath}.schema-version`;

export interface MigrationBackupPreparation {
  readonly backupPath: string | null;
  readonly markerPath: string;
}

export const prepareMigrationBackup = Effect.fn("prepareMigrationBackup")(function* (
  dbPath: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const markerPath = migrationMarkerPath(dbPath);
  const databaseExists = yield* fs.exists(dbPath).pipe(Effect.orElseSucceed(() => false));
  if (!databaseExists) {
    return { backupPath: null, markerPath } satisfies MigrationBackupPreparation;
  }

  const recordedVersion = yield* fs.readFileString(markerPath).pipe(
    Effect.map((value) => Number.parseInt(value.trim(), 10)),
    Effect.option,
  );
  if (
    Option.isSome(recordedVersion) &&
    Number.isSafeInteger(recordedVersion.value) &&
    recordedVersion.value === CURRENT_SCHEMA_MIGRATION_ID
  ) {
    return { backupPath: null, markerPath } satisfies MigrationBackupPreparation;
  }

  if (
    Option.isSome(recordedVersion) &&
    Number.isSafeInteger(recordedVersion.value) &&
    recordedVersion.value > CURRENT_SCHEMA_MIGRATION_ID
  ) {
    return yield* Effect.fail(
      new PersistenceMigrationError({
        dbPath,
        backupPath: null,
        cause: `Database schema ${recordedVersion.value} is newer than supported schema ${CURRENT_SCHEMA_MIGRATION_ID}.`,
      }),
    );
  }

  const backupRoot = path.join(path.dirname(dbPath), "migration-backups");
  const backupPath = path.join(
    backupRoot,
    `${path.basename(dbPath)}.before-schema-${CURRENT_SCHEMA_MIGRATION_ID}`,
  );
  const backupExists = yield* fs.exists(backupPath).pipe(Effect.orElseSucceed(() => false));
  if (!backupExists) {
    const stagingPath = `${backupPath}.tmp-${process.pid}`;
    yield* fs.makeDirectory(backupRoot, { recursive: true });
    yield* fs.remove(stagingPath, { recursive: true, force: true });
    yield* fs.makeDirectory(stagingPath, { recursive: true });
    for (const suffix of ["", "-wal", "-shm", ".schema-version"] as const) {
      const source = `${dbPath}${suffix}`;
      if (yield* fs.exists(source).pipe(Effect.orElseSucceed(() => false))) {
        yield* fs.copy(source, path.join(stagingPath, `${path.basename(dbPath)}${suffix}`));
      }
    }
    yield* fs.writeFileString(
      path.join(stagingPath, "RECOVERY.txt"),
      [
        `GedCode pre-migration backup for schema ${CURRENT_SCHEMA_MIGRATION_ID}.`,
        `Original database: ${dbPath}`,
        "Quit GedCode before restoring the database and any -wal/-shm sidecars.",
        `Restore ${path.basename(markerPath)} too when it is present in this backup; otherwise remove the current marker before restarting GedCode.`,
        "Keep this directory until the upgraded application and your data are verified.",
        "",
      ].join("\n"),
    );
    yield* fs.rename(stagingPath, backupPath);
  }

  return { backupPath, markerPath } satisfies MigrationBackupPreparation;
});

const applySqliteSetup = (busyTimeoutMs: number) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`PRAGMA journal_mode = WAL;`;
    yield* sql`PRAGMA foreign_keys = ON;`;
    yield* sql.unsafe(`PRAGMA busy_timeout = ${Math.trunc(busyTimeoutMs)};`);
  });

const makeSetup = (busyTimeoutMs: number) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      yield* applySqliteSetup(busyTimeoutMs);
      yield* runMigrations();
    }),
  );

const makeLiveSetup = (
  busyTimeoutMs: number,
  migration: {
    readonly dbPath: string;
    readonly preparation: MigrationBackupPreparation;
    readonly fileSystem: FileSystem.FileSystem;
  },
) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      yield* applySqliteSetup(busyTimeoutMs);
      yield* Effect.gen(function* () {
        yield* runMigrations();
        const tempMarkerPath = `${migration.preparation.markerPath}.${process.pid}.tmp`;
        yield* migration.fileSystem.writeFileString(
          tempMarkerPath,
          `${CURRENT_SCHEMA_MIGRATION_ID}\n`,
        );
        yield* migration.fileSystem.rename(tempMarkerPath, migration.preparation.markerPath);
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.fail(
            new PersistenceMigrationError({
              dbPath: migration.dbPath,
              backupPath: migration.preparation.backupPath,
              cause,
            }),
          ),
        ),
      );
    }),
  );

export const makeSqlitePersistenceLive = Effect.fn("makeSqlitePersistenceLive")(function* (
  dbPath: string,
  policy: PersistenceRetryPolicy = DEFAULT_PERSISTENCE_RETRY_POLICY,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fs.makeDirectory(path.dirname(dbPath), { recursive: true });
  const migrationPreparation = yield* prepareMigrationBackup(dbPath).pipe(
    Effect.catch((error) =>
      error instanceof PersistenceMigrationError
        ? Effect.fail(error)
        : Effect.fail(
            new PersistenceMigrationError({
              dbPath,
              backupPath: null,
              cause: error,
            }),
          ),
    ),
  );

  return Layer.merge(
    Layer.provideMerge(
      makeLiveSetup(policy.busyTimeoutMs, {
        dbPath,
        preparation: migrationPreparation,
        fileSystem: fs,
      }),
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
