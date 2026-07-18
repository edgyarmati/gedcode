import {
  ProjectContextResolution,
  ProjectId,
  ThreadId,
  ProviderInstanceId,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "./Sqlite.ts";
import { ProjectionProjectRepositoryLive } from "./ProjectionProjects.ts";
import { ProjectionThreadRepositoryLive } from "./ProjectionThreads.ts";
import { ProjectionProjectRepository } from "../Services/ProjectionProjects.ts";
import { ProjectionThreadRepository } from "../Services/ProjectionThreads.ts";

const projectionRepositoriesLayer = it.layer(
  Layer.mergeAll(
    ProjectionProjectRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
    ProjectionThreadRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
    SqlitePersistenceMemory,
  ),
);
const ProjectContextResolutionJson = Schema.fromJsonString(ProjectContextResolution);
const decodeProjectContextResolution = Schema.decodeUnknownEffect(ProjectContextResolution);
const encodeProjectContextResolutionJson = Schema.encodeEffect(ProjectContextResolutionJson);

projectionRepositoriesLayer("Projection repositories", (it) => {
  it.effect("round-trips nullable project-context onboarding through strict JSON", () =>
    Effect.gen(function* () {
      const projects = yield* ProjectionProjectRepository;
      const sql = yield* SqlClient.SqlClient;
      const resolution = yield* decodeProjectContextResolution({
        schemaVersion: 1,
        fingerprint: "sha256:4de5861c53fa4d598c6c5f4a0b6b6ef30c9be6e9b5678ed5f8ff643c2b07c27a",
        outcome: "completed",
        resolvedAt: "2026-07-18T00:00:00.000Z",
      });
      const encodedResolution = yield* encodeProjectContextResolutionJson(resolution);

      yield* projects.upsert({
        projectId: ProjectId.make("project-context-resolution"),
        title: "Project context resolution",
        workspaceRoot: "/tmp/project-context-resolution",
        defaultModelSelection: null,
        roleModelSelections: {},
        rolePromptPrefixes: {},
        projectContextResolution: resolution,
        scripts: [],
        createdAt: "2026-07-18T00:00:00.000Z",
        updatedAt: "2026-07-18T00:00:00.000Z",
        deletedAt: null,
      });

      const rows = yield* sql<{ readonly projectContextOnboarding: string | null }>`
        SELECT project_context_onboarding_json AS "projectContextOnboarding"
        FROM projection_projects
        WHERE project_id = 'project-context-resolution'
      `;
      assert.strictEqual(rows[0]?.projectContextOnboarding, encodedResolution);

      const persisted = yield* projects.getById({
        projectId: ProjectId.make("project-context-resolution"),
      });
      assert.deepStrictEqual(Option.getOrNull(persisted)?.projectContextResolution, resolution);
    }),
  );

  it.effect("keeps dismissed and completed context resolutions isolated per project", () =>
    Effect.gen(function* () {
      const projects = yield* ProjectionProjectRepository;
      const decodeResolution = Schema.decodeUnknownEffect(ProjectContextResolution);
      const dismissed = yield* decodeResolution({
        schemaVersion: 1,
        fingerprint: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        outcome: "dismissed",
        resolvedAt: "2026-07-18T01:00:00.000Z",
      });
      const completed = yield* decodeResolution({
        schemaVersion: 2,
        fingerprint: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        outcome: "completed",
        resolvedAt: "2026-07-18T02:00:00.000Z",
      });

      yield* projects.upsert({
        projectId: ProjectId.make("project-context-dismissed"),
        title: "Dismissed context",
        workspaceRoot: "/tmp/project-context-dismissed",
        defaultModelSelection: null,
        roleModelSelections: {},
        rolePromptPrefixes: {},
        projectContextResolution: dismissed,
        scripts: [],
        createdAt: "2026-07-18T01:00:00.000Z",
        updatedAt: "2026-07-18T01:00:00.000Z",
        deletedAt: null,
      });
      yield* projects.upsert({
        projectId: ProjectId.make("project-context-completed"),
        title: "Completed context",
        workspaceRoot: "/tmp/project-context-completed",
        defaultModelSelection: null,
        roleModelSelections: {},
        rolePromptPrefixes: {},
        projectContextResolution: completed,
        scripts: [],
        createdAt: "2026-07-18T02:00:00.000Z",
        updatedAt: "2026-07-18T02:00:00.000Z",
        deletedAt: null,
      });

      const persisted = yield* projects.listAll();
      assert.deepStrictEqual(
        persisted
          .filter(
            (project) =>
              project.projectId === ProjectId.make("project-context-dismissed") ||
              project.projectId === ProjectId.make("project-context-completed"),
          )
          .map((project) => ({
            projectId: project.projectId,
            projectContextResolution: project.projectContextResolution,
          })),
        [
          {
            projectId: ProjectId.make("project-context-dismissed"),
            projectContextResolution: dismissed,
          },
          {
            projectId: ProjectId.make("project-context-completed"),
            projectContextResolution: completed,
          },
        ],
      );
    }),
  );

  it.effect("stores SQL NULL for missing project model options", () =>
    Effect.gen(function* () {
      const projects = yield* ProjectionProjectRepository;
      const sql = yield* SqlClient.SqlClient;

      yield* projects.upsert({
        projectId: ProjectId.make("project-null-options"),
        title: "Null options project",
        workspaceRoot: "/tmp/project-null-options",
        defaultModelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5.4",
        },
        roleModelSelections: {},
        rolePromptPrefixes: {},
        projectContextResolution: null,
        scripts: [],
        createdAt: "2026-03-24T00:00:00.000Z",
        updatedAt: "2026-03-24T00:00:00.000Z",
        deletedAt: null,
      });

      const rows = yield* sql<{
        readonly defaultModelSelection: string | null;
      }>`
        SELECT default_model_selection_json AS "defaultModelSelection"
        FROM projection_projects
        WHERE project_id = 'project-null-options'
      `;
      const row = rows[0];
      if (!row) {
        return yield* Effect.die("Expected projection_projects row to exist.");
      }

      assert.strictEqual(
        row.defaultModelSelection,
        // @effect-diagnostics-next-line preferSchemaOverJson:off
        JSON.stringify({
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5.4",
        }),
      );

      const persisted = yield* projects.getById({
        projectId: ProjectId.make("project-null-options"),
      });
      assert.deepStrictEqual(Option.getOrNull(persisted)?.defaultModelSelection, {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5.4",
      });
    }),
  );

  it.effect("stores JSON for thread model options", () =>
    Effect.gen(function* () {
      const threads = yield* ProjectionThreadRepository;
      const sql = yield* SqlClient.SqlClient;

      yield* threads.upsert({
        threadId: ThreadId.make("thread-null-options"),
        projectId: ProjectId.make("project-null-options"),
        title: "Null options thread",
        modelSelection: {
          instanceId: ProviderInstanceId.make("claudeAgent"),
          model: "claude-opus-4-6",
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        latestTurnId: null,
        createdAt: "2026-03-24T00:00:00.000Z",
        updatedAt: "2026-03-24T00:00:00.000Z",
        archivedAt: null,
        latestUserMessageAt: null,
        pendingApprovalCount: 0,
        pendingUserInputCount: 0,
        hasActionableProposedPlan: 0,
        lastClearedSequence: null,
        pendingPmHandoff: null,
        deletedAt: null,
      });

      const rows = yield* sql<{
        readonly modelSelection: string | null;
      }>`
        SELECT model_selection_json AS "modelSelection"
        FROM projection_threads
        WHERE thread_id = 'thread-null-options'
      `;
      const row = rows[0];
      if (!row) {
        return yield* Effect.die("Expected projection_threads row to exist.");
      }

      assert.strictEqual(
        row.modelSelection,
        // @effect-diagnostics-next-line preferSchemaOverJson:off
        JSON.stringify({
          instanceId: ProviderInstanceId.make("claudeAgent"),
          model: "claude-opus-4-6",
        }),
      );

      const persisted = yield* threads.getById({
        threadId: ThreadId.make("thread-null-options"),
      });
      assert.deepStrictEqual(Option.getOrNull(persisted)?.modelSelection, {
        instanceId: ProviderInstanceId.make("claudeAgent"),
        model: "claude-opus-4-6",
      });
    }),
  );
});
