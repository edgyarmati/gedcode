// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";

import { runMigrations } from "./Migrations.ts";
import { GED_V04_MIGRATIONS, rewriteGedV04Snapshot } from "./gedV04Import.ts";
import { initializeV2Database } from "./initializeV2Database.ts";

const seedSharedSchema = (path: string) =>
  runMigrations({ toMigrationInclusive: 30 }).pipe(
    Effect.provide(NodeSqliteClient.layer({ filename: path })),
  );

const withTempDatabase = <A, E, R>(use: (path: string) => Effect.Effect<A, E, R>) => {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "ged-v04-"));
  return use(NodePath.join(directory, "snapshot.sqlite")).pipe(
    Effect.ensuring(Effect.sync(() => NodeFS.rmSync(directory, { recursive: true, force: true }))),
  );
};

const recordLedger = (
  database: NodeSqlite.DatabaseSync,
  rows: ReadonlyArray<readonly [number, string]>,
) => {
  const record = database.prepare(
    "INSERT INTO effect_sql_migrations (migration_id, name) VALUES (?, ?)",
  );
  for (const [id, name] of rows) record.run(id, name);
};

/** Seeds a ledger and asserts the rewrite leaves the file byte-identical. */
const expectUntouched = (path: string, seed: (database: NodeSqlite.DatabaseSync) => void) => {
  const database = new NodeSqlite.DatabaseSync(path);
  try {
    seed(database);
  } finally {
    database.close();
  }
  const before = NodeFS.readFileSync(path);
  assert.isFalse(rewriteGedV04Snapshot(path));
  assert.deepEqual(NodeFS.readFileSync(path), before);
};

const v04Ledger = [...GED_V04_MIGRATIONS];

const count = (database: NodeSqlite.DatabaseSync, sql: string) =>
  Number(database.prepare(sql).get()?.count);

it.effect("rewrites a v0.4 snapshot so upstream migrations apply and threads stay", () =>
  withTempDatabase((path) =>
    Effect.gen(function* () {
      yield* seedSharedSchema(path);
      const v04 = new NodeSqlite.DatabaseSync(path);
      try {
        recordLedger(v04, [...GED_V04_MIGRATIONS]);
        v04.exec("CREATE TABLE pm_sessions (session_id TEXT PRIMARY KEY)");
        v04.exec("INSERT INTO pm_sessions VALUES ('pm')");
        v04.exec("ALTER TABLE projection_threads ADD COLUMN ged_workflow_enabled INTEGER");
        v04.exec(`INSERT INTO projection_projects (project_id, title, workspace_root, scripts_json, created_at, updated_at)
          VALUES ('project', 'Project', '/tmp/project', '[]', '2026-01-01', '2026-01-01')`);
        v04.exec(`INSERT INTO projection_threads (thread_id, project_id, title, model_selection_json, runtime_mode, interaction_mode, created_at, updated_at, ged_workflow_enabled)
          VALUES ('thread', 'project', 'v0.4 thread', '{}', 'full-access', 'default', '2026-01-01', '2026-01-01', 1)`);
      } finally {
        v04.close();
      }

      assert.isTrue(rewriteGedV04Snapshot(path));
      yield* runMigrations().pipe(Effect.provide(NodeSqliteClient.layer({ filename: path })));

      const rewritten = new NodeSqlite.DatabaseSync(path);
      try {
        assert.equal(
          count(
            rewritten,
            "SELECT count(*) AS count FROM sqlite_master WHERE name = 'pm_sessions'",
          ),
          0,
        );
        assert.equal(
          count(
            rewritten,
            "SELECT count(*) AS count FROM projection_threads WHERE thread_id = 'thread'",
          ),
          1,
        );
        assert.equal(
          count(
            rewritten,
            "SELECT count(*) AS count FROM effect_sql_migrations WHERE name = 'ProjectionThreadsGedWorkflowEnabled'",
          ),
          0,
        );
      } finally {
        rewritten.close();
      }
    }),
  ),
);

it.effect("rewrites the shorter ledger of an older 0.4 release", () =>
  withTempDatabase((path) =>
    Effect.gen(function* () {
      yield* seedSharedSchema(path);
      const v04 = new NodeSqlite.DatabaseSync(path);
      try {
        recordLedger(v04, v04Ledger.slice(0, 10));
      } finally {
        v04.close();
      }
      assert.isTrue(rewriteGedV04Snapshot(path));
    }),
  ),
);

it.effect("leaves a database whose later migrations are not v0.4's untouched", () =>
  withTempDatabase((path) =>
    Effect.gen(function* () {
      yield* seedSharedSchema(path);
      expectUntouched(path, (database) => recordLedger(database, [[31, "SomethingElse"]]));
    }),
  ),
);

it.effect("leaves a v0.4-named ledger with a gap untouched", () =>
  withTempDatabase((path) =>
    Effect.gen(function* () {
      yield* seedSharedSchema(path);
      expectUntouched(path, (database) =>
        recordLedger(database, [v04Ledger[0]!, v04Ledger[v04Ledger.length - 1]!]),
      );
    }),
  ),
);

it.effect("leaves a ledger missing shared migrations untouched", () =>
  withTempDatabase((path) =>
    Effect.gen(function* () {
      yield* seedSharedSchema(path);
      expectUntouched(path, (database) => {
        database.exec("DELETE FROM effect_sql_migrations WHERE migration_id = 5");
        recordLedger(database, v04Ledger);
      });
    }),
  ),
);

it.effect("leaves a ledger whose shared migrations are named differently untouched", () =>
  withTempDatabase((path) =>
    Effect.gen(function* () {
      yield* seedSharedSchema(path);
      expectUntouched(path, (database) => {
        database.exec("UPDATE effect_sql_migrations SET name = 'Other' WHERE migration_id = 7");
        recordLedger(database, v04Ledger);
      });
    }),
  ),
);

it.effect("leaves a ledger with an id outside the v0.4 range untouched", () =>
  withTempDatabase((path) =>
    Effect.gen(function* () {
      yield* seedSharedSchema(path);
      expectUntouched(path, (database) => recordLedger(database, [[0, "Extra"], ...v04Ledger]));
    }),
  ),
);

it.effect("imports a v0.4 database into V2 without writing the original", () =>
  withTempDatabase((sourcePath) =>
    Effect.gen(function* () {
      yield* seedSharedSchema(sourcePath);
      const v04 = new NodeSqlite.DatabaseSync(sourcePath);
      try {
        recordLedger(v04, v04Ledger);
        v04.exec("CREATE TABLE pm_sessions (session_id TEXT PRIMARY KEY)");
      } finally {
        v04.close();
      }
      const original = NodeFS.readFileSync(sourcePath);
      const destinationPath = NodePath.join(NodePath.dirname(sourcePath), "statev2.sqlite");
      NodeFS.renameSync(sourcePath, NodePath.join(NodePath.dirname(sourcePath), "state.sqlite"));

      yield* initializeV2Database(destinationPath).pipe(Effect.provide(NodeServices.layer));

      assert.deepEqual(
        NodeFS.readFileSync(NodePath.join(NodePath.dirname(sourcePath), "state.sqlite")),
        original,
      );
      const imported = new NodeSqlite.DatabaseSync(destinationPath, { readOnly: true });
      try {
        assert.equal(
          count(imported, "SELECT count(*) AS count FROM sqlite_master WHERE name = 'pm_sessions'"),
          0,
        );
        assert.equal(
          count(
            imported,
            "SELECT count(*) AS count FROM effect_sql_migrations WHERE migration_id > 30",
          ),
          0,
        );
      } finally {
        imported.close();
      }
    }),
  ),
);
