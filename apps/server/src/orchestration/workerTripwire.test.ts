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

function evaluatePayload(
  payload: Readonly<Record<string, unknown>>,
  env: Readonly<Record<string, string>> = {},
): Decision {
  const result = spawnSync(process.execPath, [scriptPath], {
    encoding: "utf8",
    env: { ...process.env, ...env },
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

  // A `cd` inside a subshell or a pipeline stage does not survive it, so reading
  // it as a lasting change refused the worker permission to clean its own build
  // output — naming a directory the command never touched.
  it.each([
    ["a subshell", `(cd ${outside} && ls) ; rm -rf dist`],
    ["a pushd/popd pair", `pushd ${outside} ; popd ; rm -rf dist`],
    ["a pipeline stage", `cd ${outside} | true ; rm -rf dist`],
    ["a subshell that stays open", `(cd ${outside}) ; rm -rf dist`],
  ])("allows in-worktree destruction after %s changed directory", (_label, command) => {
    const decision = evaluatePayload(shellCall(command));

    expect(decision.denied).toBe(false);
  });

  it("still denies destruction after a directory change that does persist", () => {
    const decision = evaluatePayload(shellCall(`cd ${outside} ; rm -rf data`));

    expect(decision.denied).toBe(true);
  });

  it("denies destruction inside a subshell that changed directory itself", () => {
    const decision = evaluatePayload(shellCall(`(cd ${outside} && rm -rf data)`));

    expect(decision.denied).toBe(true);
  });

  // `bash -lc` is the most common way an agent wraps a shell command, and the
  // nested-shell recursion only matched a standalone `-c`.
  it.each([
    ["a login shell", `bash -lc "rm -rf ${outside}/keep"`],
    ["a clustered trace flag", `sh -cx "rm -rf ${outside}/keep"`],
    ["an interactive zsh", `zsh -ic "rm -rf ${outside}/keep"`],
    ["a separated flag", `bash -x -c "rm -rf ${outside}/keep"`],
    ["a long option first", `bash --noprofile -c "rm -rf ${outside}/keep"`],
  ])("denies destruction inside %s", (_label, command) => {
    const decision = evaluatePayload(shellCall(command));

    expect(decision.denied).toBe(true);
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

  // Deleting is not the only way to destroy someone's work: a copy, a sync, or a
  // redirect-by-another-name overwrites just as thoroughly, and only `rm`-shaped
  // verbs were being checked.
  it.each([
    ["a copy onto an external file", `cp report.pdf ${outside}/report.pdf`],
    ["a recursive copy into external space", `cp -R dist ${outside}/site`],
    ["a copy into an external target directory", `cp -t ${outside} dist/index.html`],
    ["an install onto an external path", `install -m 644 build/app ${outside}/app`],
    ["a link planted outside the worktree", `ln -sf ${worktree}/dist ${outside}/dist`],
    ["a sync into external space", `rsync -a dist/ ${outside}/site/`],
    ["a mirroring sync that prunes", `rsync -a --delete dist/ ${outside}/site/`],
    ["a tee onto an external file", `echo broken | tee ${outside}/config.yaml`],
  ])("denies %s", (_label, command) => {
    const decision = evaluatePayload(shellCall(command));

    expect(decision.denied).toBe(true);
  });

  // A redirection is not an operand. Agents silence commands constantly, and the
  // destination of a copy or sync is its last operand, so a trailing `>/dev/null`
  // was being read as the destination and the real one went unjudged.
  it.each([
    ["a quieted copy", `cp -r dist ${outside}/dist > /dev/null`],
    ["a copy with only stderr quieted", `cp -r dist ${outside}/dist 2>/dev/null`],
    ["a copy folding stderr into stdout", `cp -r dist ${outside}/dist 2>&1`],
    ["a fully quieted sync", `rsync -a dist/ ${outside}/site/ >/dev/null 2>&1`],
    ["a quieted install", `install -m 644 build/app ${outside}/app >/dev/null`],
    ["a quieted link", `ln -sf ${worktree}/dist ${outside}/dist 2>/dev/null`],
    ["a copy logging to the worktree", `cp -r dist ${outside}/dist >> copy.log`],
  ])("denies %s onto an external destination", (_label, command) => {
    const decision = evaluatePayload(shellCall(command));

    expect(decision.denied).toBe(true);
  });

  // The redirect target is still judged in its own right, and a descriptor bound
  // to it does not hide it.
  it.each([
    ["a stderr redirect onto an external file", `some-tool 2> ${outside}/errors.log`],
    ["an attached stderr redirect", `some-tool 2>${outside}/errors.log`],
  ])("denies %s", (_label, command) => {
    const decision = evaluatePayload(shellCall(command));

    expect(decision.denied).toBe(true);
  });

  // Reading the host is fine; only the written side is judged. Denying sources
  // would refuse ordinary vendoring and inspection.
  it.each([
    ["a quieted copy inside the worktree", "cp -r src build >/dev/null 2>&1"],
    ["a quieted sync inside the worktree", "rsync -a src/ build/ > /dev/null"],
    ["a copy out of external space into the worktree", `cp -R ${outside}/tree src/vendor`],
    ["a copy of many files into a worktree directory", "cp a.ts b.ts src/"],
    ["a sync out of external space", `rsync -a ${outside}/assets/ public/`],
    ["a link created in the worktree", `ln -sf ${outside}/shared shared`],
    ["a single-operand link", `ln -s ${outside}/shared`],
    ["a tee into a worktree file", "echo generated | tee src/generated.ts"],
  ])("allows %s", (_label, command) => {
    const decision = evaluatePayload(shellCall(command));

    expect(decision.denied).toBe(false);
  });

  // Tools that destroy only in one mode: the flag decides whether the operand is
  // read or rewritten, so the verb alone cannot answer it.
  it.each([
    ["an in-place edit", `sed -i '' 's/a/b/' ${outside}/config.yaml`],
    ["an in-place edit with a backup suffix", `sed -i.bak -e 's/a/b/' ${outside}/config.yaml`],
    ["a clustered in-place edit", `sed -Ei 's/a/b/' ${outside}/config.yaml`],
    ["a long in-place edit", `sed --in-place 's/a/b/' ${outside}/config.yaml`],
    ["a find that deletes", `find ${outside} -name '*.log' -delete`],
    ["a find that shells out to rm", `find ${outside} -type f -exec rm {} +`],
    ["a git clean in another checkout", `git -C ${outside} clean -fdx`],
    ["a git clean after moving there", `cd ${outside} && git clean -fdx`],
    ["a git rm in another checkout", `git -C ${outside} rm -r data`],
    [
      "an apply_patch run as a shell command",
      `apply_patch <<'EOF'\n*** Begin Patch\n*** Delete File: ${outside}/notes.md\n*** End Patch\nEOF`,
    ],
  ])("denies %s outside the worktree", (_label, command) => {
    const decision = evaluatePayload(shellCall(command));

    expect(decision.denied).toBe(true);
  });

  it.each([
    ["a read-only sed", `sed 's/a/b/' ${outside}/config.yaml > summary.txt`],
    ["a printing sed", `sed -n '1,5p' ${outside}/service.log`],
    ["a searching find", `find ${outside} -name '*.log'`],
    ["a find that only prints", `find ${outside} -type f -print0`],
    ["an in-worktree in-place edit", "sed -i '' 's/a/b/' src/index.ts"],
    ["an in-worktree find that deletes", "find dist -name '*.map' -delete"],
    ["an in-worktree git clean", "git clean -fdx"],
    ["a git log elsewhere", `git -C ${outside} log --oneline -5`],
    [
      "an apply_patch run as a shell command inside the worktree",
      `apply_patch <<'EOF'\n*** Begin Patch\n*** Update File: src/index.ts\n@@\n-a\n+b\n*** End Patch\nEOF`,
    ],
  ])("allows %s", (_label, command) => {
    const decision = evaluatePayload(shellCall(command));

    expect(decision.denied).toBe(false);
  });

  // A flag's inline value is an option, not a target. Reading every `key=value`
  // word as a path invented targets the command only ever reads from.
  it.each([
    ["an ownership reference", "chown --reference=/etc/passwd src/app"],
    ["a mode reference", `chmod --reference=${outside}/template src/app`],
    ["a size reference", `truncate --reference=${outside}/template logs/app.log`],
  ])("allows %s while writing inside the worktree", (_label, command) => {
    const decision = evaluatePayload(shellCall(command));

    expect(decision.denied).toBe(false);
  });

  it.each([
    ["a raw device write target", `dd if=/dev/urandom of=${outside}/disk.img`],
    ["an explicit size flag", `truncate --size=0 ${outside}/service.log`],
  ])("still denies %s outside the worktree", (_label, command) => {
    const decision = evaluatePayload(shellCall(command));

    expect(decision.denied).toBe(true);
  });

  // The shell expands variables before the command runs, so a target hidden in
  // one is as explicit as a literal path.
  it.each([
    ["a bare variable", "rm -rf $PROJECT_ROOT/data"],
    ["a braced variable", "rm -rf ${PROJECT_ROOT}/data"],
    ["a variable in a redirect", "echo broken > $PROJECT_ROOT/config.yaml"],
  ])("denies destruction named through %s pointing outside", (_label, command) => {
    const decision = evaluatePayload(shellCall(command), { PROJECT_ROOT: outside });

    expect(decision.denied).toBe(true);
  });

  it("allows destruction named through a variable pointing inside the worktree", () => {
    const decision = evaluatePayload(shellCall("rm -rf $BUILD_DIR/artifacts"), {
      BUILD_DIR: `${worktree}/build`,
    });

    expect(decision.denied).toBe(false);
  });

  // Workers inherit the host environment including credentials, and the
  // maintenance allowlist opens `~/.config` and `~/.local` wide. Losing an SSH key
  // or a signed-in CLI's state is not ordinary cache pruning.
  it.each([
    ["ssh keys", "rm -rf ~/.ssh"],
    ["an aws credentials file", "rm -f ~/.aws/credentials"],
    ["a netrc", "rm ~/.netrc"],
    ["a global git config", "echo broken > ~/.gitconfig"],
    ["a signed-in gh cli", "rm -rf ~/.config/gh"],
    ["git config under XDG", "rm -rf ~/.config/git"],
    ["gcloud state", "rm -rf ~/.config/gcloud"],
    ["keyrings under .local", "rm -rf ~/.local/share/keyrings"],
    ["codex home", "rm -rf ~/.codex"],
    ["claude home", "rm -rf ~/.claude"],
    ["kube config", "rm -rf ~/.kube"],
    ["docker credentials", "rm -f ~/.docker/config.json"],
    ["gnupg keys", "rm -rf ~/.gnupg"],
    ["an ancestor of protected state", "rm -rf ~/.config"],
  ])("denies destroying %s", (_label, command) => {
    const decision = evaluatePayload(shellCall(command));

    expect(decision.denied).toBe(true);
  });

  it("still allows pruning an ordinary tool directory under the same roots", () => {
    const decision = evaluatePayload(shellCall("rm -rf ~/.config/some-tool/cache"));

    expect(decision.denied).toBe(false);
  });

  it("says why a credential path was refused rather than blaming the worktree", () => {
    const decision = evaluatePayload(shellCall("rm -rf ~/.ssh"));

    if (!decision.denied) throw new Error("expected the credential delete to be denied");
    expect(decision.reason.split("\n")).toHaveLength(1);
    expect(decision.reason).toContain(path.join(os.homedir(), ".ssh"));
    expect(decision.reason).toContain("credential");
  });

  it("denies once with a single-line reason naming the target and the worktree", () => {
    const decision = evaluatePayload(shellCall(`rm -rf ${outside}`));

    if (!decision.denied) throw new Error("expected the external delete to be denied");
    expect(decision.reason.split("\n")).toHaveLength(1);
    expect(decision.reason).toContain(outside);
    expect(decision.reason).toContain(worktree);
  });
});
