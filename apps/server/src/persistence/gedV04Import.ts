import * as NodeSqlite from "node:sqlite";

import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import { migrationManifest, runMigrations } from "./Migrations.ts";
import shellSummary from "./Migrations/023_ProjectionThreadShellSummary.ts";
import backfillShellSummary from "./Migrations/024_BackfillProjectionThreadShellSummary.ts";

/**
 * GedCode v0.4 recorded its own migrations at ids 31+ in the shared ledger, so the V2 migrator
 * would treat upstream's 31+ as already applied. Two known lineages differ at ids 23/24.
 */
export const GED_V04_MIGRATIONS: ReadonlyMap<number, string> = new Map(
  [
    "ProjectionThreadsGedWorkflowEnabled",
    "ProjectionProjectRoleModelSelections",
    "ProjectionTasks",
    "ProjectionAwaitedStagesAndPendingGates",
    "PmSessionEntries",
    "PmRuntimeCursorAndConsumedSettlements",
    "ProjectionProjectOrchestratorConfig",
    "PmConsumedSettlementsStatus",
    "ProviderQuotaStatus",
    "ProjectionQuotaBlockedStages",
    "ProjectionStageHistoryAndRoleOverrides",
    "ProjectionTaskPrUrl",
    "ProjectionThreadLastClearedSequence",
    "ProjectionThreadPendingPmHandoff",
    "BackfillProjectionProjectOrchestratorConfig",
    "ProjectionTaskCancellation",
    "ProjectionTaskLanding",
    "ProjectionTaskRetention",
    "ProjectionTaskSupersession",
    "ProjectionStageRuntimeMode",
    "ProjectionTaskSplitting",
    "ProjectionTaskSplitDetails",
    "ProjectionTaskReleaseDispatch",
    "RemoveLegacyOrchestrationRoleSettings",
    "RemoveLegacyOrchestrationStageHistory",
    "ProjectionTaskCompletionRecords",
    "ProjectionStageCapabilityPreset",
    "ProjectionTaskCapabilityTiers",
    "ProjectionHelperRuns",
    "ProjectionProjectContextOnboarding",
    "ProjectionProjectContextRuns",
    "ProjectContextRunReviewResolution",
    "ProjectContextRunPmHold",
    "ProjectContextRunAppliedResolution",
    "ProjectionStageStartHead",
    "SettleLegacyProjectContextRuns",
    "RemoveLegacyProjectContextOnboarding",
    "ProjectionPendingGatePullRequest",
    "ProjectionThreadOrchestrationOwnership",
    "ProjectionStageHistoryNetworkAccess",
    "PmLifecycleDeliveryRecovery",
    "ProjectionStageCapabilityPauseDeadline",
    "PmLifecycleDeliveryEpisodes",
    "ProjectionThreadInboxLifecycle",
    "ProjectionThreadInboxWakeAt",
    "ProjectionTaskForceLandRequest",
    "RemoveProjectionThreadInboxLifecycle",
    "HashAuthPairingCredentials",
    "OrchestrationCommandFingerprints",
    "ProjectionThreadMessageQueue",
  ].map((name, index) => [index + 31, name]),
);

const LAST_SHARED_MIGRATION_ID = 30;

/** Tables only the v0.4 PM orchestrator used. Their history does not carry into V2. */
const GED_V04_TABLES = [
  "pm_consumed_settlements",
  "pm_runtime_cursor",
  "pm_session_entries",
  "pm_sessions",
  "projection_awaited_stages",
  "projection_helper_runs",
  "projection_pending_gates",
  "projection_project_context_runs",
  "projection_provider_quota_status",
  "projection_quota_blocked_stages",
  "projection_stage_history",
  "projection_tasks",
];

/** Columns v0.4 added to shared tables. `command_fingerprint` is NOT NULL without a default. */
const GED_V04_COLUMNS: ReadonlyArray<readonly [table: string, column: string]> = [
  ["orchestration_command_receipts", "command_fingerprint"],
  ["projection_projects", "orchestrator_config_json"],
  ["projection_projects", "role_model_selections_json"],
  ["projection_projects", "role_prompt_prefixes_json"],
  ["projection_threads", "ged_workflow_enabled"],
  ["projection_threads", "inbox_lifecycle"],
  ["projection_threads", "inbox_wake_at"],
  ["projection_threads", "last_cleared_sequence"],
  ["projection_threads", "message_queue_enabled"],
  ["projection_threads", "orchestration_ownership_json"],
  ["projection_threads", "pending_pm_handoff_json"],
  ["projection_threads", "queued_messages_json"],
];

const SHARED_MIGRATIONS: ReadonlyMap<number, string> = new Map(
  migrationManifest.filter(([id]) => id <= LAST_SHARED_MIGRATION_ID),
);

export class GedV04UpgradeError extends Schema.TaggedError<GedV04UpgradeError>()(
  "GedV04UpgradeError",
  {
    databasePath: Schema.String,
    reason: Schema.Literals([
      "unsupported-ledger",
      "v2-evidence",
      "invalid-shell-summary",
      "database-operation",
    ]),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    switch (this.reason) {
      case "unsupported-ledger":
        return "GedCode upgrade refused an unrecognized legacy migration history. The database was not changed.";
      case "v2-evidence":
        return "GedCode upgrade refused a mixed legacy/V2 database. Preserve it for manual recovery; it was not changed.";
      case "invalid-shell-summary":
        return "GedCode could not validate the legacy shell summary schema. The upgrade was rolled back.";
      case "database-operation":
        return "GedCode could not upgrade the legacy database. The upgrade was rolled back; retain the database and recovery backup.";
    }
  }
}

const isGedV04UpgradeError = Schema.is(GedV04UpgradeError);

// Accept the observed Omni pair only as a pair, never arbitrary names under shared ids.
const OMNI_SHARED_NAMES = new Map([
  [23, "OmniPromptProjectionTables"],
  [24, "OmniPromptProjectionIndexes"],
]);

const inspectLegacy = Effect.fnUntraced(function* (databasePath: string) {
  const sql = yield* SqlClient.SqlClient;
  const tables = yield* sql<{ name: string }>`SELECT name FROM sqlite_master WHERE type = 'table'`;
  if (!tables.some(({ name }) => name === "effect_sql_migrations")) return false;
  const rows = yield* sql<{ migration_id: number; name: string }>`
    SELECT migration_id, name FROM effect_sql_migrations ORDER BY migration_id
  `;
  const hasGedNames = rows.some(({ name }) =>
    [...GED_V04_MIGRATIONS.values(), ...OMNI_SHARED_NAMES.values()].includes(name),
  );
  if (!hasGedNames) return false;
  const omni =
    rows[22]?.name === OMNI_SHARED_NAMES.get(23) && rows[23]?.name === OMNI_SHARED_NAMES.get(24);
  const recognized =
    rows.length > LAST_SHARED_MIGRATION_ID &&
    rows.every((row, index) => {
      const id = index + 1;
      const expected =
        id <= LAST_SHARED_MIGRATION_ID
          ? ((omni ? OMNI_SHARED_NAMES.get(id) : undefined) ?? SHARED_MIGRATIONS.get(id))
          : GED_V04_MIGRATIONS.get(id);
      return row.migration_id === id && row.name === expected;
    });
  if (!recognized)
    return yield* new GedV04UpgradeError({ databasePath, reason: "unsupported-ledger" });
  // V2 uses the shared application event log, not only orchestration_v2_events.
  const eventColumns = yield* sql<{ name: string }>`PRAGMA table_info(orchestration_events)`;
  const versionedEvents = eventColumns.some(({ name }) => name === "application_event_version")
    ? yield* sql`SELECT 1 FROM orchestration_events WHERE application_event_version <> 1 LIMIT 1`
    : [];
  if (
    tables.some(({ name }) => name.startsWith("orchestration_v2_")) ||
    versionedEvents.length > 0 ||
    eventColumns.some(({ name }) => name === "application_event_version")
  ) {
    return yield* new GedV04UpgradeError({ databasePath, reason: "v2-evidence" });
  }
  return true;
});

/**
 * Normalize only a known legacy-only Ged lineage, then run the real upstream migrations.
 * Recovery holds BEGIN IMMEDIATE across identity recheck, SQLite backup and transformation:
 * no writer can commit newer V2 work between the backup and rewrite. Never swap live inodes or WALs.
 */
export const upgradeGedV04Database = Effect.fn("upgradeGedV04Database")(
  function* (databasePath: string, recovery = false) {
    // Probe only the owned destination/candidate. A writable connection lets SQLite recover a
    // hot rollback journal after abrupt exit; healthy V2 needs no application writes or backup.
    if (
      !(yield* inspectLegacy(databasePath).pipe(
        Effect.provide(NodeSqliteClient.layer({ filename: databasePath })),
      ))
    )
      return false;

    return yield* Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`PRAGMA busy_timeout = 5000`;
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          if (!(yield* inspectLegacy(databasePath))) return false;
          if (recovery) {
            const fs = yield* FileSystem.FileSystem;
            const path = yield* Path.Path;
            // Deliberately NOT scoped: retain the pre-upgrade archive on success and failure.
            const directory = yield* fs.makeTempDirectory({
              directory: path.dirname(databasePath),
              prefix: "ged-v04-recovery-",
            });
            yield* Effect.tryPromise(async () => {
              const source = new NodeSqlite.DatabaseSync(databasePath, { readOnly: true });
              try {
                await NodeSqlite.backup(source, path.join(directory, "statev2.sqlite"));
              } finally {
                source.close();
              }
            });
          }
          // Migration 23 historically swallowed ALTER errors. Validate its result explicitly,
          // and always run 24: existing columns do not prove their backfill ever ran.
          yield* shellSummary;
          const columns = yield* sql<{
            name: string;
            type: string;
          }>`PRAGMA table_info(projection_threads)`;
          const summaryValid = [
            "latest_user_message_at",
            "pending_approval_count",
            "pending_user_input_count",
            "has_actionable_proposed_plan",
          ].every((name) => {
            const column = columns.find((column) => column.name === name);
            // Historical Omni summaries may be nullable without defaults. The real backfill
            // below derives every existing row; the importer needs types, not those constraints.
            return column?.type === (name === "latest_user_message_at" ? "TEXT" : "INTEGER");
          });
          if (!summaryValid)
            return yield* new GedV04UpgradeError({ databasePath, reason: "invalid-shell-summary" });
          yield* backfillShellSummary;
          for (const table of GED_V04_TABLES) yield* sql.unsafe(`DROP TABLE IF EXISTS ${table}`);
          for (const [table, column] of GED_V04_COLUMNS) {
            const exists =
              yield* sql`SELECT 1 FROM pragma_table_info(${table}) WHERE name = ${column}`;
            if (exists.length > 0) yield* sql.unsafe(`ALTER TABLE ${table} DROP COLUMN ${column}`);
          }
          // These canonical names are truthful only after schema validation and backfill.
          for (const id of [23, 24])
            yield* sql`UPDATE effect_sql_migrations SET name = ${SHARED_MIGRATIONS.get(id)!} WHERE migration_id = ${id}`;
          yield* sql`DELETE FROM effect_sql_migrations WHERE migration_id > ${LAST_SHARED_MIGRATION_ID}`;
          yield* runMigrations();
          return true;
        }),
      );
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: databasePath })));
  },
  (effect, databasePath, _recovery = false) =>
    effect.pipe(
      Effect.mapError((cause) =>
        isGedV04UpgradeError(cause)
          ? cause
          : new GedV04UpgradeError({ databasePath, reason: "database-operation", cause }),
      ),
      // The upstream migrator reports migration failures as defects; keep startup recovery typed.
      Effect.catchDefect((cause) =>
        Effect.fail(new GedV04UpgradeError({ databasePath, reason: "database-operation", cause })),
      ),
    ),
);
