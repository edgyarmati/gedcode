-- Schema and ledger only, extracted from v0.4.8 published-releases/schema-76-v0.4.3.sqlite.gz.
-- No source rows, credentials, event payloads or conversation data.
CREATE TABLE "effect_sql_migrations" (
  migration_id integer PRIMARY KEY NOT NULL,
  created_at datetime NOT NULL DEFAULT current_timestamp,
  name VARCHAR(255) NOT NULL
);
CREATE TABLE orchestration_events (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE,
      aggregate_kind TEXT NOT NULL,
      stream_id TEXT NOT NULL,
      stream_version INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      command_id TEXT,
      causation_event_id TEXT,
      correlation_id TEXT,
      actor_kind TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      metadata_json TEXT NOT NULL
    );
CREATE TABLE orchestration_command_receipts (
      command_id TEXT PRIMARY KEY,
      aggregate_kind TEXT NOT NULL,
      aggregate_id TEXT NOT NULL,
      accepted_at TEXT NOT NULL,
      result_sequence INTEGER NOT NULL,
      status TEXT NOT NULL,
      error TEXT
    );
CREATE TABLE checkpoint_diff_blobs (
      thread_id TEXT NOT NULL,
      from_turn_count INTEGER NOT NULL,
      to_turn_count INTEGER NOT NULL,
      diff TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (thread_id, from_turn_count, to_turn_count)
    );
CREATE TABLE provider_session_runtime (
      thread_id TEXT PRIMARY KEY,
      provider_name TEXT NOT NULL,
      adapter_key TEXT NOT NULL,
      runtime_mode TEXT NOT NULL DEFAULT 'full-access',
      status TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      resume_cursor_json TEXT,
      runtime_payload_json TEXT
    , provider_instance_id TEXT);
CREATE TABLE projection_projects (
      project_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      workspace_root TEXT NOT NULL,
      scripts_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    , default_model_selection_json TEXT, role_model_selections_json TEXT NOT NULL DEFAULT '{}', orchestrator_config_json TEXT NOT NULL DEFAULT '{}', role_prompt_prefixes_json TEXT NOT NULL DEFAULT '{}');
CREATE TABLE projection_threads (
      thread_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      branch TEXT,
      worktree_path TEXT,
      latest_turn_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    , runtime_mode TEXT NOT NULL DEFAULT 'full-access', interaction_mode TEXT NOT NULL DEFAULT 'default', model_selection_json TEXT, archived_at TEXT, latest_user_message_at TEXT, pending_approval_count INTEGER NOT NULL DEFAULT 0, pending_user_input_count INTEGER NOT NULL DEFAULT 0, has_actionable_proposed_plan INTEGER NOT NULL DEFAULT 0, ged_workflow_enabled INTEGER NOT NULL DEFAULT 1, last_cleared_sequence INTEGER, pending_pm_handoff_json TEXT, orchestration_ownership_json TEXT, inbox_lifecycle TEXT NOT NULL DEFAULT 'active', inbox_wake_at TEXT);
CREATE TABLE projection_thread_messages (
      message_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      turn_id TEXT,
      role TEXT NOT NULL,
      text TEXT NOT NULL,
      is_streaming INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    , attachments_json TEXT);
CREATE TABLE projection_thread_activities (
      activity_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      turn_id TEXT,
      tone TEXT NOT NULL,
      kind TEXT NOT NULL,
      summary TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    , sequence INTEGER);
CREATE TABLE projection_thread_sessions (
      thread_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      provider_name TEXT,
      provider_session_id TEXT,
      provider_thread_id TEXT,
      active_turn_id TEXT,
      last_error TEXT,
      updated_at TEXT NOT NULL
    , runtime_mode TEXT NOT NULL DEFAULT 'full-access', provider_instance_id TEXT);
CREATE TABLE projection_turns (
      row_id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id TEXT NOT NULL,
      turn_id TEXT,
      pending_message_id TEXT,
      assistant_message_id TEXT,
      state TEXT NOT NULL,
      requested_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      checkpoint_turn_count INTEGER,
      checkpoint_ref TEXT,
      checkpoint_status TEXT,
      checkpoint_files_json TEXT NOT NULL, source_proposed_plan_thread_id TEXT, source_proposed_plan_id TEXT,
      UNIQUE (thread_id, turn_id),
      UNIQUE (thread_id, checkpoint_turn_count)
    );
CREATE TABLE projection_pending_approvals (
      request_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      turn_id TEXT,
      status TEXT NOT NULL,
      decision TEXT,
      created_at TEXT NOT NULL,
      resolved_at TEXT
    );
CREATE TABLE projection_state (
      projector TEXT PRIMARY KEY,
      last_applied_sequence INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
CREATE TABLE projection_thread_proposed_plans (
      plan_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      turn_id TEXT,
      plan_markdown TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    , implemented_at TEXT, implementation_thread_id TEXT);
CREATE TABLE auth_pairing_links (
      id TEXT PRIMARY KEY,
      credential TEXT NOT NULL UNIQUE,
      method TEXT NOT NULL,
      role TEXT NOT NULL,
      subject TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      consumed_at TEXT,
      revoked_at TEXT
    , label TEXT);
CREATE TABLE auth_sessions (
      session_id TEXT PRIMARY KEY,
      subject TEXT NOT NULL,
      role TEXT NOT NULL,
      method TEXT NOT NULL,
      issued_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT
    , client_label TEXT, client_ip_address TEXT, client_user_agent TEXT, client_device_type TEXT NOT NULL DEFAULT 'unknown', client_os TEXT, client_browser TEXT, last_connected_at TEXT);
CREATE TABLE projection_tasks (
      task_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      branch TEXT,
      worktree_path TEXT,
      pm_message_id TEXT,
      stage_thread_ids_json TEXT NOT NULL DEFAULT '[]',
      current_stage_thread_id TEXT,
      playbook_version TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    , role_model_selections_json TEXT NOT NULL DEFAULT '{}', pr_url TEXT, cancellation_json TEXT, landing_json TEXT, archived_at TEXT, deleted_at TEXT, supersedes_task_id TEXT, superseded_by_task_id TEXT, parent_task_id TEXT, child_order INTEGER, aggregate_progress_json TEXT, acceptance_criteria_json TEXT NOT NULL DEFAULT '[]', depends_on_task_ids_json TEXT NOT NULL DEFAULT '[]', release_dispatch_json TEXT, change_review_json TEXT, verification_json TEXT, no_changes_needed_json TEXT, force_land_request_json TEXT);
CREATE TABLE projection_awaited_stages (
      task_id TEXT NOT NULL,
      stage_thread_id TEXT NOT NULL,
      role TEXT NOT NULL,
      awaited_turn_id TEXT,
      status TEXT NOT NULL DEFAULT 'awaited',
      started_at TEXT NOT NULL,
      completed_at TEXT,
      PRIMARY KEY (task_id, stage_thread_id)
    );
CREATE TABLE projection_pending_gates (
      gate_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      gate TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      stage_thread_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      approved_hash TEXT,
      decision TEXT,
      origin TEXT,
      requested_at TEXT NOT NULL,
      resolved_at TEXT
    , pull_request_title TEXT, pull_request_body TEXT);
CREATE TABLE pm_sessions (
      session_id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      leaf_id TEXT
    );
CREATE TABLE pm_session_entries (
      entry_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      parent_id TEXT,
      type TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}'
    );
CREATE TABLE pm_runtime_cursor (
      project_id TEXT PRIMARY KEY,
      last_consumed_sequence INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
CREATE TABLE pm_consumed_settlements (
      project_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      settlement_key TEXT NOT NULL,
      consumed_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'acted', retry_attempts INTEGER NOT NULL DEFAULT 0, hold_reason TEXT NULL CHECK (hold_reason IN ('quota', 'auth', 'provider')), next_retry_at TEXT NULL, delivery_episode INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (project_id, kind, settlement_key)
    );
CREATE TABLE projection_provider_quota_status (
      provider_instance_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      reset_at TEXT,
      updated_at TEXT NOT NULL
    );
CREATE TABLE projection_quota_blocked_stages (
      stage_thread_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      role TEXT NOT NULL,
      provider_instance_id TEXT NOT NULL,
      reset_at TEXT,
      status TEXT NOT NULL DEFAULT 'blocked',
      retry_count INTEGER NOT NULL,
      blocked_at TEXT NOT NULL,
      resumed_at TEXT
    );
CREATE TABLE projection_stage_history (
      stage_thread_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      role TEXT NOT NULL,
      provider_instance_id TEXT NOT NULL,
      model TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT
    , runtime_mode TEXT, capability_tier TEXT, model_options_json TEXT, start_head TEXT, network_access INTEGER, capability_pause_expires_at TEXT NULL);
CREATE TABLE projection_helper_runs (
      helper_run_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      attachment_json TEXT NOT NULL,
      access_mode TEXT NOT NULL CHECK (access_mode = 'read-only'),
      tier TEXT NOT NULL CHECK (tier IN ('cheap', 'smart', 'genius')),
      provider_instance_id TEXT NOT NULL,
      model TEXT NOT NULL,
      model_options_json TEXT,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'interrupted')),
      provider_thread_id TEXT,
      result TEXT,
      failure_message TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      updated_at TEXT NOT NULL, transient_retry_count INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (project_id) REFERENCES projection_projects(project_id)
    );
CREATE TABLE projection_project_context_runs (
      project_context_run_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      mode TEXT NOT NULL CHECK (mode IN ('populate', 'review')),
      tier TEXT NOT NULL CHECK (tier IN ('cheap', 'smart', 'genius')),
      provider_instance_id TEXT NOT NULL,
      model TEXT NOT NULL,
      model_options_json TEXT,
      primary_checkout_path TEXT NOT NULL,
      schema_version INTEGER NOT NULL CHECK (schema_version > 0),
      fingerprint TEXT NOT NULL,
      prompt TEXT NOT NULL,
      baseline_manifest_json TEXT NOT NULL,
      workspace_status_manifest_json TEXT NOT NULL,
      git_state_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'pending-review', 'completed', 'discarded', 'failed', 'interrupted')),
      provider_thread_id TEXT,
      result TEXT,
      failure_message TEXT,
      changes_json TEXT NOT NULL,
      scope_violation_paths_json TEXT NOT NULL,
      resolution TEXT CHECK (resolution IS NULL OR resolution IN ('applied', 'committed', 'discarded')),
      commit_hash TEXT,
      result_schema_version INTEGER CHECK (result_schema_version IS NULL OR result_schema_version > 0),
      result_fingerprint TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT,
      pending_review_at TEXT,
      failed_at TEXT,
      interrupted_at TEXT,
      resolved_at TEXT,
      updated_at TEXT NOT NULL,
      pm_start_state TEXT NOT NULL DEFAULT 'ready'
        CHECK (pm_start_state IN ('ready', 'awaiting-user', 'waiting-for-idle', 'interrupting')),
      FOREIGN KEY (project_id) REFERENCES projection_projects(project_id)
    );
CREATE UNIQUE INDEX idx_orch_events_stream_version
    ON orchestration_events(aggregate_kind, stream_id, stream_version)
  ;
CREATE INDEX idx_orch_events_stream_sequence
    ON orchestration_events(aggregate_kind, stream_id, sequence)
  ;
CREATE INDEX idx_orch_events_command_id
    ON orchestration_events(command_id)
  ;
CREATE INDEX idx_orch_events_correlation_id
    ON orchestration_events(correlation_id)
  ;
CREATE INDEX idx_orch_command_receipts_aggregate
    ON orchestration_command_receipts(aggregate_kind, aggregate_id)
  ;
CREATE INDEX idx_orch_command_receipts_sequence
    ON orchestration_command_receipts(result_sequence)
  ;
CREATE INDEX idx_checkpoint_diff_blobs_thread_to_turn
    ON checkpoint_diff_blobs(thread_id, to_turn_count)
  ;
CREATE INDEX idx_provider_session_runtime_status
    ON provider_session_runtime(status)
  ;
CREATE INDEX idx_provider_session_runtime_provider
    ON provider_session_runtime(provider_name)
  ;
CREATE INDEX idx_projection_projects_updated_at
    ON projection_projects(updated_at)
  ;
CREATE INDEX idx_projection_threads_project_id
    ON projection_threads(project_id)
  ;
CREATE INDEX idx_projection_thread_messages_thread_created
    ON projection_thread_messages(thread_id, created_at)
  ;
CREATE INDEX idx_projection_thread_activities_thread_created
    ON projection_thread_activities(thread_id, created_at)
  ;
CREATE INDEX idx_projection_thread_sessions_provider_session
    ON projection_thread_sessions(provider_session_id)
  ;
CREATE INDEX idx_projection_turns_thread_requested
    ON projection_turns(thread_id, requested_at)
  ;
CREATE INDEX idx_projection_turns_thread_checkpoint_completed
    ON projection_turns(thread_id, checkpoint_turn_count, completed_at)
  ;
CREATE INDEX idx_projection_pending_approvals_thread_status
    ON projection_pending_approvals(thread_id, status)
  ;
CREATE INDEX idx_projection_thread_activities_thread_sequence
    ON projection_thread_activities(thread_id, sequence)
  ;
CREATE INDEX idx_projection_thread_proposed_plans_thread_created
    ON projection_thread_proposed_plans(thread_id, created_at)
  ;
CREATE INDEX idx_projection_threads_project_archived_at
    ON projection_threads(project_id, archived_at)
  ;
CREATE INDEX idx_projection_projects_workspace_root_deleted_at
    ON projection_projects(workspace_root, deleted_at)
  ;
CREATE INDEX idx_projection_threads_project_deleted_created
    ON projection_threads(project_id, deleted_at, created_at)
  ;
CREATE INDEX idx_auth_pairing_links_active
    ON auth_pairing_links(revoked_at, consumed_at, expires_at)
  ;
CREATE INDEX idx_auth_sessions_active
    ON auth_sessions(revoked_at, expires_at, issued_at)
  ;
CREATE INDEX idx_provider_session_runtime_instance
    ON provider_session_runtime(provider_instance_id)
  ;
CREATE INDEX idx_projection_thread_sessions_instance
    ON projection_thread_sessions(provider_instance_id)
  ;
CREATE INDEX idx_projection_thread_activities_thread_sequence_created_id
    ON projection_thread_activities(thread_id, sequence, created_at, activity_id)
  ;
CREATE INDEX idx_projection_thread_messages_thread_created_id
    ON projection_thread_messages(thread_id, created_at, message_id)
  ;
CREATE INDEX idx_projection_threads_shell_active
    ON projection_threads(deleted_at, archived_at, project_id, created_at, thread_id)
  ;
CREATE INDEX idx_projection_threads_shell_archived
    ON projection_threads(deleted_at, archived_at, project_id, thread_id)
  ;
CREATE INDEX idx_projection_tasks_project_status
    ON projection_tasks(project_id, status)
  ;
CREATE INDEX idx_projection_tasks_project_updated
    ON projection_tasks(project_id, updated_at)
  ;
CREATE INDEX idx_projection_awaited_stages_task_status
    ON projection_awaited_stages(task_id, status)
  ;
CREATE INDEX idx_projection_awaited_stages_status
    ON projection_awaited_stages(status)
  ;
CREATE INDEX idx_projection_pending_gates_task_status
    ON projection_pending_gates(task_id, status)
  ;
CREATE INDEX idx_projection_pending_gates_status
    ON projection_pending_gates(status)
  ;
CREATE INDEX idx_pm_session_entries_session_type
    ON pm_session_entries(session_id, type)
  ;
CREATE INDEX idx_pm_session_entries_session_parent
    ON pm_session_entries(session_id, parent_id)
  ;
CREATE INDEX idx_pm_consumed_settlements_project_kind
    ON pm_consumed_settlements(project_id, kind)
  ;
CREATE INDEX idx_projection_provider_quota_status_status
    ON projection_provider_quota_status(status, reset_at)
  ;
CREATE INDEX idx_projection_quota_blocked_stages_provider_status
    ON projection_quota_blocked_stages(provider_instance_id, status, blocked_at)
  ;
CREATE INDEX idx_projection_quota_blocked_stages_task_role_status
    ON projection_quota_blocked_stages(task_id, role, status)
  ;
CREATE INDEX idx_projection_stage_history_project_started
    ON projection_stage_history(project_id, started_at, stage_thread_id)
  ;
CREATE INDEX idx_projection_stage_history_task_started
    ON projection_stage_history(task_id, started_at, stage_thread_id)
  ;
CREATE INDEX idx_projection_stage_history_status_started
    ON projection_stage_history(status, started_at, stage_thread_id)
  ;
CREATE INDEX idx_projection_tasks_active_project_updated
    ON projection_tasks(project_id, updated_at)
    WHERE archived_at IS NULL AND deleted_at IS NULL
  ;
CREATE UNIQUE INDEX idx_projection_tasks_superseded_by
    ON projection_tasks(supersedes_task_id)
    WHERE supersedes_task_id IS NOT NULL
  ;
CREATE UNIQUE INDEX idx_projection_tasks_parent_child_order
    ON projection_tasks(parent_task_id, child_order)
    WHERE parent_task_id IS NOT NULL
  ;
CREATE INDEX projection_helper_runs_project_idx ON projection_helper_runs(project_id, created_at, helper_run_id);
CREATE INDEX projection_helper_runs_status_idx ON projection_helper_runs(status, updated_at);
CREATE INDEX projection_project_context_runs_project_updated_idx ON projection_project_context_runs(project_id, updated_at, project_context_run_id);
CREATE INDEX projection_project_context_runs_active_idx
    ON projection_project_context_runs(project_id, status, updated_at, project_context_run_id)
    WHERE status IN ('pending', 'running', 'pending-review')
  ;
CREATE INDEX idx_pm_consumed_settlements_pending_delivery
    ON pm_consumed_settlements(project_id, status, hold_reason, next_retry_at)
  ;
INSERT INTO effect_sql_migrations (migration_id, name) VALUES (1, 'OrchestrationEvents');
INSERT INTO effect_sql_migrations (migration_id, name) VALUES (2, 'OrchestrationCommandReceipts');
INSERT INTO effect_sql_migrations (migration_id, name) VALUES (3, 'CheckpointDiffBlobs');
INSERT INTO effect_sql_migrations (migration_id, name) VALUES (4, 'ProviderSessionRuntime');
INSERT INTO effect_sql_migrations (migration_id, name) VALUES (5, 'Projections');
INSERT INTO effect_sql_migrations (migration_id, name) VALUES (6, 'ProjectionThreadSessionRuntimeModeColumns');
INSERT INTO effect_sql_migrations (migration_id, name) VALUES (7, 'ProjectionThreadMessageAttachments');
INSERT INTO effect_sql_migrations (migration_id, name) VALUES (8, 'ProjectionThreadActivitySequence');
INSERT INTO effect_sql_migrations (migration_id, name) VALUES (9, 'ProviderSessionRuntimeMode');
INSERT INTO effect_sql_migrations (migration_id, name) VALUES (10, 'ProjectionThreadsRuntimeMode');
INSERT INTO effect_sql_migrations (migration_id, name) VALUES (11, 'OrchestrationThreadCreatedRuntimeMode');
INSERT INTO effect_sql_migrations (migration_id, name) VALUES (12, 'ProjectionThreadsInteractionMode');
INSERT INTO effect_sql_migrations (migration_id, name) VALUES (13, 'ProjectionThreadProposedPlans');
INSERT INTO effect_sql_migrations (migration_id, name) VALUES (14, 'ProjectionThreadProposedPlanImplementation');
INSERT INTO effect_sql_migrations (migration_id, name) VALUES (15, 'ProjectionTurnsSourceProposedPlan');
INSERT INTO effect_sql_migrations (migration_id, name) VALUES (16, 'CanonicalizeModelSelections');
INSERT INTO effect_sql_migrations (migration_id, name) VALUES (17, 'ProjectionThreadsArchivedAt');
INSERT INTO effect_sql_migrations (migration_id, name) VALUES (18, 'ProjectionThreadsArchivedAtIndex');
INSERT INTO effect_sql_migrations (migration_id, name) VALUES (19, 'ProjectionSnapshotLookupIndexes');
INSERT INTO effect_sql_migrations (migration_id, name) VALUES (20, 'AuthAccessManagement');
INSERT INTO effect_sql_migrations (migration_id, name) VALUES (21, 'AuthSessionClientMetadata');
INSERT INTO effect_sql_migrations (migration_id, name) VALUES (22, 'AuthSessionLastConnectedAt');
INSERT INTO effect_sql_migrations (migration_id, name) VALUES (23, 'ProjectionThreadShellSummary');
INSERT INTO effect_sql_migrations (migration_id, name) VALUES (24, 'BackfillProjectionThreadShellSummary');
INSERT INTO effect_sql_migrations (migration_id, name) VALUES (25, 'CleanupInvalidProjectionPendingApprovals');
INSERT INTO effect_sql_migrations (migration_id, name) VALUES (26, 'CanonicalizeModelSelectionOptions');
INSERT INTO effect_sql_migrations (migration_id, name) VALUES (27, 'ProviderSessionRuntimeInstanceId');
INSERT INTO effect_sql_migrations (migration_id, name) VALUES (28, 'ProjectionThreadSessionInstanceId');
INSERT INTO effect_sql_migrations (migration_id, name) VALUES (29, 'ProjectionThreadDetailOrderingIndexes');
INSERT INTO effect_sql_migrations (migration_id, name) VALUES (30, 'ProjectionThreadShellArchiveIndexes');
INSERT INTO effect_sql_migrations (migration_id, name) VALUES (31, 'ProjectionThreadsGedWorkflowEnabled');
INSERT INTO effect_sql_migrations (migration_id, name) VALUES (32, 'ProjectionProjectRoleModelSelections');
INSERT INTO effect_sql_migrations (migration_id, name) VALUES (33, 'ProjectionTasks');
INSERT INTO effect_sql_migrations (migration_id, name) VALUES (34, 'ProjectionAwaitedStagesAndPendingGates');
INSERT INTO effect_sql_migrations (migration_id, name) VALUES (35, 'PmSessionEntries');
INSERT INTO effect_sql_migrations (migration_id, name) VALUES (36, 'PmRuntimeCursorAndConsumedSettlements');
INSERT INTO effect_sql_migrations (migration_id, name) VALUES (37, 'ProjectionProjectOrchestratorConfig');
INSERT INTO effect_sql_migrations (migration_id, name) VALUES (38, 'PmConsumedSettlementsStatus');
INSERT INTO effect_sql_migrations (migration_id, name) VALUES (39, 'ProviderQuotaStatus');
INSERT INTO effect_sql_migrations (migration_id, name) VALUES (40, 'ProjectionQuotaBlockedStages');
INSERT INTO effect_sql_migrations (migration_id, name) VALUES (41, 'ProjectionStageHistoryAndRoleOverrides');
INSERT INTO effect_sql_migrations (migration_id, name) VALUES (42, 'ProjectionTaskPrUrl');
INSERT INTO effect_sql_migrations (migration_id, name) VALUES (43, 'ProjectionThreadLastClearedSequence');
INSERT INTO effect_sql_migrations (migration_id, name) VALUES (44, 'ProjectionThreadPendingPmHandoff');
INSERT INTO effect_sql_migrations (migration_id, name) VALUES (45, 'BackfillProjectionProjectOrchestratorConfig');
INSERT INTO effect_sql_migrations (migration_id, name) VALUES (46, 'ProjectionTaskCancellation');
INSERT INTO effect_sql_migrations (migration_id, name) VALUES (47, 'ProjectionTaskLanding');
INSERT INTO effect_sql_migrations (migration_id, name) VALUES (48, 'ProjectionTaskRetention');
INSERT INTO effect_sql_migrations (migration_id, name) VALUES (49, 'ProjectionTaskSupersession');
INSERT INTO effect_sql_migrations (migration_id, name) VALUES (50, 'ProjectionStageRuntimeMode');
INSERT INTO effect_sql_migrations (migration_id, name) VALUES (51, 'ProjectionTaskSplitting');
INSERT INTO effect_sql_migrations (migration_id, name) VALUES (52, 'ProjectionTaskSplitDetails');
INSERT INTO effect_sql_migrations (migration_id, name) VALUES (53, 'ProjectionTaskReleaseDispatch');
INSERT INTO effect_sql_migrations (migration_id, name) VALUES (54, 'RemoveLegacyOrchestrationRoleSettings');
INSERT INTO effect_sql_migrations (migration_id, name) VALUES (55, 'RemoveLegacyOrchestrationStageHistory');
INSERT INTO effect_sql_migrations (migration_id, name) VALUES (56, 'ProjectionTaskCompletionRecords');
INSERT INTO effect_sql_migrations (migration_id, name) VALUES (57, 'ProjectionStageCapabilityPreset');
INSERT INTO effect_sql_migrations (migration_id, name) VALUES (58, 'ProjectionTaskCapabilityTiers');
INSERT INTO effect_sql_migrations (migration_id, name) VALUES (59, 'ProjectionHelperRuns');
INSERT INTO effect_sql_migrations (migration_id, name) VALUES (60, 'ProjectionProjectContextOnboarding');
INSERT INTO effect_sql_migrations (migration_id, name) VALUES (61, 'ProjectionProjectContextRuns');
INSERT INTO effect_sql_migrations (migration_id, name) VALUES (62, 'ProjectContextRunReviewResolution');
INSERT INTO effect_sql_migrations (migration_id, name) VALUES (63, 'ProjectContextRunPmHold');
INSERT INTO effect_sql_migrations (migration_id, name) VALUES (64, 'ProjectContextRunAppliedResolution');
INSERT INTO effect_sql_migrations (migration_id, name) VALUES (65, 'ProjectionStageStartHead');
INSERT INTO effect_sql_migrations (migration_id, name) VALUES (66, 'SettleLegacyProjectContextRuns');
INSERT INTO effect_sql_migrations (migration_id, name) VALUES (67, 'RemoveLegacyProjectContextOnboarding');
INSERT INTO effect_sql_migrations (migration_id, name) VALUES (68, 'ProjectionPendingGatePullRequest');
INSERT INTO effect_sql_migrations (migration_id, name) VALUES (69, 'ProjectionThreadOrchestrationOwnership');
INSERT INTO effect_sql_migrations (migration_id, name) VALUES (70, 'ProjectionStageHistoryNetworkAccess');
INSERT INTO effect_sql_migrations (migration_id, name) VALUES (71, 'PmLifecycleDeliveryRecovery');
INSERT INTO effect_sql_migrations (migration_id, name) VALUES (72, 'ProjectionStageCapabilityPauseDeadline');
INSERT INTO effect_sql_migrations (migration_id, name) VALUES (73, 'PmLifecycleDeliveryEpisodes');
INSERT INTO effect_sql_migrations (migration_id, name) VALUES (74, 'ProjectionThreadInboxLifecycle');
INSERT INTO effect_sql_migrations (migration_id, name) VALUES (75, 'ProjectionThreadInboxWakeAt');
INSERT INTO effect_sql_migrations (migration_id, name) VALUES (76, 'ProjectionTaskForceLandRequest');
