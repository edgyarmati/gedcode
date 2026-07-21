import {
  ProjectContextFingerprint,
  ProjectContextRunContentDigest,
  ProjectContextRunId,
  ProjectContextSchemaVersion,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { ProjectionProjectRepositoryLive } from "./ProjectionProjects.ts";
import { ProjectionProjectContextRunRepositoryLive } from "./ProjectionProjectContextRuns.ts";
import { SqlitePersistenceMemory } from "./Sqlite.ts";
import { ProjectionProjectRepository } from "../Services/ProjectionProjects.ts";
import { ProjectionProjectContextRunRepository } from "../Services/ProjectionProjectContextRuns.ts";

const layer = Layer.mergeAll(
  ProjectionProjectRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
  ProjectionProjectContextRunRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
  SqlitePersistenceMemory,
);

it.layer(layer)("ProjectionProjectContextRunRepository", (it) => {
  it.effect("round-trips strict lifecycle manifests and filters active runs", () =>
    Effect.gen(function* () {
      const projects = yield* ProjectionProjectRepository;
      const runs = yield* ProjectionProjectContextRunRepository;
      const projectId = ProjectId.make("project-context-run-repository");
      const id = ProjectContextRunId.make("context-run-repository");
      const now = "2026-07-20T10:00:00.000Z";

      yield* projects.upsert({
        projectId,
        title: "Context run repository",
        workspaceRoot: "/tmp/context-run-repository",
        defaultModelSelection: null,
        roleModelSelections: {},
        rolePromptPrefixes: {},
        orchestratorConfig: {},
        projectContextResolution: null,
        scripts: [],
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
      yield* runs.upsert({
        id,
        projectId,
        mode: "review",
        tier: "smart",
        providerInstanceId: ProviderInstanceId.make("codex-smart"),
        model: "gpt-smart",
        modelOptions: [{ id: "effort", value: "high" }],
        primaryCheckoutPath: "/tmp/context-run-repository",
        schemaVersion: ProjectContextSchemaVersion.make(1),
        fingerprint: ProjectContextFingerprint.make(`sha256:${"a".repeat(64)}`),
        prompt: "Review the canonical project context.",
        baselineManifest: [{ path: "AGENTS.md", rawContent: "# Existing\n" }],
        workspaceStatusManifest: [
          {
            relativePath: "AGENTS.md",
            porcelainStatus: " M",
            contentDigest: ProjectContextRunContentDigest.make(`sha256:${"b".repeat(64)}`),
          },
          { relativePath: "notes.txt", porcelainStatus: "??", contentDigest: null },
        ],
        gitState: {
          head: null,
          headIdentity: { kind: "branch", ref: "refs/heads/main" },
          stagedIndexDigest: ProjectContextRunContentDigest.make(`sha256:${"c".repeat(64)}`),
          refsDigest: ProjectContextRunContentDigest.make(`sha256:${"d".repeat(64)}`),
          configDigest: ProjectContextRunContentDigest.make(`sha256:${"e".repeat(64)}`),
          hooksDigest: ProjectContextRunContentDigest.make(`sha256:${"f".repeat(64)}`),
          infoExcludeDigest: ProjectContextRunContentDigest.make(`sha256:${"0".repeat(64)}`),
          infoAttributesDigest: ProjectContextRunContentDigest.make(`sha256:${"1".repeat(64)}`),
          infoGraftsDigest: ProjectContextRunContentDigest.make(`sha256:${"2".repeat(64)}`),
        },
        status: "pending-review",
        pmStartState: "ready",
        providerThreadId: ThreadId.make("project-context-run:repository"),
        result: "Updated the context.",
        failureMessage: null,
        changes: [
          {
            path: "AGENTS.md",
            beforeRawContent: "# Existing\n",
            afterRawContent: "# Existing\n\nKeep changes bounded.\n",
          },
        ],
        scopeViolationPaths: ["notes.txt"],
        resolution: null,
        commitHash: null,
        resultSchemaVersion: null,
        resultFingerprint: null,
        createdAt: now,
        startedAt: now,
        pendingReviewAt: now,
        failedAt: null,
        interruptedAt: null,
        resolvedAt: null,
        updatedAt: now,
      });

      const persisted = Option.getOrThrow(yield* runs.getById({ projectContextRunId: id }));
      assert.deepStrictEqual(persisted.baselineManifest, [
        { path: "AGENTS.md", rawContent: "# Existing\n" },
      ]);
      assert.deepStrictEqual(persisted.workspaceStatusManifest, [
        {
          relativePath: "AGENTS.md",
          porcelainStatus: " M",
          contentDigest: ProjectContextRunContentDigest.make(`sha256:${"b".repeat(64)}`),
        },
        { relativePath: "notes.txt", porcelainStatus: "??", contentDigest: null },
      ]);
      assert.strictEqual(
        persisted.changes[0]?.afterRawContent,
        "# Existing\n\nKeep changes bounded.\n",
      );
      assert.deepStrictEqual(persisted.scopeViolationPaths, ["notes.txt"]);
      assert.deepStrictEqual(
        (yield* runs.listActiveByProjectId({ projectId })).map((run) => run.id),
        [id],
      );

      yield* runs.upsert({
        ...persisted,
        status: "failed",
        failureMessage: "Out-of-scope changes detected.",
        failedAt: "2026-07-20T10:01:00.000Z",
        updatedAt: "2026-07-20T10:01:00.000Z",
      });
      assert.deepStrictEqual(yield* runs.listActiveByProjectId({ projectId }), []);
      assert.strictEqual((yield* runs.listByProjectId({ projectId })).length, 1);
      const sql = yield* SqlClient.SqlClient;
      yield* sql`
        UPDATE projection_project_context_runs
        SET changes_json = '[{"path":"outside.txt","beforeRawContent":null,"afterRawContent":"bad"}]'
        WHERE project_context_run_id = 'context-run-repository'
      `;
      const error = yield* Effect.flip(
        runs.getById({ projectContextRunId: ProjectContextRunId.make("context-run-repository") }),
      );
      assert.strictEqual(error._tag, "PersistenceSqlError");
    }),
  );
});
