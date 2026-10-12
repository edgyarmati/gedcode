import * as NodeSqlite from "node:sqlite";

/**
 * GedCode v0.4 recorded its own migrations at ids 31+ in the shared ledger, so the V2 migrator
 * would treat upstream's 31+ as already applied. Ids 1–30 match upstream.
 */
const GED_V04_MIGRATIONS: ReadonlyMap<number, string> = new Map(
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
  ["projection_threads", "last_cleared_sequence"],
  ["projection_threads", "message_queue_enabled"],
  ["projection_threads", "orchestration_ownership_json"],
  ["projection_threads", "pending_pm_handoff_json"],
  ["projection_threads", "queued_messages_json"],
];

const isGedV04Ledger = (database: NodeSqlite.DatabaseSync) => {
  const ledger = database
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'effect_sql_migrations'",
    )
    .get();
  if (ledger === undefined) return false;
  const rows = database
    .prepare("SELECT migration_id, name FROM effect_sql_migrations WHERE migration_id > ?")
    .all(LAST_SHARED_MIGRATION_ID);
  return (
    rows.length > 0 &&
    rows.every((row) => GED_V04_MIGRATIONS.get(Number(row.migration_id)) === row.name)
  );
};

/**
 * Rewrites a snapshot of a GedCode v0.4 database back to the shared upstream schema at
 * migration 30, so V2 migrations apply and threads import. Any other database is left untouched.
 * Returns whether the snapshot was rewritten.
 */
export const rewriteGedV04Snapshot = (snapshotPath: string) => {
  const database = new NodeSqlite.DatabaseSync(snapshotPath);
  try {
    if (!isGedV04Ledger(database)) return false;
    database.exec("BEGIN IMMEDIATE");
    try {
      for (const table of GED_V04_TABLES) database.exec(`DROP TABLE IF EXISTS ${table}`);
      for (const [table, column] of GED_V04_COLUMNS) {
        const exists = database
          .prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`)
          .get(column);
        if (exists !== undefined) database.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
      }
      database
        .prepare("DELETE FROM effect_sql_migrations WHERE migration_id > ?")
        .run(LAST_SHARED_MIGRATION_ID);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    return true;
  } finally {
    database.close();
  }
};
