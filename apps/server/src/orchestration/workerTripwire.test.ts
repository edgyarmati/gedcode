// @effect-diagnostics nodeBuiltinImport:off
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { WORKER_TRIPWIRE_HOOK_SCRIPT } from "./workerTripwire.ts";

// Codex runs the tripwire as a standalone script in the worker's own process
// tree, so these tests feed real payloads to the real script over stdin rather
// than exercising an in-process copy of the rules. Fixture paths are built at
// module scope because `it.each` tables are evaluated during collection.
const fixtureRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gedcode-tripwire-")));
const scriptPath = path.join(fixtureRoot, "workerTripwire.mjs");

fs.writeFileSync(scriptPath, WORKER_TRIPWIRE_HOOK_SCRIPT);

// Decisions are made from path text, so the worktree and the user's work around
// it are named rather than created. They deliberately sit outside temp space:
// temp is shared scratch that the tripwire is required to leave alone.
const fixtureHome = path.join(os.homedir(), "gedcode-tripwire-fixture");
const worktree = path.join(fixtureHome, "worktree");
const outside = path.join(fixtureHome, "notes");

afterAll(() => {
  fs.rmSync(fixtureRoot, { force: true, recursive: true });
});

type Decision = { readonly denied: false } | { readonly denied: true; readonly reason: string };

function evaluatePayload(payload: Readonly<Record<string, unknown>>): Decision {
  const result = spawnSync(process.execPath, [scriptPath], {
    encoding: "utf8",
    input: JSON.stringify(payload),
  });
  // A non-zero exit would reach the worker as a hook failure rather than a
  // decision, so the script must always answer on stdout.
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
  if (result.stdout.trim().length === 0) return { denied: false };
  const parsed = JSON.parse(result.stdout) as {
    readonly hookSpecificOutput?: {
      readonly permissionDecision?: string;
      readonly permissionDecisionReason?: string;
    };
  };
  const output = parsed.hookSpecificOutput;
  if (output?.permissionDecision !== "deny") return { denied: false };
  return { denied: true, reason: output.permissionDecisionReason ?? "" };
}

const patchCall = (patch: string, cwd: string = worktree) =>
  ({
    cwd,
    hook_event_name: "PreToolUse",
    tool_input: { command: patch },
    tool_name: "apply_patch",
  }) as const;

const shellCall = (command: string, cwd: string = worktree) =>
  ({
    cwd,
    hook_event_name: "PreToolUse",
    tool_input: { command },
    tool_name: "Bash",
  }) as const;

describe("worker destructive-target tripwire", () => {
  it("denies deleting an explicit path outside the worker worktree", () => {
    const decision = evaluatePayload(shellCall(`rm -rf ${outside}/keep-me`));

    expect(decision.denied).toBe(true);
  });

  // Package managers routinely prune their own caches, and `uv` in particular is
  // expected to keep working for workers.
  it.each([
    ["uv cache", path.join(os.homedir(), ".cache", "uv", "archive-v0", "abc")],
    ["shared cache root", path.join(os.homedir(), ".cache", "some-tool")],
    ["package manager home", path.join(os.homedir(), ".bun", "install", "cache")],
    ["temp dir", path.join(os.tmpdir(), "build-scratch")],
  ])("allows destructive maintenance of an external %s", (_label, target) => {
    const decision = evaluatePayload(shellCall(`rm -rf ${target}`));

    expect(decision.denied).toBe(false);
  });

  it.each([
    ["single quotes", `rm -rf '${outside}/quoted'`],
    ["double quotes with a space", `rm -rf "${outside}/spaced name"`],
  ])("sees through %s around an external target", (_label, command) => {
    const decision = evaluatePayload(shellCall(command));

    expect(decision.denied).toBe(true);
  });

  it.each([
    ["a tilde", "rm -rf ~/Documents/thesis"],
    ["$HOME", "rm -rf $HOME/Documents/thesis"],
    ["${HOME}", "rm -rf ${HOME}/Documents/thesis"],
  ])("denies destruction of a home path written with %s", (_label, command) => {
    const decision = evaluatePayload(shellCall(command));

    expect(decision.denied).toBe(true);
  });

  it.each([
    ["directory removal", `rmdir ${outside}/dir`],
    ["a destructive move out of place", `mv ${outside}/data ${worktree}/data`],
    ["truncation", `truncate -s 0 ${outside}/service.log`],
    ["an ownership change", `chown -R nobody ${outside}/tree`],
    ["a mode change", `chmod -R 777 ${outside}/tree`],
    ["shredding", `shred -u ${outside}/secret.key`],
    ["a raw device write", `dd if=/dev/zero of=${outside}/disk.img`],
  ])("denies %s targeting a path outside the worktree", (_label, command) => {
    const decision = evaluatePayload(shellCall(command));

    expect(decision.denied).toBe(true);
  });

  it.each([
    ["after a directory change", `cd ${outside} && rm -rf data`],
    ["after another command", `echo starting; rm -rf ${outside}/data`],
    ["behind a privilege wrapper", `sudo rm -rf ${outside}/data`],
    ["behind an env wrapper", `env FORCE=1 rm -rf ${outside}/data`],
    ["inside a nested shell", `sh -c "rm -rf ${outside}/data"`],
  ])("denies destruction %s", (_label, command) => {
    const decision = evaluatePayload(shellCall(command));

    expect(decision.denied).toBe(true);
  });

  it.each([
    ["a spaced redirect", `echo broken > ${outside}/config.yaml`],
    ["an attached redirect", `echo broken >${outside}/config.yaml`],
    ["a descriptor redirect", `some-tool 1> ${outside}/config.yaml`],
  ])("denies raw overwrite of an external file through %s", (_label, command) => {
    const decision = evaluatePayload(shellCall(command));

    expect(decision.denied).toBe(true);
  });

  it.each([
    ["deletes", `*** Begin Patch\n*** Delete File: ${outside}/notes.md\n*** End Patch\n`],
    [
      "rewrites",
      `*** Begin Patch\n*** Update File: ${outside}/notes.md\n@@\n-before\n+after\n*** End Patch\n`,
    ],
    ["adds", `*** Begin Patch\n*** Add File: ${outside}/new.md\n+hello\n*** End Patch\n`],
    [
      "moves onto",
      `*** Begin Patch\n*** Update File: draft.md\n*** Move to: ${outside}/draft.md\n*** End Patch\n`,
    ],
  ])("denies a patch that %s a file outside the worktree", (_label, patch) => {
    const decision = evaluatePayload(patchCall(patch));

    expect(decision.denied).toBe(true);
  });

  // A worker can reach real work outside its worktree through a link that looks
  // local, so decisions follow the link rather than the path text.
  it("denies destruction that escapes the worktree through a symlink", () => {
    const linkedWorktree = path.join(fixtureRoot, "linked-worktree");
    fs.mkdirSync(linkedWorktree, { recursive: true });
    const escape = path.join(linkedWorktree, "elsewhere");
    fs.symlinkSync(process.cwd(), escape);

    const decision = evaluatePayload(shellCall(`rm -rf elsewhere/package.json`, linkedWorktree));

    expect(decision.denied).toBe(true);
  });

  it("allows a patch that stays inside the worktree", () => {
    const decision = evaluatePayload(
      patchCall(
        `*** Begin Patch\n*** Update File: src/index.ts\n@@\n-before\n+after\n*** End Patch\n`,
      ),
    );

    expect(decision.denied).toBe(false);
  });

  it.each([
    ["a relative delete", "rm -rf build"],
    ["an absolute delete", `rm -rf ${worktree}/dist`],
    ["a normalized path that stays inside", "rm -rf src/../dist"],
    ["truncation", "truncate -s 0 logs/app.log"],
    ["a rename", "mv old-name.ts new-name.ts"],
    ["a mode change", "chmod +x scripts/build.sh"],
    ["an overwrite", "echo generated > src/generated.ts"],
    ["a build that cleans as it goes", "rm -rf dist && bun run build"],
  ])("allows in-worktree %s", (_label, command) => {
    const decision = evaluatePayload(shellCall(command));

    expect(decision.denied).toBe(false);
  });

  it.each([
    ["reading an external file", `cat ${outside}/notes.md`],
    ["listing an external directory", `ls -la ${outside}`],
    ["appending to an external file", `echo progress >> ${outside}/run.log`],
    ["running git elsewhere", `git -C ${outside} status`],
    ["installing packages", "bun install"],
  ])("allows %s", (_label, command) => {
    const decision = evaluatePayload(shellCall(command));

    expect(decision.denied).toBe(false);
  });

  // Agents write scripts, not one-liners: a newline separates one command from
  // the next exactly like `;` does. Reading it as plain whitespace hid every
  // command after the first behind the first line's harmless verb.
  it.each([
    ["a leading echo", `echo starting\nrm -rf ${outside}/keep`],
    ["a leading assignment", `export FORCE=1\nrm -rf ${outside}/keep`],
    ["a shell options header", `set -euo pipefail\nrm -rf ${outside}/keep`],
    ["carriage returns", `echo starting\r\nrm -rf ${outside}/keep`],
    ["a trailing comment line", `rm -rf ${outside}/keep\necho done`],
  ])("denies destruction on a later line after %s", (_label, command) => {
    const decision = evaluatePayload(shellCall(command));

    expect(decision.denied).toBe(true);
  });

  it("allows a multi-line script that stays inside the worktree", () => {
    const decision = evaluatePayload(
      shellCall("set -euo pipefail\nrm -rf dist\nbun run build > build.log"),
    );

    expect(decision.denied).toBe(false);
  });

  // The shell tool takes a per-call working directory, so a relative path is not
  // relative to the session cwd. Judging it against the worktree let a plain
  // `rm -rf .` delete a sibling checkout.
  it.each([
    ["a current-directory delete", "rm -rf ."],
    ["a bare relative delete", "rm -f keep"],
    ["a relative redirect", "echo broken > config.yaml"],
  ])("denies %s issued with an external tool workdir", (_label, command) => {
    const decision = evaluatePayload({
      ...shellCall(command),
      tool_input: { command, workdir: outside },
    });

    expect(decision.denied).toBe(true);
  });

  it("allows a relative delete issued with a workdir inside the worktree", () => {
    const decision = evaluatePayload({
      ...shellCall("rm -rf build"),
      tool_input: { command: "rm -rf build", workdir: `${worktree}/packages/app` },
    });

    expect(decision.denied).toBe(false);
  });

  // Discarding output is how agents keep a command quiet. These are not files and
  // destroying them is not possible, so treating them as external targets would
  // refuse ordinary build and probe commands.
  it.each([
    ["a discarded stdout redirect", "make >/dev/null"],
    ["a discarded stderr redirect", "bun run build 2>/dev/null"],
    ["a spaced discard", "git diff --quiet > /dev/null"],
    ["a capability probe", "command -v uv >/dev/null 2>&1"],
    ["a terminal redirect", "printf progress > /dev/tty"],
    ["a descriptor redirect", "echo hi > /dev/fd/3"],
    ["a device sink for dd", "dd if=large.bin of=/dev/null"],
    ["a mode change on a pseudo device", "chmod 666 /dev/null"],
  ])("allows %s", (_label, command) => {
    const decision = evaluatePayload(shellCall(command));

    expect(decision.denied).toBe(false);
  });

  // A real block device is not a discard sink; the allowance is for the standard
  // pseudo devices only.
  it("still denies writing over a real device", () => {
    const decision = evaluatePayload(shellCall("dd if=/dev/zero of=/dev/disk0"));

    expect(decision.denied).toBe(true);
  });

  it("denies once with a single-line reason naming the target and the worktree", () => {
    const decision = evaluatePayload(shellCall(`rm -rf ${outside}`));

    if (!decision.denied) throw new Error("expected the external delete to be denied");
    expect(decision.reason.split("\n")).toHaveLength(1);
    expect(decision.reason).toContain(outside);
    expect(decision.reason).toContain(worktree);
  });
});
