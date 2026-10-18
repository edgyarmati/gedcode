// @effect-diagnostics nodeBuiltinImport:off -- Subprocess crash injection at an actual normalization write.
import * as NodeSqlite from "node:sqlite";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";

import { initializeV2Database } from "../initializeV2Database.ts";

const prepare = NodeSqlite.DatabaseSync.prototype.prepare;
const configured = new WeakSet<NodeSqlite.DatabaseSync>();
NodeSqlite.DatabaseSync.prototype.prepare = function (sql) {
  if (!configured.has(this)) {
    // Force the real table rewrite to spill dirty pages before the transaction commits.
    this.exec("PRAGMA cache_size = 1; PRAGMA cache_spill = ON");
    configured.add(this);
  }
  const statement = prepare.call(this, sql);
  if (sql === "ALTER TABLE projection_threads DROP COLUMN ged_workflow_enabled") {
    const run = statement.run.bind(statement);
    statement.run = () => {
      run();
      // No SQLite/Effect finalizers: leave the actual upgrade's rollback journal hot.
      process.exit(86);
    };
  }
  return statement;
};

await Effect.runPromise(
  initializeV2Database(process.argv[2]!).pipe(Effect.provide(NodeServices.layer)),
);
throw new Error("The upgrade did not reach the crash injection point");
