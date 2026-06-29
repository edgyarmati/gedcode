import type { RuntimeMode } from "@t3tools/contracts";
import * as FileSystem from "effect/FileSystem";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";

import { VcsProcess } from "../vcs/VcsProcess.ts";

export const TASK_WORKTREE_HOOKS_DIR = ".gedcode-hooks";

/**
 * The ceiling an orchestrator worker stage is clamped to when `full-access` is
 * not permitted. `auto-accept-edits` lets the worker make file edits without
 * per-action approval but withholds the unrestricted command surface of
 * `full-access`.
 */
export const WORKER_RUNTIME_MODE_CEILING: RuntimeMode = "auto-accept-edits";

export function resolveWorkerStageRuntimeMode(input: {
  readonly allowFullAccessWorkers: boolean;
}): RuntimeMode {
  return input.allowFullAccessWorkers ? "full-access" : "approval-required";
}

/**
 * Runtime-mode policy for orchestrator worker stages (design §7, §13 risk row 4).
 *
 * A worker runs `full-access` only after a human has explicitly opted in via
 * `allowFullAccessWorkers` (resolved per project, then global default — both
 * default to `false`). With the opt-in off, a requested `full-access` mode is
 * lowered to {@link WORKER_RUNTIME_MODE_CEILING}; other modes pass through.
 */
export function clampWorkerRuntimeMode(input: {
  readonly requested: RuntimeMode;
  readonly allowFullAccessWorkers: boolean;
}): RuntimeMode {
  if (input.allowFullAccessWorkers) {
    return "full-access";
  }
  if (input.requested === "full-access" && !input.allowFullAccessWorkers) {
    return WORKER_RUNTIME_MODE_CEILING;
  }
  return input.requested;
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
  },
);
