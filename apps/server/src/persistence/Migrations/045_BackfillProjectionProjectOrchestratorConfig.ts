import { OrchestratorConfigJson } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

type ProjectConfigEventRow = {
  readonly projectId: string;
  readonly payloadJson: string;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const PayloadJson = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown));
const ConfigJson = Schema.fromJsonString(OrchestratorConfigJson);
const decodePayloadJson = Schema.decodeUnknownSync(PayloadJson);
const encodeConfigJson = Schema.encodeSync(ConfigJson);

/**
 * 045 — Repair project orchestrator config projections after 0.2.0.
 *
 * Migration 037 added `projection_projects.orchestrator_config_json` with a
 * safe default of `{}` but did not backfill existing projection rows from the
 * append-only event log. Packaged 0.2.0 databases could therefore have
 * `project.meta-updated` events with `orchestratorConfig.enabled=true` while
 * every projected project still read as `{}`, causing PM startup to fail the
 * enabled guard.
 *
 * Only rows whose projected config is missing `enabled` are repaired. Historical
 * configs are shallow-merged in event order so a stale follow-up event that only
 * selected `pmModelSelection` does not erase an earlier explicit `enabled:true`.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const rows = yield* sql<ProjectConfigEventRow>`
    SELECT
      projects.project_id AS "projectId",
      events.payload_json AS "payloadJson"
    FROM projection_projects AS projects
    INNER JOIN orchestration_events AS events
      ON events.aggregate_kind = 'project'
     AND events.stream_id = projects.project_id
    WHERE events.event_type IN ('project.created', 'project.meta-updated')
      AND json_type(events.payload_json, '$.orchestratorConfig') = 'object'
      AND json_type(projects.orchestrator_config_json, '$.enabled') IS NULL
    ORDER BY projects.project_id ASC, events.sequence ASC
  `;

  const configByProject = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const payload = decodePayloadJson(row.payloadJson);
    const config = asRecord(payload?.orchestratorConfig);
    if (config === null) {
      continue;
    }
    const existingConfig = configByProject.get(row.projectId);
    configByProject.set(row.projectId, {
      ...(existingConfig !== undefined ? existingConfig : {}),
      ...config,
    });
  }

  for (const [projectId, config] of configByProject) {
    yield* sql`
      UPDATE projection_projects
      SET orchestrator_config_json = ${encodeConfigJson(config)}
      WHERE project_id = ${projectId}
        AND json_type(orchestrator_config_json, '$.enabled') IS NULL
    `;
  }
});
