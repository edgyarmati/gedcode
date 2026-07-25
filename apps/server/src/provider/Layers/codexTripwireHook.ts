// Codex-side plumbing for the worker destructive-target tripwire.
//
// The rules themselves live in `orchestration/workerTripwire.ts`; this module
// only knows how to hand that script to `codex app-server` as a narrowly
// trusted `PreToolUse` hook.

import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import type * as CodexErrors from "effect-codex-app-server/errors";
import type * as EffectCodexSchema from "effect-codex-app-server/schema";

import { WORKER_TRIPWIRE_HOOK_SCRIPT } from "../../orchestration/workerTripwire.ts";

const TRIPWIRE_SCRIPT_FILENAME = "workerTripwire.mjs";

// The script is written on every resolve rather than only when missing: an
// upgraded server must not leave an older copy of the rules on disk, and the
// content hash Codex trusts covers the command, not the file.
export const materializeTripwireScript = Effect.fn("materializeTripwireScript")(function* (
  directory: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const scriptPath = path.join(directory, TRIPWIRE_SCRIPT_FILENAME);
  yield* fs.makeDirectory(directory, { recursive: true });
  yield* fs.writeFileString(scriptPath, WORKER_TRIPWIRE_HOOK_SCRIPT);
  return scriptPath;
});

export interface TripwireHookTrust {
  readonly key: string;
  readonly trustedHash: string;
}

// Codex derives a hook's content hash itself and reports it through `hooks/list`;
// it is not reproducible from the hook definition, so the hash has to be read
// back from a probe rather than computed here or pinned as a constant.
export const findTripwireHookTrust = (
  response: EffectCodexSchema.V2HooksListResponse,
): TripwireHookTrust | undefined => {
  for (const entry of response.data) {
    for (const hook of entry.hooks) {
      if (hook.source !== "sessionFlags" || hook.eventName !== "preToolUse") continue;
      return { key: hook.key, trustedHash: hook.currentHash };
    }
  }
  return undefined;
};

// Codex executes hook commands through a shell, so the paths are quoted here.
// `ELECTRON_RUN_AS_NODE` is inert under plain node and makes the desktop build's
// Electron binary behave as node, which is the only interpreter guaranteed to be
// present wherever the server runs.
export const buildTripwireHookCommand = (input: {
  readonly nodePath: string;
  readonly scriptPath: string;
}): string => `ELECTRON_RUN_AS_NODE=1 "${input.nodePath}" "${input.scriptPath}"`;

// A single `PreToolUse` hook for every tool. TOML basic strings take the same
// quote and backslash escapes as JSON, so the command can be embedded directly.
export const buildTripwireHookDefinitionOverride = (command: string): string =>
  `hooks.PreToolUse=[{ matcher = "*", hooks = [{ type = "command", command = ${JSON.stringify(command)} }] }]`;

// Trust is scoped to one hook identity and one content hash for one invocation.
// Nothing is written to the user's Codex home, and no process-wide trust switch
// is involved, so unrelated hooks stay untrusted.
export const buildTripwireHookTrustOverride = (input: {
  readonly key: string;
  readonly trustedHash: string;
}): string =>
  `hooks.state={ ${JSON.stringify(input.key)} = { trusted_hash = ${JSON.stringify(input.trustedHash)}, enabled = true } }`;

// The hook has to be defined before Codex can hash it, and it has to be trusted
// by that hash before it will run, so a throwaway `app-server` is asked to list
// the hook first and the answer is fed into the session that actually runs.
export const resolveTripwireHookOverrides = Effect.fn("resolveTripwireHookOverrides")(
  function* (input: {
    readonly hookCommand: string;
    readonly probe: (
      definitionOverride: string,
    ) => Effect.Effect<EffectCodexSchema.V2HooksListResponse, CodexErrors.CodexAppServerError>;
  }) {
    const definitionOverride = buildTripwireHookDefinitionOverride(input.hookCommand);
    const listed = yield* input.probe(definitionOverride).pipe(
      Effect.catchCause((cause) =>
        // Workers are unattended and the tripwire is accident prevention, not a
        // security boundary, so a failed probe costs coverage rather than the run.
        Effect.logWarning(
          "Codex hook probe failed; worker starts without the destructive-target tripwire.",
          { cause },
        ).pipe(Effect.as(undefined)),
      ),
    );
    const trust = listed === undefined ? undefined : findTripwireHookTrust(listed);
    if (trust === undefined) {
      return [] as ReadonlyArray<string>;
    }
    return [definitionOverride, buildTripwireHookTrustOverride(trust)] as ReadonlyArray<string>;
  },
);

// `-c` overrides are global flags, so they have to precede the subcommand.
export const buildCodexAppServerArgs = (
  configOverrides: ReadonlyArray<string>,
): ReadonlyArray<string> => [
  ...configOverrides.flatMap((override) => ["-c", override]),
  "app-server",
];
