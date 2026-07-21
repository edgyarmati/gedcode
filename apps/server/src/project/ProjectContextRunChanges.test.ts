import { describe, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  ProjectContextRunContentDigest,
  ProjectContextRunGitState,
  ProjectContextRunWorkspaceStatusEntry,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { ChildProcessSpawner } from "effect/unstable/process";

import type { VcsProcessShape, VcsProcessInput } from "../vcs/VcsProcess.ts";
import type {
  ProjectContextContentDigest,
  ProjectContextOwnershipBaseline,
  ProjectContextRawFileState,
} from "./ProjectContext.ts";
import {
  auditProjectContextWorkspaceDrift,
  auditProjectContextGitStateDrift,
  captureProjectContextRunGitState,
  captureProjectContextWorkspaceStatus,
  compareProjectContextOwnership,
  isAllowedProjectContextPath,
} from "./ProjectContextRunChanges.ts";

const absent = (): ProjectContextRawFileState => ({
  presence: "absent",
  digest: null,
  size: 0,
  content: null,
});

const present = (content: string, digest: string): ProjectContextRawFileState => ({
  presence: "present",
  digest: `sha256:${digest}` as ProjectContextContentDigest,
  size: Buffer.byteLength(content),
  content,
});

const baseline = (
  files: ReadonlyArray<readonly [string, ProjectContextRawFileState]>,
): ProjectContextOwnershipBaseline => ({
  files: files.map(([relativePath, state]) => ({ relativePath, state })),
});

const statusEntry = (relativePath: string, porcelainStatus: string, digest: string) =>
  ProjectContextRunWorkspaceStatusEntry.make({
    relativePath,
    porcelainStatus,
    contentDigest: ProjectContextRunContentDigest.make(`sha256:${digest.repeat(64).slice(0, 64)}`),
  });

describe("ProjectContextRunChanges", () => {
  it("returns immutable deterministic add, modify, and delete records from the raw baseline", () => {
    const before = baseline([
      ["AGENTS.md", present("# User draft\n", "before")],
      ["CONTEXT.md", absent()],
      ["docs/adr/0001.md", present("# Old decision\n", "deleted")],
    ]);
    const after = baseline([
      ["AGENTS.md", present("# User draft\nAgent addition\n", "after")],
      ["CONTEXT.md", present("# Context\n", "added")],
    ]);

    const first = compareProjectContextOwnership(before, after);
    const restarted = compareProjectContextOwnership(before, after);

    expect(first).toEqual(restarted);
    expect(first.changes.map((change) => [change.relativePath, change.kind])).toEqual([
      ["AGENTS.md", "modify"],
      ["CONTEXT.md", "add"],
      ["docs/adr/0001.md", "delete"],
    ]);
    expect(first.changes[0]?.before.content).toBe("# User draft\n");
    expect(first.changes[0]?.after.content).toBe("# User draft\nAgent addition\n");
    expect(first.diff).toContain("@@ sha256:before -> sha256:after @@");
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.changes)).toBe(true);
    expect(first.changes.every(Object.isFrozen)).toBe(true);
  });

  it("recognizes only the four canonical files and non-recursive root ADR Markdown", () => {
    expect(isAllowedProjectContextPath("AGENTS.md")).toBe(true);
    expect(isAllowedProjectContextPath(".ged/PROJECT.md")).toBe(true);
    expect(isAllowedProjectContextPath(".ged/MANIFEST.json")).toBe(true);
    expect(isAllowedProjectContextPath("docs/adr/0001.md")).toBe(true);
    expect(isAllowedProjectContextPath("docs/adr/nested/0002.md")).toBe(false);
    expect(isAllowedProjectContextPath(".gedcode/CONTEXT.md")).toBe(false);
    expect(isAllowedProjectContextPath("docs/adr/secret.txt")).toBe(false);
  });

  it("preserves pre-existing unrelated dirt and reports only new outside-scope status drift", () => {
    const before = [statusEntry("AGENTS.md", " M", "a"), statusEntry("README.md", " M", "b")];
    const after = [
      statusEntry("AGENTS.md", " M", "c"),
      statusEntry("README.md", " M", "b"),
      statusEntry("docs/adr/0001.md", "??", "d"),
      statusEntry("package.json", " M", "e"),
    ];

    const audit = auditProjectContextWorkspaceDrift(before, after);

    expect(audit.outsideAllowedScope).toEqual([
      {
        relativePath: "package.json",
        beforeStatus: null,
        afterStatus: " M",
        beforeDigest: null,
        afterDigest: `sha256:${"e".repeat(64)}`,
      },
    ]);
  });

  it("detects content changes on an already-dirty outside-scope path with unchanged status", () => {
    const audit = auditProjectContextWorkspaceDrift(
      [statusEntry("README.md", " M", "a")],
      [statusEntry("README.md", " M", "b")],
    );

    expect(audit.outsideAllowedScope).toEqual([
      {
        relativePath: "README.md",
        beforeStatus: " M",
        afterStatus: " M",
        beforeDigest: `sha256:${"a".repeat(64)}`,
        afterDigest: `sha256:${"b".repeat(64)}`,
      },
    ]);
  });

  it("reports semantic Git mutations through explicit pseudo-paths", () => {
    const before = ProjectContextRunGitState.make({
      head: null,
      headIdentity: { kind: "branch" as const, ref: "refs/heads/main" },
      stagedIndexDigest: ProjectContextRunContentDigest.make(`sha256:${"b".repeat(64)}`),
      refsDigest: ProjectContextRunContentDigest.make(`sha256:${"c".repeat(64)}`),
      configDigest: ProjectContextRunContentDigest.make(`sha256:${"d".repeat(64)}`),
      hooksDigest: ProjectContextRunContentDigest.make(`sha256:${"e".repeat(64)}`),
      infoExcludeDigest: ProjectContextRunContentDigest.make(`sha256:${"f".repeat(64)}`),
      infoAttributesDigest: ProjectContextRunContentDigest.make(`sha256:${"0".repeat(64)}`),
      infoGraftsDigest: ProjectContextRunContentDigest.make(`sha256:${"1".repeat(64)}`),
    });
    const after = ProjectContextRunGitState.make({
      head: null,
      headIdentity: { kind: "detached" as const },
      stagedIndexDigest: ProjectContextRunContentDigest.make(`sha256:${"f".repeat(64)}`),
      refsDigest: ProjectContextRunContentDigest.make(`sha256:${"0".repeat(64)}`),
      configDigest: ProjectContextRunContentDigest.make(`sha256:${"1".repeat(64)}`),
      hooksDigest: ProjectContextRunContentDigest.make(`sha256:${"2".repeat(64)}`),
      infoExcludeDigest: ProjectContextRunContentDigest.make(`sha256:${"3".repeat(64)}`),
      infoAttributesDigest: ProjectContextRunContentDigest.make(`sha256:${"4".repeat(64)}`),
      infoGraftsDigest: ProjectContextRunContentDigest.make(`sha256:${"5".repeat(64)}`),
    });

    expect(auditProjectContextGitStateDrift(before, after).scopeViolationPaths).toEqual([
      ".git/HEAD",
      ".git/index",
      ".git/refs",
      ".git/config",
      ".git/hooks",
      ".git/info/exclude",
      ".git/info/attributes",
      ".git/info/grafts",
    ]);
  });

  it.effect("captures bounded semantic Git state without reading .git files", () =>
    Effect.gen(function* () {
      const calls: VcsProcessInput[] = [];
      const process: Pick<VcsProcessShape, "run"> = {
        run: (input) => {
          calls.push(input);
          const stdout =
            input.operation === "ProjectContextWorkspaceAudit.head"
              ? `${"a".repeat(40)}\n`
              : input.operation === "ProjectContextWorkspaceAudit.symbolicHead"
                ? "refs/heads/main\n"
                : input.operation === "ProjectContextWorkspaceAudit.refs"
                  ? `refs/heads/main\0${"a".repeat(40)}\0\n`
                  : input.operation === "ProjectContextWorkspaceAudit.config"
                    ? "remote.origin.url\0https://example.test/repo.git\0"
                    : input.operation === "ProjectContextWorkspaceAudit.gitDir" ||
                        input.operation === "ProjectContextWorkspaceAudit.gitCommonDir"
                      ? "/tmp/project-context-git-audit/.git\n"
                      : input.operation === "ProjectContextWorkspaceAudit.defaultHooksPath"
                        ? "/tmp/project-context-git-audit/.git/hooks\n"
                        : "";
          return Effect.succeed({
            exitCode: ChildProcessSpawner.ExitCode(
              input.operation === "ProjectContextWorkspaceAudit.configuredHooksPath" ? 1 : 0,
            ),
            stdout,
            stderr: "",
            stdoutTruncated: false,
            stderrTruncated: false,
          });
        },
      };

      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const captured = yield* captureProjectContextRunGitState({
        workspaceRoot: "/tmp/project-context-git-audit",
        process,
        fileSystem,
        path,
      });

      expect(captured).toMatchObject({
        head: "a".repeat(40),
        headIdentity: { kind: "branch", ref: "refs/heads/main" },
      });
      expect(captured.stagedIndexDigest).toMatch(/^sha256:/);
      expect(calls.map((call) => call.args)).toContainEqual([
        "diff",
        "--cached",
        "--binary",
        "--full-index",
        "--no-ext-diff",
        "--no-color",
        "--no-renames",
      ]);
      expect(calls.map((call) => call.args)).toContainEqual([
        "for-each-ref",
        "--sort=refname",
        "--format=%(refname)%00%(objectname)%00",
      ]);
      expect(calls.map((call) => call.args)).toContainEqual([
        "config",
        "--local",
        "--null",
        "--list",
      ]);
      expect(calls.every((call) => call.maxOutputBytes === 262_144)).toBe(true);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("hashes effective hook execution metadata and Git info files", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const workspaceRoot = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-project-context-git-metadata-",
      });
      const gitDir = path.join(workspaceRoot, ".git");
      yield* fileSystem.makeDirectory(path.join(gitDir, "hooks"), { recursive: true });
      yield* fileSystem.makeDirectory(path.join(gitDir, "info"), { recursive: true });
      const hookPath = path.join(gitDir, "hooks", "pre-commit");
      yield* fileSystem.writeFileString(hookPath, "#!/bin/sh\nexit 0\n");
      yield* fileSystem.chmod(hookPath, 0o755);
      yield* fileSystem.writeFileString(path.join(gitDir, "info", "exclude"), ".cache\n");
      yield* fileSystem.writeFileString(path.join(gitDir, "info", "attributes"), "*.md text\n");
      yield* fileSystem.writeFileString(path.join(gitDir, "info", "grafts"), "");
      const process: Pick<VcsProcessShape, "run"> = {
        run: (input) =>
          Effect.succeed({
            exitCode: ChildProcessSpawner.ExitCode(
              input.operation === "ProjectContextWorkspaceAudit.configuredHooksPath" ||
                input.operation === "ProjectContextWorkspaceAudit.checkIgnoredMetadata"
                ? 1
                : 0,
            ),
            stdout:
              input.operation === "ProjectContextWorkspaceAudit.head"
                ? `${"a".repeat(40)}\n`
                : input.operation === "ProjectContextWorkspaceAudit.symbolicHead"
                  ? "refs/heads/main\n"
                  : input.operation === "ProjectContextWorkspaceAudit.gitDir" ||
                      input.operation === "ProjectContextWorkspaceAudit.gitCommonDir"
                    ? `${gitDir}\n`
                    : input.operation === "ProjectContextWorkspaceAudit.defaultHooksPath"
                      ? `${path.join(gitDir, "hooks")}\n`
                      : "",
            stderr: "",
            stdoutTruncated: false,
            stderrTruncated: false,
          }),
      };
      const baseline = yield* captureProjectContextRunGitState({
        workspaceRoot,
        process,
        fileSystem,
        path,
      });

      yield* fileSystem.chmod(hookPath, 0o644);
      const current = yield* captureProjectContextRunGitState({
        workspaceRoot,
        process,
        fileSystem,
        path,
      });
      expect(current.hooksDigest).not.toEqual(baseline.hooksDigest);
      expect(auditProjectContextGitStateDrift(baseline, current).scopeViolationPaths).toEqual([
        ".git/hooks",
      ]);

      yield* fileSystem.remove(hookPath);
      yield* fileSystem.symlink(path.join(workspaceRoot, "outside-hook"), hookPath);
      const failure = yield* Effect.flip(
        captureProjectContextRunGitState({ workspaceRoot, process, fileSystem, path }),
      );
      expect(failure._tag).toBe("ProjectContextWorkspaceAuditError");
      if (failure._tag === "ProjectContextWorkspaceAuditError") {
        expect(failure.detail).toContain("symbolic link");
      }
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("captures status names with a read-only bounded Git command", () =>
    Effect.gen(function* () {
      const calls: VcsProcessInput[] = [];
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const workspaceRoot = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-project-context-audit-",
      });
      yield* fileSystem.writeFileString(path.join(workspaceRoot, "AGENTS.md"), "# Agent\n");
      yield* fileSystem.makeDirectory(path.join(workspaceRoot, "docs/adr"), { recursive: true });
      yield* fileSystem.writeFileString(path.join(workspaceRoot, "docs/adr/0001.md"), "# ADR\n");
      const process: Pick<VcsProcessShape, "run"> = {
        run: (input) => {
          calls.push(input);
          return Effect.succeed({
            exitCode: ChildProcessSpawner.ExitCode(0),
            stdout: " M AGENTS.md\0?? docs/adr/0001.md\0",
            stderr: "",
            stdoutTruncated: false,
            stderrTruncated: false,
          });
        },
      };

      const captured = yield* captureProjectContextWorkspaceStatus({
        workspaceRoot,
        process,
        fileSystem,
        path,
      });

      expect(
        captured.map(({ relativePath, porcelainStatus }) => ({ relativePath, porcelainStatus })),
      ).toEqual([
        { relativePath: "AGENTS.md", porcelainStatus: " M" },
        { relativePath: "docs/adr/0001.md", porcelainStatus: "??" },
      ]);
      expect(captured.every((entry) => entry.contentDigest?.startsWith("sha256:"))).toBe(true);
      expect(calls[0]).toEqual({
        operation: "ProjectContextWorkspaceAudit.status",
        command: "git",
        args: ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", "."],
        cwd: workspaceRoot,
        maxOutputBytes: 262_144,
      });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
