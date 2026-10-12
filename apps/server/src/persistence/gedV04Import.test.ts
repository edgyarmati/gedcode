// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";

import { runMigrations } from "./Migrations.ts";
import { rewriteGedV04Snapshot } from "./gedV04Import.ts";

/** The first and last of v0.4's own migrations, as its ledger recorded them. */
const GED_V04_LEDGER = [
  [31, "ProjectionThreadsGedWorkflowEnabled"],
  [80, "ProjectionThreadMessageQueue"],
] as const;

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

const count = (database: NodeSqlite.DatabaseSync, sql: string) =>
  Number(database.prepare(sql).get()?.count);

it.effect("rewrites a v0.4 snapshot so upstream migrations apply and threads stay", () =>
  withTempDatabase((path) =>
    Effect.gen(function* () {
      yield* seedSharedSchema(path);
      const v04 = new NodeSqlite.DatabaseSync(path);
      try {
        const record = v04.prepare(
          "INSERT INTO effect_sql_migrations (migration_id, name) VALUES (?, ?)",
        );
        for (const [id, name] of GED_V04_LEDGER) record.run(id, name);
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

it.effect("leaves a database whose later migrations are not v0.4's untouched", () =>
  withTempDatabase((path) =>
    Effect.gen(function* () {
      yield* seedSharedSchema(path);
      const other = new NodeSqlite.DatabaseSync(path);
      try {
        other
          .prepare("INSERT INTO effect_sql_migrations (migration_id, name) VALUES (?, ?)")
          .run(31, "SomethingElse");
      } finally {
        other.close();
      }
      const before = NodeFS.readFileSync(path);
      assert.isFalse(rewriteGedV04Snapshot(path));
      assert.deepEqual(NodeFS.readFileSync(path), before);
    }),
  ),
);
