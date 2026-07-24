import * as FileSystem from "effect/FileSystem";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";

import { VcsProcess } from "../vcs/VcsProcess.ts";
import { ORCHESTRATOR_WORKER_RUNTIME_MODE } from "./orchestratorRuntimeModes.ts";

export const TASK_WORKTREE_HOOKS_DIR = ".gedcode-hooks";

// Anchored to the worktree root so plain `git add -A` / `git status` skip the
// managed hooks without a negative pathspec (which git rejects with exit 1 when
// the directory is already ignored). Registered in the repository's info/exclude
// rather than a tracked `.gitignore`, so target repos are never mutated.
const TASK_WORKTREE_HOOKS_IGNORE_ENTRY = `/${TASK_WORKTREE_HOOKS_DIR}/`;

// A repository-relative path that belongs to the managed hooks directory.
// Used to keep the server-owned safety hooks out of change inspection, staging
// selection, and stage-ownership audits, independent of git-ignore state.
export function isTaskWorktreeHooksPath(path: string): boolean {
  return path === TASK_WORKTREE_HOOKS_DIR || path.startsWith(`${TASK_WORKTREE_HOOKS_DIR}/`);
}

export function resolveWorkerStageRuntimeMode() {
  return ORCHESTRATOR_WORKER_RUNTIME_MODE;
}

export const TASK_WORKTREE_PRE_PUSH_HOOK = `#!/bin/sh
while read local_ref local_sha remote_ref remote_sha
do
  case "$remote_ref" in
    refs/heads/main|refs/heads/master|refs/heads/trunk|refs/heads/develop|refs/heads/dev|refs/heads/release|refs/heads/release/*)
      echo "GedCode Orchestrator worker worktrees cannot push protected ref $remote_ref directly." >&2
      exit 1
      ;;
  esac
done
exit 0
`;

const WORKER_ENV_ALLOWLIST = new Set([
  "CI",
  "COMSPEC",
  "HOME",
  "LANG",
  "LOGNAME",
  "PATH",
  "Path",
  "PATHEXT",
  "PWD",
  "SHELL",
  "SystemRoot",
  "TEMP",
  "TERM",
  "TMP",
  "TMPDIR",
  "USER",
  "USERNAME",
  "WINDIR",
  "windir",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_RUNTIME_DIR",
]);

const SENSITIVE_WORKER_ENV_NAME = /(^|_)(KEY|TOKEN|SECRET)$/i;

export function isSensitiveWorkerEnvironmentName(name: string): boolean {
  return SENSITIVE_WORKER_ENV_NAME.test(name);
}

export function makeWorkerProviderEnvironment(
  baseEnv: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const entries: Array<[string, string]> = [];
  for (const [name, value] of Object.entries(baseEnv)) {
    if (value === undefined) {
      continue;
    }
    if (isSensitiveWorkerEnvironmentName(name)) {
      continue;
    }
    if (WORKER_ENV_ALLOWLIST.has(name) || name.startsWith("LC_")) {
      entries.push([name, value]);
    }
  }
  return Object.fromEntries(entries);
}

export const installTaskWorktreePushBlockHook = Effect.fn("installTaskWorktreePushBlockHook")(
  function* (worktreePath: string) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const vcsProcess = yield* VcsProcess;
    const hooksDir = path.join(worktreePath, TASK_WORKTREE_HOOKS_DIR);
    const hookPath = path.join(hooksDir, "pre-push");

    yield* fs.makeDirectory(hooksDir, { recursive: true });
    yield* fs.writeFileString(hookPath, TASK_WORKTREE_PRE_PUSH_HOOK);
    yield* fs.chmod(hookPath, 0o755);
    yield* vcsProcess.run({
      operation: "OrchestratorWorkerSafety.enableWorktreeConfig",
      command: "git",
      args: ["config", "extensions.worktreeConfig", "true"],
      cwd: worktreePath,
    });
    yield* vcsProcess.run({
      operation: "OrchestratorWorkerSafety.installPushBlockHook",
      command: "git",
      args: ["config", "--worktree", "core.hooksPath", hooksDir],
      cwd: worktreePath,
    });
    yield* ensureTaskWorktreeHooksIgnored(worktreePath);
  },
);

// Ensures the managed hooks directory is git-ignored inside the worktree so the
// server-owned staging step (`git add -A`) neither fails on it nor commits it.
// Idempotent: safe to run on every handoff. Writes to the repository's
// info/exclude (resolved via git so linked worktrees share the common dir),
// leaving any tracked `.gitignore` untouched.
export const ensureTaskWorktreeHooksIgnored = Effect.fn("ensureTaskWorktreeHooksIgnored")(
  function* (worktreePath: string) {
    const fs = yield* FileSystem.FileSystem;
    const vcsProcess = yield* VcsProcess;
    const resolved = yield* vcsProcess.run({
      operation: "OrchestratorWorkerSafety.resolveInfoExclude",
      command: "git",
      args: ["rev-parse", "--path-format=absolute", "--git-path", "info/exclude"],
      cwd: worktreePath,
    });
    const excludePath = resolved.stdout.trim();
    if (excludePath.length === 0) {
      return;
    }
    const current = (yield* fs.exists(excludePath)) ? yield* fs.readFileString(excludePath) : "";
    const alreadyIgnored = current
      .split("\n")
      .some((line) => line.trim() === TASK_WORKTREE_HOOKS_IGNORE_ENTRY);
    if (alreadyIgnored) {
      return;
    }
    const separator = current.length === 0 || current.endsWith("\n") ? "" : "\n";
    yield* fs.writeFileString(
      excludePath,
      `${current}${separator}${TASK_WORKTREE_HOOKS_IGNORE_ENTRY}\n`,
    );
  },
);
