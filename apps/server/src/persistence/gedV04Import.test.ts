// @effect-diagnostics nodeBuiltinImport:off -- Synchronous synthetic SQLite fixtures and file assertions.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import * as ServerConfig from "../config.ts";
import * as EventStore from "../orchestration-v2/EventStore.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as LegacyV1ThreadImporter from "../orchestration-v2/legacy/LegacyV1ThreadImporter.ts";
import * as SqlitePersistence from "./Sqlite.ts";
import { migrationManifest } from "./Migrations.ts";
import { GedV04UpgradeError, upgradeGedV04Database } from "./gedV04Import.ts";
import { initializeV2Database } from "./initializeV2Database.ts";
import { attachments, seedGedV04 } from "./fixtures/gedV04.ts";

const withTemp = <A, E, R>(use: (directory: string) => Effect.Effect<A, E, R>) => {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "ged-v04-"));
  return use(directory).pipe(
    Effect.ensuring(Effect.sync(() => NodeFS.rmSync(directory, { recursive: true, force: true }))),
  );
};

const withDatabase = <A>(path: string, use: (database: NodeSqlite.DatabaseSync) => A) => {
  const database = new NodeSqlite.DatabaseSync(path);
  try {
    return use(database);
  } finally {
    database.close();
  }
};

const backups = (directory: string) =>
  NodeFS.readdirSync(directory).filter((name) => name.startsWith("ged-v04-recovery-"));
const assertCurrent = (path: string) =>
  withDatabase(path, (database) => {
    assert.deepEqual(
      database
        .prepare("SELECT migration_id, name FROM effect_sql_migrations ORDER BY migration_id")
        .all()
        .map((row) => [row.migration_id, row.name]),
      migrationManifest.map((row) => [...row]),
    );
    assert.equal(
      database.prepare("SELECT default_thread_env_mode FROM projection_projects").get()
        ?.default_thread_env_mode,
      null,
    );
    assert.equal(
      database.prepare("SELECT count(*) AS count FROM projection_thread_messages").get()?.count,
      6,
    );
    const summary = database
      .prepare(
        "SELECT latest_user_message_at, pending_approval_count, pending_user_input_count, has_actionable_proposed_plan FROM projection_threads",
      )
      .get();
    assert.equal(summary?.latest_user_message_at, "2026-01-05T00:00:00.000Z");
    assert.equal(summary?.pending_approval_count, 1);
    assert.equal(summary?.pending_user_input_count, 1);
    assert.equal(summary?.has_actionable_proposed_plan, 1);
    assert.equal(
      database
        .prepare("SELECT count(*) AS count FROM sqlite_master WHERE name = 'pm_sessions'")
        .get()?.count,
      0,
    );
  });

it.effect.each([
  { omni: false, missingSummary: false },
  { omni: false, missingSummary: true },
  { omni: true, missingSummary: false },
  { omni: true, missingSummary: true },
])("upgrades the historical lineage: %j", ({ omni, missingSummary }) =>
  withTemp((directory) =>
    Effect.gen(function* () {
      const path = NodePath.join(directory, "snapshot.sqlite");
      seedGedV04(path, { omni, missingSummary });
      assert.isTrue(yield* upgradeGedV04Database(path));
      assertCurrent(path);
      const before = NodeFS.readFileSync(path);
      assert.isFalse(yield* upgradeGedV04Database(path));
      assert.deepEqual(NodeFS.readFileSync(path), before);
      assert.deepEqual(backups(directory), []);
    }).pipe(Effect.provide(NodeServices.layer)),
  ),
);

it.effect.each(["fresh", "existing", "source-absent"] as const)(
  "%s Omni upgrade backfills a nullable plan summary without a default",
  (mode) =>
    withTemp((directory) =>
      Effect.gen(function* () {
        const source = NodePath.join(directory, "state.sqlite");
        const destination = NodePath.join(directory, "statev2.sqlite");
        const legacyPath = mode === "source-absent" ? destination : source;
        seedGedV04(legacyPath, { omni: true });
        withDatabase(legacyPath, (database) => {
          // Observed historical Omni shape: derived INTEGER column, nullable, no default.
          database.exec(`ALTER TABLE projection_threads DROP COLUMN has_actionable_proposed_plan;
            ALTER TABLE projection_threads ADD COLUMN has_actionable_proposed_plan INTEGER`);
          assert.isNull(
            database.prepare("SELECT has_actionable_proposed_plan FROM projection_threads").get()
              ?.has_actionable_proposed_plan,
          );
        });
        const original = NodeFS.readFileSync(legacyPath);
        if (mode === "existing") NodeFS.copyFileSync(source, destination);

        yield* initializeV2Database(destination);

        assertCurrent(destination);
        withDatabase(destination, (database) => {
          const column = database
            .prepare(
              "SELECT type, \"notnull\", dflt_value FROM pragma_table_info('projection_threads') WHERE name = 'has_actionable_proposed_plan'",
            )
            .get();
          assert.deepEqual(column, { type: "INTEGER", notnull: 0, dflt_value: null });
        });
        if (mode === "source-absent") assert.isFalse(NodeFS.existsSync(source));
        else assert.deepEqual(NodeFS.readFileSync(source), original);
        assert.equal(backups(directory).length, mode === "fresh" ? 0 : 1);
        if (mode !== "fresh") {
          const backup = NodePath.join(directory, backups(directory)[0]!, "statev2.sqlite");
          withDatabase(backup, (database) =>
            assert.isNull(
              database.prepare("SELECT has_actionable_proposed_plan FROM projection_threads").get()
                ?.has_actionable_proposed_plan,
            ),
          );
        }
        const upgraded = NodeFS.readFileSync(destination);
        yield* initializeV2Database(destination);
        assert.deepEqual(NodeFS.readFileSync(destination), upgraded);
      }).pipe(Effect.provide(NodeServices.layer)),
    ),
);

it.effect("accepts an older release's shorter migration prefix", () =>
  withTemp((directory) =>
    Effect.gen(function* () {
      const path = NodePath.join(directory, "snapshot.sqlite");
      seedGedV04(path, { through: 76 });
      assert.isTrue(yield* upgradeGedV04Database(path));
      assertCurrent(path);
    }).pipe(Effect.provide(NodeServices.layer)),
  ),
);

it.effect.each([
  [
    "unknown fork name",
    "UPDATE effect_sql_migrations SET name = 'Unknown' WHERE migration_id = 40",
  ],
  [
    "shared name mismatch",
    "UPDATE effect_sql_migrations SET name = 'Other' WHERE migration_id = 7",
  ],
  [
    "half Omni pair",
    "UPDATE effect_sql_migrations SET name = 'OmniPromptProjectionTables' WHERE migration_id = 23",
  ],
  ["missing shared id", "DELETE FROM effect_sql_migrations WHERE migration_id = 5"],
  ["fork gap", "DELETE FROM effect_sql_migrations WHERE migration_id = 40"],
  [
    "unexpected version",
    "INSERT INTO effect_sql_migrations (migration_id, name) VALUES (81, 'Unknown')",
  ],
  [
    "unexpected zero id",
    "INSERT INTO effect_sql_migrations (migration_id, name) VALUES (0, 'Unknown')",
  ],
] as const)("fails closed on %s without modifying or publishing it", ([, mutation]) =>
  withTemp((directory) =>
    Effect.gen(function* () {
      const source = NodePath.join(directory, "state.sqlite");
      const destination = NodePath.join(directory, "statev2.sqlite");
      seedGedV04(source);
      withDatabase(source, (database) => database.exec(mutation));
      const before = NodeFS.readFileSync(source);
      const result = yield* Effect.result(upgradeGedV04Database(source, true));
      assert.equal(result._tag, "Failure");
      if (result._tag === "Failure") {
        assert.instanceOf(result.failure, GedV04UpgradeError);
        assert.equal(result.failure.reason, "unsupported-ledger");
      }
      assert.equal((yield* Effect.result(initializeV2Database(destination)))._tag, "Failure");
      assert.isFalse(NodeFS.existsSync(destination));
      assert.deepEqual(NodeFS.readFileSync(source), before);
      assert.deepEqual(backups(directory), []);
    }).pipe(Effect.provide(NodeServices.layer)),
  ),
);

it.effect.each([
  "CREATE TABLE orchestration_v2_projection_threads (payload_json TEXT)",
  "CREATE TABLE orchestration_v2_legacy_imports (thread_id TEXT)",
  "CREATE TABLE orchestration_v2_events (payload_json TEXT)",
  `ALTER TABLE orchestration_events ADD COLUMN application_event_version INTEGER DEFAULT 1;
   INSERT INTO orchestration_events (event_id, aggregate_kind, stream_id, stream_version, event_type, occurred_at, actor_kind, payload_json, metadata_json, application_event_version)
   VALUES ('new-v2-work', 'thread', 'new-thread', 1, 'thread.created', '2026-01-01', 'user', '{}', '{}', 2)`,
])("refuses mixed legacy/V2 evidence: %s", (evidence) =>
  withTemp((directory) =>
    Effect.gen(function* () {
      const path = NodePath.join(directory, "statev2.sqlite");
      seedGedV04(path, { omni: true });
      withDatabase(path, (database) => database.exec(evidence));
      const before = NodeFS.readFileSync(path);
      const result = yield* Effect.result(upgradeGedV04Database(path, true));
      assert.equal(result._tag, "Failure");
      if (result._tag === "Failure") assert.equal(result.failure.reason, "v2-evidence");
      assert.deepEqual(NodeFS.readFileSync(path), before);
      assert.deepEqual(backups(directory), []);
    }).pipe(Effect.provide(NodeServices.layer)),
  ),
);

it.effect("backs up committed WAL, rolls back a failed transformation, and retries safely", () =>
  withTemp((directory) =>
    Effect.gen(function* () {
      const destination = NodePath.join(directory, "statev2.sqlite");
      seedGedV04(destination, { omni: true, missingSummary: true });
      const writer = new NodeSqlite.DatabaseSync(destination);
      try {
        writer.exec(`PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0;
      UPDATE projection_threads SET title = 'Committed WAL conversation';
      CREATE TRIGGER fail_upgrade BEFORE DELETE ON effect_sql_migrations BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;`);
        assert.isTrue(NodeFS.statSync(`${destination}-wal`).size > 0);
        assert.equal((yield* Effect.result(initializeV2Database(destination)))._tag, "Failure");
        assert.equal(backups(directory).length, 1);
        const backupPath = NodePath.join(directory, backups(directory)[0]!, "statev2.sqlite");
        for (const path of [destination, backupPath])
          withDatabase(path, (database) => {
            assert.equal(
              database.prepare("SELECT title FROM projection_threads").get()?.title,
              "Committed WAL conversation",
            );
            assert.equal(
              database.prepare("SELECT max(migration_id) AS id FROM effect_sql_migrations").get()
                ?.id,
              80,
            );
            assert.equal(
              database
                .prepare("SELECT count(*) AS count FROM sqlite_master WHERE name = 'pm_sessions'")
                .get()?.count,
              1,
            );
            assert.equal(
              database
                .prepare(
                  "SELECT count(*) AS count FROM pragma_table_info('projection_threads') WHERE name = 'latest_user_message_at'",
                )
                .get()?.count,
              0,
            );
          });
        writer.exec("DROP TRIGGER fail_upgrade");
        yield* initializeV2Database(destination);
        assertCurrent(destination);
        assert.equal(backups(directory).length, 2);
        yield* initializeV2Database(destination);
        assert.equal(backups(directory).length, 2);
        withDatabase(backupPath, (database) =>
          assert.equal(
            database.prepare("SELECT max(migration_id) AS id FROM effect_sql_migrations").get()?.id,
            80,
          ),
        );
      } finally {
        writer.close();
      }
    }).pipe(Effect.provide(NodeServices.layer)),
  ),
);

it.effect("does not transform the destination if the durable backup fails", () =>
  withTemp((directory) =>
    Effect.gen(function* () {
      const path = NodePath.join(directory, "statev2.sqlite");
      seedGedV04(path);
      const before = NodeFS.readFileSync(path);
      const fs = yield* FileSystem.FileSystem;
      // An unwritable backup target is deterministic without platform permission assumptions.
      const brokenFs = FileSystem.FileSystem.of({
        ...fs,
        makeTempDirectory: () => Effect.succeed(NodePath.join(directory, "absent", "backup")),
      });
      assert.equal(
        (yield* Effect.result(
          initializeV2Database(path).pipe(Effect.provideService(FileSystem.FileSystem, brokenFs)),
        ))._tag,
        "Failure",
      );
      assert.deepEqual(NodeFS.readFileSync(path), before);
    }).pipe(Effect.provide(NodeServices.layer)),
  ),
);

it.effect(
  "rejects invalid existing summary capabilities rather than claiming the migrations applied",
  () =>
    withTemp((directory) =>
      Effect.gen(function* () {
        const path = NodePath.join(directory, "statev2.sqlite");
        seedGedV04(path);
        withDatabase(path, (database) =>
          database.exec(
            "ALTER TABLE projection_threads DROP COLUMN pending_approval_count; ALTER TABLE projection_threads ADD COLUMN pending_approval_count TEXT",
          ),
        );
        const before = NodeFS.readFileSync(path);
        const result = yield* Effect.result(upgradeGedV04Database(path, true));
        assert.equal(result._tag, "Failure");
        if (result._tag === "Failure") assert.equal(result.failure.reason, "invalid-shell-summary");
        assert.deepEqual(NodeFS.readFileSync(path), before);
        assert.equal(backups(directory).length, 1);
      }).pipe(Effect.provide(NodeServices.layer)),
    ),
);

it.effect("initial publication never clobbers a destination created concurrently", () =>
  withTemp((directory) =>
    Effect.gen(function* () {
      const source = NodePath.join(directory, "state.sqlite");
      const destination = NodePath.join(directory, "statev2.sqlite");
      seedGedV04(source, { omni: true });
      const fs = yield* FileSystem.FileSystem;
      const racingFs = FileSystem.FileSystem.of({
        ...fs,
        link: (from, to) =>
          Effect.gen(function* () {
            NodeFS.writeFileSync(destination, "concurrent V2 winner");
            return yield* fs.link(from, to);
          }),
      });
      yield* initializeV2Database(destination).pipe(
        Effect.provideService(FileSystem.FileSystem, racingFs),
      );
      assert.equal(NodeFS.readFileSync(destination, "utf8"), "concurrent V2 winner");
    }).pipe(Effect.provide(NodeServices.layer)),
  ),
);

it.effect.each(["fresh", "existing", "source-absent"] as const)(
  "%s upgrade preserves transcripts and attachments through the actual V2 importer",
  (mode) =>
    withTemp((directory) =>
      Effect.gen(function* () {
        const source = NodePath.join(directory, "state.sqlite");
        const destination = NodePath.join(directory, "statev2.sqlite");
        seedGedV04(mode === "source-absent" ? destination : source, {
          omni: mode !== "fresh",
          missingSummary: mode === "source-absent",
        });
        if (mode === "existing") NodeFS.copyFileSync(source, destination);
        const original = mode === "source-absent" ? undefined : NodeFS.readFileSync(source);
        const config = yield* ServerConfig.ServerConfig;
        const database = SqlitePersistence.layerConfig.pipe(
          Layer.provide(ServerConfig.layer({ ...config, dbPath: destination })),
        );
        const stores = Layer.mergeAll(EventStore.layer, ProjectionStore.layer).pipe(
          Layer.provideMerge(database),
        );
        const importer = LegacyV1ThreadImporter.layer.pipe(
          Layer.provideMerge(Layer.mergeAll(stores, EventSink.layer.pipe(Layer.provide(stores)))),
        );
        yield* Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          const legacy = yield* LegacyV1ThreadImporter.LegacyV1ThreadImporter;
          const projections = yield* ProjectionStore.ProjectionStoreV2;
          const threadId = ThreadId.make("legacy-thread");
          yield* legacy.reconcileShells;
          assert.deepEqual(
            (yield* projections.getThreadProjection(threadId)).messages.map(
              (message) => message.text,
            ),
            ["Text 4", "Text 5"],
          );
          yield* legacy.ensureTranscript(threadId);
          const transcript = yield* projections.getThreadProjection(threadId);
          assert.deepEqual(
            transcript.messages.map((message) => [message.role, message.text]),
            Array.from({ length: 6 }, (_, index) => [
              index % 2 ? "assistant" : "user",
              `Text ${index}`,
            ]),
          );
          assert.deepEqual(transcript.messages[0]?.attachments, attachments);
          assert.equal(
            (yield* sql`SELECT imported_message_count FROM orchestration_v2_legacy_imports`)[0]
              ?.imported_message_count,
            6,
          );
          assert.equal((yield* sql`SELECT title FROM projection_projects`)[0]?.title, "Project");
          assert.equal((yield* legacy.reconcileShells).importedThreadCount, 0);
          assert.equal((yield* legacy.ensureTranscript(threadId)).importedMessageCount, 0);
          yield* sql`UPDATE projection_threads SET title = 'Newer V2 work'`;
        }).pipe(Effect.provide(importer));
        const after = NodeFS.readFileSync(destination);
        yield* initializeV2Database(destination);
        assert.deepEqual(NodeFS.readFileSync(destination), after);
        assert.equal(backups(directory).length, mode === "fresh" ? 0 : 1);
        if (original !== undefined) assert.deepEqual(NodeFS.readFileSync(source), original);
        else assert.isFalse(NodeFS.existsSync(source));
      }).pipe(
        Effect.provide(
          ServerConfig.layerTest(directory, directory).pipe(Layer.provideMerge(NodeServices.layer)),
        ),
      ),
    ),
);

it.effect("rolls back normalization if a real upstream migration fails", () =>
  withTemp((directory) =>
    Effect.gen(function* () {
      const path = NodePath.join(directory, "statev2.sqlite");
      seedGedV04(path, { omni: true });
      // A malformed table makes upstream50's index creation fail after normalization.
      withDatabase(path, (database) =>
        database.exec("CREATE TABLE projection_thread_pull_requests (unexpected TEXT)"),
      );
      const before = NodeFS.readFileSync(path);
      const result = yield* Effect.result(upgradeGedV04Database(path, true));
      assert.equal(result._tag, "Failure");
      if (result._tag === "Failure") assert.equal(result.failure.reason, "database-operation");
      assert.deepEqual(NodeFS.readFileSync(path), before);
      assert.equal(backups(directory).length, 1);
      withDatabase(path, (database) => database.exec("DROP TABLE projection_thread_pull_requests"));
      yield* initializeV2Database(path);
      assertCurrent(path);
    }).pipe(Effect.provide(NodeServices.layer)),
  ),
);

it.effect("holds the writer lock before taking the recovery backup", () =>
  withTemp((directory) =>
    Effect.gen(function* () {
      const path = NodePath.join(directory, "statev2.sqlite");
      seedGedV04(path);
      const fs = yield* FileSystem.FileSystem;
      const lockedFs = FileSystem.FileSystem.of({
        ...fs,
        makeTempDirectory: (options) =>
          Effect.gen(function* () {
            withDatabase(path, (otherWriter) => {
              otherWriter.exec("PRAGMA busy_timeout = 0");
              assert.throws(
                () => otherWriter.exec("UPDATE projection_threads SET title = 'Concurrent work'"),
                /locked/,
              );
            });
            return yield* fs.makeTempDirectory(options);
          }),
      });
      yield* initializeV2Database(path).pipe(
        Effect.provideService(FileSystem.FileSystem, lockedFs),
      );
      assertCurrent(path);
      withDatabase(path, (database) =>
        assert.equal(
          database.prepare("SELECT title FROM projection_threads").get()?.title,
          "Legacy conversation",
        ),
      );
    }).pipe(Effect.provide(NodeServices.layer)),
  ),
);

it.effect("leaves unrelated ledgers and genuine V2 work untouched", () =>
  withTemp((directory) =>
    Effect.gen(function* () {
      const path = NodePath.join(directory, "statev2.sqlite");
      withDatabase(path, (database) =>
        database.exec(`CREATE TABLE effect_sql_migrations (migration_id INTEGER PRIMARY KEY, name TEXT);
    INSERT INTO effect_sql_migrations VALUES (31, 'Unrelated');
    CREATE TABLE orchestration_events (application_event_version INTEGER, payload_json TEXT);
    INSERT INTO orchestration_events VALUES (2, 'newer work');`),
      );
      const before = NodeFS.readFileSync(path);
      yield* initializeV2Database(path);
      assert.deepEqual(NodeFS.readFileSync(path), before);
      assert.deepEqual(backups(directory), []);
    }).pipe(Effect.provide(NodeServices.layer)),
  ),
);

it.effect(
  "upgrades a fresh WAL snapshot without altering the source or importing uncommitted work",
  () =>
    withTemp((directory) =>
      Effect.gen(function* () {
        const source = NodePath.join(directory, "state.sqlite");
        const destination = NodePath.join(directory, "statev2.sqlite");
        seedGedV04(source, { omni: true, missingSummary: true });
        const writer = new NodeSqlite.DatabaseSync(source);
        try {
          writer.exec(`PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0;
      UPDATE projection_threads SET title = 'Committed source WAL';
      BEGIN; UPDATE projection_thread_messages SET text = 'uncommitted';`);
          const original = NodeFS.readFileSync(source);
          const wal = NodeFS.readFileSync(`${source}-wal`);
          yield* initializeV2Database(destination);
          assertCurrent(destination);
          withDatabase(destination, (database) => {
            assert.equal(
              database.prepare("SELECT title FROM projection_threads").get()?.title,
              "Committed source WAL",
            );
            assert.equal(
              database
                .prepare(
                  "SELECT text FROM projection_thread_messages WHERE message_id = 'message-0'",
                )
                .get()?.text,
              "Text 0",
            );
          });
          assert.deepEqual(NodeFS.readFileSync(source), original);
          assert.deepEqual(NodeFS.readFileSync(`${source}-wal`), wal);
          writer.exec("ROLLBACK");
        } finally {
          writer.close();
        }
      }).pipe(Effect.provide(NodeServices.layer)),
    ),
);
