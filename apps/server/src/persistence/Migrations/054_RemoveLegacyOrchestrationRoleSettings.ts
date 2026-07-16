import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * 054 — Remove projected settings for the retired `classify` and `review`
 * worker roles.
 *
 * The role reduction shipped with strict current-role decoding. Existing
 * projects can still carry the retired keys even when they have no task
 * ledger, which makes the packaged backend fail while loading its project
 * read model. Task-level model overrides can contain the same keys.
 *
 * This migration repairs projection-owned JSON only. The append-only event
 * log remains untouched, and current command/event schemas remain strict for
 * newly written values.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Validate every stored value before changing anything. Corrupt or
  // non-object JSON must fail loudly rather than being replaced with `{}`.
  const invalidProjects = yield* sql<{ readonly projectId: string }>`
    SELECT project_id AS "projectId"
    FROM projection_projects
    WHERE json_valid(role_model_selections_json) = 0
       OR json_valid(role_prompt_prefixes_json) = 0
       OR json_type(role_model_selections_json) != 'object'
       OR json_type(role_prompt_prefixes_json) != 'object'
  `;
  const invalidTasks = yield* sql<{ readonly taskId: string }>`
    SELECT task_id AS "taskId"
    FROM projection_tasks
    WHERE json_valid(role_model_selections_json) = 0
       OR json_type(role_model_selections_json) != 'object'
  `;
  if (invalidProjects.length > 0 || invalidTasks.length > 0) {
    return yield* Effect.die(
      new Error(
        `Cannot migrate invalid orchestration role settings (projects: ${
          invalidProjects.map((row) => row.projectId).join(", ") || "none"
        }; tasks: ${invalidTasks.map((row) => row.taskId).join(", ") || "none"})`,
      ),
    );
  }

  yield* sql`
    UPDATE projection_projects
    SET role_model_selections_json = json_remove(
      role_model_selections_json,
      '$.classify',
      '$.review'
    )
    WHERE json_type(role_model_selections_json, '$.classify') IS NOT NULL
       OR json_type(role_model_selections_json, '$.review') IS NOT NULL
  `;

  yield* sql`
    UPDATE projection_projects
    SET role_prompt_prefixes_json = json_remove(
      role_prompt_prefixes_json,
      '$.classify',
      '$.review'
    )
    WHERE json_type(role_prompt_prefixes_json, '$.classify') IS NOT NULL
       OR json_type(role_prompt_prefixes_json, '$.review') IS NOT NULL
  `;

  yield* sql`
    UPDATE projection_tasks
    SET role_model_selections_json = json_remove(
      role_model_selections_json,
      '$.classify',
      '$.review'
    )
    WHERE json_type(role_model_selections_json, '$.classify') IS NOT NULL
       OR json_type(role_model_selections_json, '$.review') IS NOT NULL
  `;
});
