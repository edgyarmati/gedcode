import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * 037 — `orchestrator_config_json` column on `projection_projects`: persists the
 * HARD `OrchestratorProjectConfig` (Plan 018 WP-B,
 * packages/contracts/src/orchestrator/config.ts) as JSON on the project
 * projection (Plan 018 WP-C; design §11 step 4, §14).
 *
 * The config rides the existing `project.meta.update → project.meta-updated`
 * path (design §14) — there is intentionally no new config event type, and **no
 * PM tool maps to `project.meta.update`** (design §13 risk row 3), so the
 * LLM-driven PM physically cannot relax its own guardrails. Only a human/client
 * write path reaches this column.
 *
 * The `'{}'` default decodes to a safe-by-default config: every field of
 * `OrchestratorProjectConfig` carries a `withDecodingDefault` (enabled=false,
 * pmModelSelection=null, the single `feature` task type, and
 * resourceLimits.allowFullAccessWorkers=false). So existing project rows that
 * predate this column decode unchanged with orchestrator mode disabled — the
 * fail-closed posture the runtime-mode clamp (WP-E) depends on.
 *
 * Mirrors the `032_ProjectionProjectRoleModelSelections` convention
 * (single defaulted JSON `ALTER TABLE ... ADD COLUMN`). DDL-only — no backfill;
 * the event log is untouched.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE projection_projects
    ADD COLUMN orchestrator_config_json TEXT NOT NULL DEFAULT '{}'
  `;
});
