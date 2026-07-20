import {
  CommandId,
  ProjectContextRunId,
  ProjectId,
  type OrchestrationCommand,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { ChildProcessSpawner } from "effect/unstable/process";

import { makeProjectContextSnapshot } from "../../project/ProjectContext.ts";
import { createEmptyReadModel } from "../projector.ts";
import {
  ProjectContextRunCoordinatorError,
  requestProjectContextRunWithServices,
} from "./ProjectContextRunCoordinator.ts";
import type { VcsProcessOutput } from "../../vcs/VcsProcess.ts";

const projectId = ProjectId.make("project-context-coordinator");
const createdAt = "2026-07-20T10:00:00.000Z";
const workspaceRoot = "/private/tmp/project-context-coordinator";

const snapshot = makeProjectContextSnapshot({
  files: [
    {
      relativePath: "AGENTS.md",
      classification: "substantive",
      normalizedContent: "# Existing instructions",
    },
    { relativePath: ".ged/PROJECT.md", classification: "missing", normalizedContent: "" },
    {
      relativePath: ".ged/ARCHITECTURE.md",
      classification: "missing",
      normalizedContent: "",
    },
    { relativePath: "CONTEXT.md", classification: "missing", normalizedContent: "" },
  ],
  ownershipBaseline: {
    files: [
      {
        relativePath: "AGENTS.md",
        state: {
          presence: "present",
          digest: "sha256:owned-baseline",
          size: 31,
          content: "# Existing instructions\n\nRaw form\n",
        },
      },
      {
        relativePath: "CONTEXT.md",
        state: { presence: "absent", digest: null, size: 0, content: null },
      },
    ],
  },
});

const makeReadModel = (root = workspaceRoot): OrchestrationReadModel => ({
  ...createEmptyReadModel(createdAt),
  projects: [
    {
      id: projectId,
      workspaceRoot: root,
      deletedAt: null,
    } as OrchestrationReadModel["projects"][number],
  ],
});

const statusOutput = (stdout: string): VcsProcessOutput => ({
  exitCode: ChildProcessSpawner.ExitCode(0),
  stdout,
  stderr: "",
  stdoutTruncated: false,
  stderrTruncated: false,
});

const auditOutput = (operation: string, status = ""): VcsProcessOutput =>
  statusOutput(
    operation === "ProjectContextWorkspaceAudit.status"
      ? status
      : operation === "ProjectContextWorkspaceAudit.head"
        ? `${"a".repeat(40)}\n`
        : operation === "ProjectContextWorkspaceAudit.symbolicHead"
          ? "refs/heads/main\n"
          : operation === "ProjectContextWorkspaceAudit.refs"
            ? `refs/heads/main\0${"a".repeat(40)}\0\n`
            : operation === "ProjectContextWorkspaceAudit.config"
              ? "core.repositoryformatversion\u00000\u0000"
              : operation === "ProjectContextWorkspaceAudit.gitDir" ||
                  operation === "ProjectContextWorkspaceAudit.gitCommonDir"
                ? "/tmp/project/.git\n"
                : operation === "ProjectContextWorkspaceAudit.defaultHooksPath"
                  ? "/tmp/project/.git/hooks\n"
                  : operation === "ProjectContextWorkspaceAudit.configuredHooksPath"
                    ? "hooks\n"
                    : "",
  );

it.layer(NodeServices.layer)("ProjectContextRunCoordinator", (it) => {
  describe("requestProjectContextRunWithServices", () => {
    it.effect("captures the server-owned baseline and dispatches the derived review request", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const dispatched: OrchestrationCommand[] = [];
        const vcsInputs: Array<{ readonly operation: string; readonly command: string }> = [];

        const result = yield* requestProjectContextRunWithServices(
          {
            snapshotQuery: { getCommandReadModel: () => Effect.succeed(makeReadModel()) },
            scanner: { scan: () => Effect.succeed(snapshot) },
            vcsProcess: {
              run: (input) => {
                vcsInputs.push({ operation: input.operation, command: input.command });
                return Effect.succeed(auditOutput(input.operation));
              },
            },
            fileSystem,
            path,
          },
          {
            projectContextRunId: Effect.succeed(ProjectContextRunId.make("context-run-01")),
            commandId: Effect.succeed(CommandId.make("server:context-run-01")),
            createdAt: Effect.succeed(createdAt),
            dispatch: (command) =>
              Effect.sync(() => {
                dispatched.push(command);
                return { sequence: 41 };
              }),
          },
          { projectId, tier: "genius" },
        );

        expect(result).toEqual({ sequence: 41, projectContextRunId: "context-run-01" });
        expect(
          vcsInputs.filter((input) => input.operation === "ProjectContextWorkspaceAudit.status"),
        ).toHaveLength(2);
        expect(vcsInputs.map((input) => input.operation)).toContain(
          "ProjectContextWorkspaceAudit.stagedIndex",
        );
        expect(dispatched).toEqual([
          expect.objectContaining({
            type: "project.context.run.request",
            commandId: "server:context-run-01",
            projectContextRunId: "context-run-01",
            projectId,
            expectedPrimaryCheckoutPath: workspaceRoot,
            mode: "review",
            tier: "genius",
            schemaVersion: snapshot.schemaVersion,
            fingerprint: snapshot.fingerprint,
            createdAt,
            workspaceStatusManifest: [],
            gitState: {
              head: "a".repeat(40),
              headIdentity: { kind: "branch", ref: "refs/heads/main" },
              stagedIndexDigest: expect.stringMatching(/^sha256:/),
              refsDigest: expect.stringMatching(/^sha256:/),
              configDigest: expect.stringMatching(/^sha256:/),
              hooksDigest: expect.stringMatching(/^sha256:/),
              infoExcludeDigest: expect.stringMatching(/^sha256:/),
              infoAttributesDigest: expect.stringMatching(/^sha256:/),
              infoGraftsDigest: expect.stringMatching(/^sha256:/),
            },
            baselineManifest: [
              { path: "AGENTS.md", rawContent: "# Existing instructions\n\nRaw form\n" },
              { path: "CONTEXT.md", rawContent: null },
            ],
          }),
        ]);
      }),
    );

    it.effect(
      "rejects a Git-visible workspace change during baseline capture without dispatching",
      () =>
        Effect.gen(function* () {
          const fileSystem = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          let statusCall = 0;
          let dispatched = false;
          let scanned = false;

          const error = yield* requestProjectContextRunWithServices(
            {
              snapshotQuery: { getCommandReadModel: () => Effect.succeed(makeReadModel()) },
              scanner: {
                scan: () =>
                  Effect.sync(() => {
                    scanned = true;
                    return snapshot;
                  }),
              },
              vcsProcess: {
                run: (input) =>
                  Effect.succeed(
                    auditOutput(input.operation, statusCall++ === 0 ? "" : "?? generated.txt\0"),
                  ),
              },
              fileSystem,
              path,
            },
            {
              projectContextRunId: Effect.succeed(ProjectContextRunId.make("context-run-02")),
              commandId: Effect.succeed(CommandId.make("server:context-run-02")),
              createdAt: Effect.succeed(createdAt),
              dispatch: () =>
                Effect.sync(() => {
                  dispatched = true;
                  return { sequence: 42 };
                }),
            },
            { projectId },
          ).pipe(Effect.flip);

          expect(error).toBeInstanceOf(ProjectContextRunCoordinatorError);
          expect(error).toMatchObject({ reason: "workspace-changed-during-capture" });
          expect(scanned).toBe(true);
          expect(dispatched).toBe(false);
        }),
    );

    it.effect("rejects a canonical context symlink before it can become the run baseline", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fileSystem.makeTempDirectoryScoped({
          prefix: "t3-project-context-symlink-",
        });
        const target = path.join(root, "README.md");
        yield* fileSystem.writeFileString(target, "# In-root target\n");
        yield* fileSystem.symlink(target, path.join(root, "AGENTS.md"));
        let dispatched = false;

        const error = yield* requestProjectContextRunWithServices(
          {
            snapshotQuery: { getCommandReadModel: () => Effect.succeed(makeReadModel(root)) },
            scanner: { scan: () => Effect.succeed(snapshot) },
            vcsProcess: { run: (input) => Effect.succeed(auditOutput(input.operation)) },
            fileSystem,
            path,
          },
          {
            projectContextRunId: Effect.succeed(ProjectContextRunId.make("context-run-symlink")),
            commandId: Effect.succeed(CommandId.make("server:context-run-symlink")),
            createdAt: Effect.succeed(createdAt),
            dispatch: () =>
              Effect.sync(() => {
                dispatched = true;
                return { sequence: 43 };
              }),
          },
          { projectId },
        ).pipe(Effect.flip);

        expect(error).toBeInstanceOf(ProjectContextRunCoordinatorError);
        expect(error).toMatchObject({ reason: "symlinked-context-path" });
        expect(error.message).toContain("AGENTS.md");
        expect(dispatched).toBe(false);
      }),
    );

    it.effect("rejects an unknown project before scanning, status capture, or dispatch", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        let touchedWorkspace = false;
        const missingProjectId = ProjectId.make("missing-project");

        const error = yield* requestProjectContextRunWithServices(
          {
            snapshotQuery: { getCommandReadModel: () => Effect.succeed(makeReadModel()) },
            scanner: {
              scan: () =>
                Effect.sync(() => {
                  touchedWorkspace = true;
                  return snapshot;
                }),
            },
            vcsProcess: {
              run: () =>
                Effect.sync(() => {
                  touchedWorkspace = true;
                  return statusOutput("");
                }),
            },
            fileSystem,
            path,
          },
          {
            projectContextRunId: Effect.succeed(ProjectContextRunId.make("context-run-03")),
            commandId: Effect.succeed(CommandId.make("server:context-run-03")),
            createdAt: Effect.succeed(createdAt),
            dispatch: () =>
              Effect.die(new Error("unknown projects must not dispatch a project-context run")),
          },
          { projectId: missingProjectId },
        ).pipe(Effect.flip);

        expect(error).toBeInstanceOf(ProjectContextRunCoordinatorError);
        expect(error).toMatchObject({ reason: "project-not-found" });
        expect(touchedWorkspace).toBe(false);
      }),
    );

    it.effect(
      "rejects a deleted project returned by the projection before touching its workspace",
      () =>
        Effect.gen(function* () {
          const fileSystem = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          let touchedWorkspace = false;
          let dispatched = false;
          const deletedReadModel: OrchestrationReadModel = {
            ...makeReadModel(),
            projects: makeReadModel().projects.map((project) =>
              Object.assign({}, project, {
                deletedAt: createdAt,
              }),
            ),
          };

          const error = yield* requestProjectContextRunWithServices(
            {
              snapshotQuery: { getCommandReadModel: () => Effect.succeed(deletedReadModel) },
              scanner: {
                scan: () =>
                  Effect.sync(() => {
                    touchedWorkspace = true;
                    return snapshot;
                  }),
              },
              vcsProcess: {
                run: () =>
                  Effect.sync(() => {
                    touchedWorkspace = true;
                    return statusOutput("");
                  }),
              },
              fileSystem,
              path,
            },
            {
              projectContextRunId: Effect.succeed(ProjectContextRunId.make("context-run-deleted")),
              commandId: Effect.succeed(CommandId.make("server:context-run-deleted")),
              createdAt: Effect.succeed(createdAt),
              dispatch: () =>
                Effect.sync(() => {
                  dispatched = true;
                  return { sequence: 44 };
                }),
            },
            { projectId },
          ).pipe(Effect.flip);

          expect(error).toBeInstanceOf(ProjectContextRunCoordinatorError);
          expect(error).toMatchObject({ reason: "project-deleted" });
          expect(touchedWorkspace).toBe(false);
          expect(dispatched).toBe(false);
        }),
    );
  });
});
