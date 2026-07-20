import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import { createHash } from "node:crypto";
import {
  PROJECT_CONTEXT_RUN_MAX_WORKSPACE_STATUS_ENTRIES,
  ProjectContextRunContentDigest,
  ProjectContextRunGitObjectId,
  ProjectContextRunGitState,
  ProjectContextRunWorkspaceStatusEntry,
  type ProjectContextRunWorkspaceStatusManifest,
} from "@t3tools/contracts";

import type { VcsProcessShape } from "../vcs/VcsProcess.ts";
import {
  CANONICAL_PROJECT_CONTEXT_PATHS,
  type ProjectContextOwnershipBaseline,
  type ProjectContextRawFileState,
} from "./ProjectContext.ts";

export const MAX_PROJECT_CONTEXT_CHANGE_DIFF_BYTES = 64 * 1024;
export const MAX_PROJECT_CONTEXT_COMBINED_DIFF_BYTES = 256 * 1024;
const MAX_PROJECT_CONTEXT_STATUS_BYTES = 256 * 1024;
const MAX_PROJECT_CONTEXT_GIT_AUDIT_OUTPUT_BYTES = 256 * 1024;
const MAX_PROJECT_CONTEXT_AUDIT_FILE_BYTES = 1024 * 1024;
const MAX_PROJECT_CONTEXT_AUDIT_TOTAL_BYTES = 16 * 1024 * 1024;
const TRUNCATION_MARKER = "\n[project-context diff truncated]\n";
const CANONICAL_PATH_SET = new Set<string>(CANONICAL_PROJECT_CONTEXT_PATHS);
const ROOT_ADR_PATTERN = /^docs\/adr\/[^/\\]+\.md$/;

export type ProjectContextOwnedChangeKind = "add" | "modify" | "delete";

export interface ProjectContextOwnedChange {
  readonly kind: ProjectContextOwnedChangeKind;
  readonly relativePath: string;
  readonly before: ProjectContextRawFileState;
  readonly after: ProjectContextRawFileState;
  readonly diff: string;
  readonly diffTruncated: boolean;
}

export interface ProjectContextOwnedChanges {
  readonly changes: ReadonlyArray<ProjectContextOwnedChange>;
  readonly diff: string;
  readonly diffTruncated: boolean;
}

export type ProjectContextWorkspaceStatusBaseline = ProjectContextRunWorkspaceStatusManifest;

export type ProjectContextGitStateBaseline = ProjectContextRunGitState;

export interface ProjectContextWorkspaceDrift {
  readonly outsideAllowedScope: ReadonlyArray<{
    readonly relativePath: string;
    readonly beforeStatus: string | null;
    readonly afterStatus: string | null;
    readonly beforeDigest: string | null;
    readonly afterDigest: string | null;
  }>;
}

export interface ProjectContextGitStateDrift {
  readonly scopeViolationPaths: ReadonlyArray<
    | ".git/HEAD"
    | ".git/index"
    | ".git/refs"
    | ".git/config"
    | ".git/hooks"
    | ".git/info/exclude"
    | ".git/info/attributes"
    | ".git/info/grafts"
  >;
}

export class ProjectContextWorkspaceAuditError extends Data.TaggedError(
  "ProjectContextWorkspaceAuditError",
)<{
  readonly detail: string;
}> {}

const compareCodeUnits = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

export function isAllowedProjectContextPath(relativePath: string): boolean {
  return CANONICAL_PATH_SET.has(relativePath) || ROOT_ADR_PATTERN.test(relativePath);
}

function freezeState(state: ProjectContextRawFileState): ProjectContextRawFileState {
  return Object.freeze({ ...state });
}

function truncateUtf8(value: string, maxBytes: number): { text: string; truncated: boolean } {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.byteLength <= maxBytes) return { text: value, truncated: false };
  const markerBytes = Buffer.byteLength(TRUNCATION_MARKER, "utf8");
  const prefix = bytes.subarray(0, Math.max(0, maxBytes - markerBytes)).toString("utf8");
  return { text: `${prefix}${TRUNCATION_MARKER}`, truncated: true };
}

function patchLines(content: string | null, prefix: "-" | "+"): string {
  if (content === null || content.length === 0) return "";
  return content
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

function makeDeterministicDiff(
  relativePath: string,
  before: ProjectContextRawFileState,
  after: ProjectContextRawFileState,
): { text: string; truncated: boolean } {
  const beforeLabel = before.presence === "present" ? `a/${relativePath}` : "/dev/null";
  const afterLabel = after.presence === "present" ? `b/${relativePath}` : "/dev/null";
  const beforeDigest = before.digest ?? "absent";
  const afterDigest = after.digest ?? "absent";
  const body = [patchLines(before.content, "-"), patchLines(after.content, "+")]
    .filter((part) => part.length > 0)
    .join("\n");
  return truncateUtf8(
    [
      `diff --project-context a/${relativePath} b/${relativePath}`,
      `--- ${beforeLabel}`,
      `+++ ${afterLabel}`,
      `@@ ${beforeDigest} -> ${afterDigest} @@`,
      body,
    ]
      .filter((part) => part.length > 0)
      .join("\n"),
    MAX_PROJECT_CONTEXT_CHANGE_DIFF_BYTES,
  );
}

export function compareProjectContextOwnership(
  baseline: ProjectContextOwnershipBaseline,
  current: ProjectContextOwnershipBaseline,
): ProjectContextOwnedChanges {
  const beforeByPath = new Map(baseline.files.map((file) => [file.relativePath, file.state]));
  const afterByPath = new Map(current.files.map((file) => [file.relativePath, file.state]));
  const paths = [...new Set([...beforeByPath.keys(), ...afterByPath.keys()])].toSorted(
    compareCodeUnits,
  );
  const absent = Object.freeze({
    presence: "absent" as const,
    digest: null,
    size: 0 as const,
    content: null,
  });
  const changes: ProjectContextOwnedChange[] = [];

  for (const relativePath of paths) {
    const before = beforeByPath.get(relativePath) ?? absent;
    const after = afterByPath.get(relativePath) ?? absent;
    if (before.presence === after.presence && before.digest === after.digest) continue;
    const diff = makeDeterministicDiff(relativePath, before, after);
    changes.push(
      Object.freeze({
        kind:
          before.presence === "absent" ? "add" : after.presence === "absent" ? "delete" : "modify",
        relativePath,
        before: freezeState(before),
        after: freezeState(after),
        diff: diff.text,
        diffTruncated: diff.truncated,
      }),
    );
  }

  const combined = truncateUtf8(
    changes.map((change) => change.diff).join("\n\n"),
    MAX_PROJECT_CONTEXT_COMBINED_DIFF_BYTES,
  );
  return Object.freeze({
    changes: Object.freeze(changes),
    diff: combined.text,
    diffTruncated: combined.truncated || changes.some((change) => change.diffTruncated),
  });
}

function parsePorcelainStatus(output: string): ReadonlyArray<{
  readonly relativePath: string;
  readonly porcelainStatus: string;
}> {
  const records = output.split("\0");
  const entries: Array<{ relativePath: string; porcelainStatus: string }> = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;
    const status = record.slice(0, 2);
    const relativePath = record.slice(3);
    if (relativePath.length > 0) entries.push({ relativePath, porcelainStatus: status });
    if (status.includes("R") || status.includes("C")) {
      const sourcePath = records[index + 1];
      if (sourcePath) entries.push({ relativePath: sourcePath, porcelainStatus: status });
      index += 1;
    }
  }
  return entries.toSorted((left, right) => compareCodeUnits(left.relativePath, right.relativePath));
}

const isForbiddenAuditPath = (relativePath: string): boolean =>
  relativePath === ".git" ||
  relativePath.startsWith(".git/") ||
  relativePath === ".gedcode" ||
  relativePath.startsWith(".gedcode/");

const digestGitAuditOutput = (output: string): ProjectContextRunContentDigest =>
  ProjectContextRunContentDigest.make(
    `sha256:${createHash("sha256").update(output, "utf8").digest("hex")}`,
  );

const gitAuditOutput = Effect.fn("ProjectContextWorkspaceAudit.gitAuditOutput")(function* (input: {
  readonly workspaceRoot: string;
  readonly process: Pick<VcsProcessShape, "run">;
  readonly operation: string;
  readonly args: ReadonlyArray<string>;
  readonly allowNonZeroExit?: boolean;
}) {
  const result = yield* input.process.run({
    operation: input.operation,
    command: "git",
    args: input.args,
    cwd: input.workspaceRoot,
    ...(input.allowNonZeroExit === true ? { allowNonZeroExit: true } : {}),
    maxOutputBytes: MAX_PROJECT_CONTEXT_GIT_AUDIT_OUTPUT_BYTES,
  });
  if (result.stdoutTruncated || result.stderrTruncated) {
    return yield* new ProjectContextWorkspaceAuditError({
      detail: `${input.operation} exceeded the project-context Git audit output bound.`,
    });
  }
  return result;
});

const parseSingleGitLine = (
  output: string,
  operation: string,
): string | ProjectContextWorkspaceAuditError => {
  const value = output.trim();
  if (value.length === 0 || value.includes("\n")) {
    return new ProjectContextWorkspaceAuditError({
      detail: `${operation} did not return one unambiguous value.`,
    });
  }
  return value;
};

const isInside = (path: Path.Path, root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate).replaceAll("\\", "/");
  return (
    relative === "" ||
    (!relative.startsWith("../") && relative !== ".." && !path.isAbsolute(relative))
  );
};

const digestProjectContextGitMetadata = (value: string): ProjectContextRunContentDigest =>
  ProjectContextRunContentDigest.make(
    `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`,
  );

const assertSafeGitMetadataPath = Effect.fn(
  "ProjectContextWorkspaceAudit.assertSafeGitMetadataPath",
)(function* (input: {
  readonly workspaceRoot: string;
  readonly metadataPath: string;
  readonly administrativeRoots: ReadonlyArray<string>;
  readonly fileSystem: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly label: string;
}) {
  const resolvedPath = input.path.resolve(input.metadataPath);
  const safeRoots = [input.workspaceRoot, ...input.administrativeRoots].map((root) =>
    input.path.resolve(root),
  );
  if (!safeRoots.some((root) => isInside(input.path, root, resolvedPath))) {
    return yield* new ProjectContextWorkspaceAuditError({
      detail: `${input.label} escapes the project or Git administrative roots.`,
    });
  }
  if (!(yield* input.fileSystem.exists(resolvedPath))) return resolvedPath;
  if (Option.isSome(yield* input.fileSystem.readLink(resolvedPath).pipe(Effect.option))) {
    return yield* new ProjectContextWorkspaceAuditError({
      detail: `${input.label} is a symbolic link and cannot be safely audited.`,
    });
  }
  const realPath = yield* input.fileSystem.realPath(resolvedPath).pipe(
    Effect.mapError(
      () =>
        new ProjectContextWorkspaceAuditError({
          detail: `${input.label} cannot be resolved for a safe Git metadata audit.`,
        }),
    ),
  );
  const realRoots = yield* Effect.forEach(safeRoots, (root) =>
    input.fileSystem.realPath(root).pipe(
      Effect.mapError(
        () =>
          new ProjectContextWorkspaceAuditError({
            detail: `Cannot resolve a safe root while auditing ${input.label}.`,
          }),
      ),
    ),
  );
  if (!realRoots.some((root) => isInside(input.path, root, realPath))) {
    return yield* new ProjectContextWorkspaceAuditError({
      detail: `${input.label} resolves outside the project or Git administrative roots.`,
    });
  }
  return resolvedPath;
});

const assertWorkspaceMetadataIsNotIgnored = Effect.fn(
  "ProjectContextWorkspaceAudit.assertWorkspaceMetadataIsNotIgnored",
)(function* (input: {
  readonly workspaceRoot: string;
  readonly metadataPath: string;
  readonly process: Pick<VcsProcessShape, "run">;
  readonly path: Path.Path;
  readonly label: string;
}) {
  if (!isInside(input.path, input.workspaceRoot, input.metadataPath)) return;
  const result = yield* gitAuditOutput({
    workspaceRoot: input.workspaceRoot,
    process: input.process,
    operation: "ProjectContextWorkspaceAudit.checkIgnoredMetadata",
    args: ["check-ignore", "--no-index", "--quiet", "--", input.metadataPath],
    allowNonZeroExit: true,
  });
  if (result.exitCode === 0) {
    return yield* new ProjectContextWorkspaceAuditError({
      detail: `${input.label} is ignored workspace content and cannot be read for a Git metadata audit.`,
    });
  }
  if (result.exitCode !== 1) {
    return yield* new ProjectContextWorkspaceAuditError({
      detail: `Git ignore inspection for ${input.label} exited ${result.exitCode}.`,
    });
  }
});

const captureGitMetadataFileDigest = Effect.fn(
  "ProjectContextWorkspaceAudit.captureGitMetadataFileDigest",
)(function* (input: {
  readonly workspaceRoot: string;
  readonly metadataPath: string;
  readonly administrativeRoots: ReadonlyArray<string>;
  readonly process: Pick<VcsProcessShape, "run">;
  readonly fileSystem: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly label: string;
}) {
  const safePath = yield* assertSafeGitMetadataPath(input);
  if (!(yield* input.fileSystem.exists(safePath))) return digestProjectContextGitMetadata("absent");
  yield* assertWorkspaceMetadataIsNotIgnored({ ...input, metadataPath: safePath });
  const info = yield* input.fileSystem
    .stat(safePath)
    .pipe(
      Effect.mapError(
        () => new ProjectContextWorkspaceAuditError({ detail: `Cannot inspect ${input.label}.` }),
      ),
    );
  if (info.type !== "File") {
    return yield* new ProjectContextWorkspaceAuditError({
      detail: `${input.label} is not a regular file and cannot be safely audited.`,
    });
  }
  if (info.size > BigInt(MAX_PROJECT_CONTEXT_AUDIT_FILE_BYTES)) {
    return yield* new ProjectContextWorkspaceAuditError({
      detail: `${input.label} exceeds the project-context Git metadata audit file bound.`,
    });
  }
  const bytes = yield* input.fileSystem
    .readFile(safePath)
    .pipe(
      Effect.mapError(
        () => new ProjectContextWorkspaceAuditError({ detail: `Cannot read ${input.label}.` }),
      ),
    );
  if (bytes.byteLength > MAX_PROJECT_CONTEXT_AUDIT_FILE_BYTES) {
    return yield* new ProjectContextWorkspaceAuditError({
      detail: `${input.label} exceeds the project-context Git metadata audit file bound.`,
    });
  }
  return digestProjectContextGitMetadata(
    `present\\0${createHash("sha256").update(bytes).digest("hex")}`,
  );
});

const captureGitHooksDigest = Effect.fn("ProjectContextWorkspaceAudit.captureGitHooksDigest")(
  function* (input: {
    readonly workspaceRoot: string;
    readonly hooksPath: string;
    readonly administrativeRoots: ReadonlyArray<string>;
    readonly process: Pick<VcsProcessShape, "run">;
    readonly fileSystem: FileSystem.FileSystem;
    readonly path: Path.Path;
  }) {
    const hooksRoot = yield* assertSafeGitMetadataPath({
      ...input,
      metadataPath: input.hooksPath,
      label: "Git hooks directory",
    });
    if (!(yield* input.fileSystem.exists(hooksRoot)))
      return digestProjectContextGitMetadata("absent");
    const rootInfo = yield* input.fileSystem.stat(hooksRoot).pipe(
      Effect.mapError(
        () =>
          new ProjectContextWorkspaceAuditError({
            detail: "Cannot inspect the Git hooks directory.",
          }),
      ),
    );
    if (rootInfo.type !== "Directory") {
      return yield* new ProjectContextWorkspaceAuditError({
        detail: "Git hooks metadata path is not a directory and cannot be safely audited.",
      });
    }
    const metadata: string[] = ["present"];
    let entryCount = 0;
    let totalBytes = 0;
    const entries = yield* input.fileSystem.readDirectory(hooksRoot, { recursive: true }).pipe(
      Effect.mapError(
        () =>
          new ProjectContextWorkspaceAuditError({
            detail: "Cannot list the Git hooks directory.",
          }),
      ),
    );
    for (const relativePath of entries.toSorted(compareCodeUnits)) {
      if (
        relativePath.length === 0 ||
        relativePath.startsWith("/") ||
        relativePath === ".." ||
        relativePath.startsWith("../") ||
        relativePath.includes("/../") ||
        relativePath.split(/[\\/]+/).some((segment) => segment.length === 0 || segment === ".")
      ) {
        return yield* new ProjectContextWorkspaceAuditError({
          detail: "Git hooks directory contains an unsafe entry name.",
        });
      }
      entryCount += 1;
      if (entryCount > PROJECT_CONTEXT_RUN_MAX_WORKSPACE_STATUS_ENTRIES) {
        return yield* new ProjectContextWorkspaceAuditError({
          detail: "Git hooks directory exceeds the project-context metadata entry audit bound.",
        });
      }
      const safePath = yield* assertSafeGitMetadataPath({
        ...input,
        metadataPath: input.path.join(hooksRoot, relativePath),
        label: `Git hook ${relativePath}`,
      });
      if (Option.isSome(yield* input.fileSystem.readLink(safePath).pipe(Effect.option))) {
        return yield* new ProjectContextWorkspaceAuditError({
          detail: `Git hook ${relativePath} is a symbolic link and cannot be safely audited.`,
        });
      }
      const info = yield* input.fileSystem.stat(safePath).pipe(
        Effect.mapError(
          () =>
            new ProjectContextWorkspaceAuditError({
              detail: `Cannot inspect Git hook ${relativePath}.`,
            }),
        ),
      );
      if (info.type === "Directory") continue;
      if (info.type !== "File") {
        return yield* new ProjectContextWorkspaceAuditError({
          detail: `Git hook ${relativePath} is not a regular file.`,
        });
      }
      yield* assertWorkspaceMetadataIsNotIgnored({
        ...input,
        metadataPath: safePath,
        label: `Git hook ${relativePath}`,
      });
      if (info.size > BigInt(MAX_PROJECT_CONTEXT_AUDIT_FILE_BYTES)) {
        return yield* new ProjectContextWorkspaceAuditError({
          detail: `Git hook ${relativePath} exceeds the project-context metadata audit file bound.`,
        });
      }
      const bytes = yield* input.fileSystem.readFile(safePath).pipe(
        Effect.mapError(
          () =>
            new ProjectContextWorkspaceAuditError({
              detail: `Cannot read Git hook ${relativePath}.`,
            }),
        ),
      );
      totalBytes += bytes.byteLength;
      if (
        bytes.byteLength > MAX_PROJECT_CONTEXT_AUDIT_FILE_BYTES ||
        totalBytes > MAX_PROJECT_CONTEXT_AUDIT_TOTAL_BYTES
      ) {
        return yield* new ProjectContextWorkspaceAuditError({
          detail: "Git hooks contents exceed the project-context metadata audit bound.",
        });
      }
      metadata.push(
        `${relativePath}\\0${info.mode & 0o111 ? "executable" : "non-executable"}\\0${createHash("sha256").update(bytes).digest("hex")}`,
      );
    }
    return digestProjectContextGitMetadata(metadata.join("\\n"));
  },
);

/**
 * Capture Git semantics that porcelain status does not represent. This is
 * intentionally command-based rather than reading .git internals, which keeps
 * linked worktrees and alternate git-dir layouts safe and read-only.
 */
export const captureProjectContextRunGitState = Effect.fn("captureProjectContextRunGitState")(
  function* (input: {
    readonly workspaceRoot: string;
    readonly process: Pick<VcsProcessShape, "run">;
    readonly fileSystem: FileSystem.FileSystem;
    readonly path: Path.Path;
  }) {
    const headResult = yield* gitAuditOutput({
      workspaceRoot: input.workspaceRoot,
      process: input.process,
      operation: "ProjectContextWorkspaceAudit.head",
      args: ["rev-parse", "--verify", "--quiet", "HEAD"],
      allowNonZeroExit: true,
    });
    const symbolicHeadResult = yield* gitAuditOutput({
      workspaceRoot: input.workspaceRoot,
      process: input.process,
      operation: "ProjectContextWorkspaceAudit.symbolicHead",
      args: ["symbolic-ref", "--quiet", "HEAD"],
      allowNonZeroExit: true,
    });

    let head: ProjectContextRunGitState["head"];
    if (headResult.exitCode === 0) {
      const parsed = parseSingleGitLine(headResult.stdout, "Git HEAD inspection");
      if (parsed instanceof ProjectContextWorkspaceAuditError) return yield* parsed;
      if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(parsed)) {
        return yield* new ProjectContextWorkspaceAuditError({
          detail: "Git HEAD inspection returned an invalid object identifier.",
        });
      }
      head = ProjectContextRunGitObjectId.make(parsed);
    } else if (headResult.exitCode === 1) {
      head = null;
    } else {
      return yield* new ProjectContextWorkspaceAuditError({
        detail: `Git HEAD inspection exited ${headResult.exitCode}.`,
      });
    }

    let headIdentity: ProjectContextRunGitState["headIdentity"];
    if (symbolicHeadResult.exitCode === 0) {
      const ref = parseSingleGitLine(symbolicHeadResult.stdout, "Git symbolic HEAD inspection");
      if (ref instanceof ProjectContextWorkspaceAuditError) return yield* ref;
      if (ref.includes("\u0000") || !/^refs\/heads\/[^\s~^:?*\\[\\]+$/.test(ref)) {
        return yield* new ProjectContextWorkspaceAuditError({
          detail: "Git symbolic HEAD inspection returned an unsafe branch reference.",
        });
      }
      headIdentity = { kind: "branch", ref };
    } else if (symbolicHeadResult.exitCode === 1 && head !== null) {
      headIdentity = { kind: "detached" };
    } else {
      return yield* new ProjectContextWorkspaceAuditError({
        detail:
          head === null
            ? "Git HEAD is missing without a symbolic unborn branch."
            : `Git symbolic HEAD inspection exited ${symbolicHeadResult.exitCode}.`,
      });
    }

    const [stagedIndex, refs, config, gitDir, gitCommonDir, defaultHooksPath, configuredHooksPath] =
      yield* Effect.all([
        gitAuditOutput({
          workspaceRoot: input.workspaceRoot,
          process: input.process,
          operation: "ProjectContextWorkspaceAudit.stagedIndex",
          args: [
            "diff",
            "--cached",
            "--binary",
            "--full-index",
            "--no-ext-diff",
            "--no-color",
            "--no-renames",
          ],
        }),
        gitAuditOutput({
          workspaceRoot: input.workspaceRoot,
          process: input.process,
          operation: "ProjectContextWorkspaceAudit.refs",
          args: ["for-each-ref", "--sort=refname", "--format=%(refname)%00%(objectname)%00"],
        }),
        gitAuditOutput({
          workspaceRoot: input.workspaceRoot,
          process: input.process,
          operation: "ProjectContextWorkspaceAudit.config",
          args: ["config", "--local", "--null", "--list"],
        }),
        gitAuditOutput({
          workspaceRoot: input.workspaceRoot,
          process: input.process,
          operation: "ProjectContextWorkspaceAudit.gitDir",
          args: ["rev-parse", "--path-format=absolute", "--git-dir"],
        }),
        gitAuditOutput({
          workspaceRoot: input.workspaceRoot,
          process: input.process,
          operation: "ProjectContextWorkspaceAudit.gitCommonDir",
          args: ["rev-parse", "--path-format=absolute", "--git-common-dir"],
        }),
        gitAuditOutput({
          workspaceRoot: input.workspaceRoot,
          process: input.process,
          operation: "ProjectContextWorkspaceAudit.defaultHooksPath",
          args: ["rev-parse", "--path-format=absolute", "--git-path", "hooks"],
        }),
        gitAuditOutput({
          workspaceRoot: input.workspaceRoot,
          process: input.process,
          operation: "ProjectContextWorkspaceAudit.configuredHooksPath",
          args: ["config", "--local", "--type=path", "--get", "core.hooksPath"],
          allowNonZeroExit: true,
        }),
      ] as const);

    const parsedGitDir = parseSingleGitLine(gitDir.stdout, "Git directory inspection");
    if (parsedGitDir instanceof ProjectContextWorkspaceAuditError) return yield* parsedGitDir;
    const parsedGitCommonDir = parseSingleGitLine(
      gitCommonDir.stdout,
      "Git common directory inspection",
    );
    if (parsedGitCommonDir instanceof ProjectContextWorkspaceAuditError) {
      return yield* parsedGitCommonDir;
    }
    const parsedDefaultHooksPath = parseSingleGitLine(
      defaultHooksPath.stdout,
      "Git hooks path inspection",
    );
    if (parsedDefaultHooksPath instanceof ProjectContextWorkspaceAuditError) {
      return yield* parsedDefaultHooksPath;
    }
    let hooksPath = parsedDefaultHooksPath;
    if (configuredHooksPath.exitCode === 0) {
      const configuredPath = parseSingleGitLine(
        configuredHooksPath.stdout,
        "Git configured hooks path inspection",
      );
      if (configuredPath instanceof ProjectContextWorkspaceAuditError) return yield* configuredPath;
      if (configuredPath.startsWith("~")) {
        return yield* new ProjectContextWorkspaceAuditError({
          detail: "Git configured hooks path uses home expansion and cannot be safely audited.",
        });
      }
      hooksPath = input.path.isAbsolute(configuredPath)
        ? configuredPath
        : input.path.resolve(input.workspaceRoot, configuredPath);
    } else if (configuredHooksPath.exitCode !== 1) {
      return yield* new ProjectContextWorkspaceAuditError({
        detail: `Git configured hooks path inspection exited ${configuredHooksPath.exitCode}.`,
      });
    }

    const administrativeRoots = [parsedGitDir, parsedGitCommonDir];
    const [hooksDigest, infoExcludeDigest, infoAttributesDigest, infoGraftsDigest] =
      yield* Effect.all([
        captureGitHooksDigest({
          workspaceRoot: input.workspaceRoot,
          hooksPath,
          administrativeRoots,
          process: input.process,
          fileSystem: input.fileSystem,
          path: input.path,
        }),
        captureGitMetadataFileDigest({
          workspaceRoot: input.workspaceRoot,
          metadataPath: input.path.join(parsedGitCommonDir, "info", "exclude"),
          administrativeRoots,
          process: input.process,
          fileSystem: input.fileSystem,
          path: input.path,
          label: "Git info/exclude",
        }),
        captureGitMetadataFileDigest({
          workspaceRoot: input.workspaceRoot,
          metadataPath: input.path.join(parsedGitCommonDir, "info", "attributes"),
          administrativeRoots,
          process: input.process,
          fileSystem: input.fileSystem,
          path: input.path,
          label: "Git info/attributes",
        }),
        captureGitMetadataFileDigest({
          workspaceRoot: input.workspaceRoot,
          metadataPath: input.path.join(parsedGitCommonDir, "info", "grafts"),
          administrativeRoots,
          process: input.process,
          fileSystem: input.fileSystem,
          path: input.path,
          label: "Git info/grafts",
        }),
      ] as const);

    return ProjectContextRunGitState.make({
      head,
      headIdentity,
      stagedIndexDigest: digestGitAuditOutput(stagedIndex.stdout),
      refsDigest: digestGitAuditOutput(refs.stdout),
      configDigest: digestGitAuditOutput(config.stdout),
      hooksDigest,
      infoExcludeDigest,
      infoAttributesDigest,
      infoGraftsDigest,
    });
  },
);

export const sameProjectContextRunGitState = (
  before: ProjectContextGitStateBaseline,
  after: ProjectContextGitStateBaseline,
): boolean =>
  before.head === after.head &&
  before.headIdentity.kind === after.headIdentity.kind &&
  (before.headIdentity.kind !== "branch" ||
    after.headIdentity.kind !== "branch" ||
    before.headIdentity.ref === after.headIdentity.ref) &&
  before.stagedIndexDigest === after.stagedIndexDigest &&
  before.refsDigest === after.refsDigest &&
  before.configDigest === after.configDigest &&
  before.hooksDigest === after.hooksDigest &&
  before.infoExcludeDigest === after.infoExcludeDigest &&
  before.infoAttributesDigest === after.infoAttributesDigest &&
  before.infoGraftsDigest === after.infoGraftsDigest;

export function auditProjectContextGitStateDrift(
  baseline: ProjectContextGitStateBaseline,
  current: ProjectContextGitStateBaseline,
): ProjectContextGitStateDrift {
  const scopeViolationPaths: ProjectContextGitStateDrift["scopeViolationPaths"] = [
    ...(baseline.head !== current.head ||
    baseline.headIdentity.kind !== current.headIdentity.kind ||
    (baseline.headIdentity.kind === "branch" &&
      current.headIdentity.kind === "branch" &&
      baseline.headIdentity.ref !== current.headIdentity.ref)
      ? [".git/HEAD" as const]
      : []),
    ...(baseline.stagedIndexDigest !== current.stagedIndexDigest ? [".git/index" as const] : []),
    ...(baseline.refsDigest !== current.refsDigest ? [".git/refs" as const] : []),
    ...(baseline.configDigest !== current.configDigest ? [".git/config" as const] : []),
    ...(baseline.hooksDigest !== current.hooksDigest ? [".git/hooks" as const] : []),
    ...(baseline.infoExcludeDigest !== current.infoExcludeDigest
      ? [".git/info/exclude" as const]
      : []),
    ...(baseline.infoAttributesDigest !== current.infoAttributesDigest
      ? [".git/info/attributes" as const]
      : []),
    ...(baseline.infoGraftsDigest !== current.infoGraftsDigest
      ? [".git/info/grafts" as const]
      : []),
  ];
  return Object.freeze({ scopeViolationPaths: Object.freeze(scopeViolationPaths) });
}

export const captureProjectContextWorkspaceStatus = Effect.fn(
  "captureProjectContextWorkspaceStatus",
)(function* (input: {
  readonly workspaceRoot: string;
  readonly process: Pick<VcsProcessShape, "run">;
  readonly fileSystem: FileSystem.FileSystem;
  readonly path: Path.Path;
}) {
  const result = yield* input.process.run({
    operation: "ProjectContextWorkspaceAudit.status",
    command: "git",
    args: ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", "."],
    cwd: input.workspaceRoot,
    maxOutputBytes: MAX_PROJECT_CONTEXT_STATUS_BYTES,
  });
  if (result.stdoutTruncated) {
    return yield* new ProjectContextWorkspaceAuditError({
      detail: "Git status exceeded the project-context workspace audit bound.",
    });
  }
  const parsed = parsePorcelainStatus(result.stdout);
  if (parsed.length > PROJECT_CONTEXT_RUN_MAX_WORKSPACE_STATUS_ENTRIES) {
    return yield* new ProjectContextWorkspaceAuditError({
      detail: `Git status exceeds the ${PROJECT_CONTEXT_RUN_MAX_WORKSPACE_STATUS_ENTRIES} entry audit bound.`,
    });
  }
  if (new Set(parsed.map((entry) => entry.relativePath)).size !== parsed.length) {
    return yield* new ProjectContextWorkspaceAuditError({
      detail: "Git status contains duplicate paths and cannot form an unambiguous audit baseline.",
    });
  }
  let totalBytes = 0;
  const manifest: ProjectContextRunWorkspaceStatusEntry[] = [];
  for (const entry of parsed) {
    const relativePath = entry.relativePath.replaceAll("\\", "/");
    if (
      relativePath.length === 0 ||
      relativePath.length > 4_096 ||
      relativePath.trim() !== relativePath ||
      relativePath.startsWith("/") ||
      relativePath === ".." ||
      relativePath.startsWith("../") ||
      relativePath.includes("/../") ||
      isForbiddenAuditPath(relativePath)
    ) {
      return yield* new ProjectContextWorkspaceAuditError({
        detail: `Git status path cannot be safely audited: ${relativePath || "<empty>"}.`,
      });
    }
    const absolutePath = input.path.join(input.workspaceRoot, relativePath);
    const linkTarget = yield* input.fileSystem.readLink(absolutePath).pipe(Effect.option);
    if (Option.isSome(linkTarget)) {
      return yield* new ProjectContextWorkspaceAuditError({
        detail: `Git status path is a symbolic link and cannot be safely audited: ${relativePath}.`,
      });
    }
    let contentDigest = null;
    if (yield* input.fileSystem.exists(absolutePath)) {
      const info = yield* input.fileSystem.stat(absolutePath).pipe(
        Effect.mapError(
          () =>
            new ProjectContextWorkspaceAuditError({
              detail: `Cannot inspect Git status path: ${relativePath}.`,
            }),
        ),
      );
      if (info.type === "File") {
        if (info.size > BigInt(MAX_PROJECT_CONTEXT_AUDIT_FILE_BYTES)) {
          return yield* new ProjectContextWorkspaceAuditError({
            detail: `Git status path exceeds the ${MAX_PROJECT_CONTEXT_AUDIT_FILE_BYTES} byte audit bound: ${relativePath}.`,
          });
        }
        const bytes = yield* input.fileSystem.readFile(absolutePath).pipe(
          Effect.mapError(
            () =>
              new ProjectContextWorkspaceAuditError({
                detail: `Cannot hash Git status path: ${relativePath}.`,
              }),
          ),
        );
        totalBytes += bytes.byteLength;
        if (
          bytes.byteLength > MAX_PROJECT_CONTEXT_AUDIT_FILE_BYTES ||
          totalBytes > MAX_PROJECT_CONTEXT_AUDIT_TOTAL_BYTES
        ) {
          return yield* new ProjectContextWorkspaceAuditError({
            detail: `Git status contents exceed the ${MAX_PROJECT_CONTEXT_AUDIT_TOTAL_BYTES} byte total audit bound.`,
          });
        }
        contentDigest = ProjectContextRunContentDigest.make(
          `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
        );
      }
    }
    manifest.push(
      ProjectContextRunWorkspaceStatusEntry.make({
        relativePath,
        porcelainStatus: entry.porcelainStatus,
        contentDigest,
      }),
    );
  }
  return Object.freeze(manifest);
});

const statusByPath = (
  baseline: ProjectContextWorkspaceStatusBaseline,
): Map<string, ProjectContextRunWorkspaceStatusEntry> =>
  new Map(baseline.map((entry) => [entry.relativePath, entry]));

export function auditProjectContextWorkspaceDrift(
  baseline: ProjectContextWorkspaceStatusBaseline,
  current: ProjectContextWorkspaceStatusBaseline,
): ProjectContextWorkspaceDrift {
  const before = statusByPath(baseline);
  const after = statusByPath(current);
  const paths = [...new Set([...before.keys(), ...after.keys()])].toSorted(compareCodeUnits);
  const outsideAllowedScope = paths
    .filter((relativePath) => !isAllowedProjectContextPath(relativePath))
    .filter((relativePath) => {
      const beforeEntry = before.get(relativePath);
      const afterEntry = after.get(relativePath);
      return (
        beforeEntry?.porcelainStatus !== afterEntry?.porcelainStatus ||
        beforeEntry?.contentDigest !== afterEntry?.contentDigest
      );
    })
    .map((relativePath) =>
      Object.freeze({
        relativePath,
        beforeStatus: before.get(relativePath)?.porcelainStatus ?? null,
        afterStatus: after.get(relativePath)?.porcelainStatus ?? null,
        beforeDigest: before.get(relativePath)?.contentDigest ?? null,
        afterDigest: after.get(relativePath)?.contentDigest ?? null,
      }),
    );
  return Object.freeze({
    outsideAllowedScope: Object.freeze(outsideAllowedScope),
  });
}
