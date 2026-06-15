# Plan 009: SSH host-spec fields cannot be interpreted as ssh options (leading-dash guard)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If a
> STOP condition occurs, stop and report. Update this plan's row in
> `plans/README.md` when done unless a reviewer maintains the index.
>
> **Drift check (run first)**: `git diff --stat 65e913c7..HEAD -- packages/ssh/src/command.ts packages/ssh/src/command.test.ts apps/desktop/src/settings/DesktopSavedEnvironments.ts`
> If any changed, re-confirm the excerpts below; on a mismatch treat as a STOP.

> **Note**: This plan is intentionally NOT published as a public GitHub issue —
> it describes a security-hardening change on a public repository. Keep it local.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `65e913c7`, 2026-06-13
- **Issue**: _(intentionally unpublished — security)_

## Why this matters

When the desktop app spawns `ssh`, the destination host spec is assembled as a
**positional** argument with no `--` separator guarding it, and the
alias/hostname/username it is built from are validated only for emptiness — not
for a leading `-`. A saved SSH environment whose alias/hostname/username begins
with `-` is therefore passed to the real `ssh` binary as a positional token that
`ssh` parses as an option, turning attacker-influenced environment config into
local option injection in the spawned ssh invocation. The fix is input
validation at the boundary (reject leading-dash values) plus, where supported, a
safer argument form. This is defensive hardening of a spawn path.

## Current state

- `packages/ssh/src/command.ts`:
  - `buildSshHostSpec` (lines 70–76) builds the destination from
    `alias`/`hostname`/`username` with only a trim + emptiness check — no
    charset or leading-dash rejection:
    ```ts
    export function buildSshHostSpec(target: DesktopSshEnvironmentTarget): string {
      const destination = target.alias.trim() || target.hostname.trim();
      if (destination.length === 0) {
        throw new Error("SSH target is missing its alias/hostname.");
      }
      return target.username ? `${target.username}@${destination}` : destination;
    }
    ```
  - The argument array places `hostSpec` positionally with no `--` before it
    (lines 185–192):
    ```ts
    const args = [
      ...baseSshArgs(target, { batchMode: ... }),
      ...(input.preHostArgs ?? []),
      hostSpec,
      ...(input.remoteCommandArgs ?? []),
    ];
    ```
  - There is an Effect wrapper `buildSshHostSpecEffect` (lines 78–87) that maps
    failures to `SshInvalidTargetError` — the natural place to surface a
    validation failure.
- `apps/desktop/src/settings/DesktopSavedEnvironments.ts` (≈line 42) — the saved
  target schema types `alias`/`hostname` as plain `Schema.String` and
  `username` as `Schema.NullOr(Schema.String)`, with no leading-dash constraint.

## Commands you will need

| Purpose       | Command                                                  | Expected on success         |
| ------------- | -------------------------------------------------------- | --------------------------- |
| Typecheck     | `bun typecheck`                                          | exit 0                      |
| Test (scoped) | `cd packages/ssh && bunx vitest run src/command.test.ts` | all pass                    |
| Test (gate)   | `bun run test`                                           | all pass (never `bun test`) |
| Lint/format   | `bun lint` ; `bun fmt`                                   | exit 0                      |

## Scope

**In scope**:

- `packages/ssh/src/command.ts` — `buildSshHostSpec` validation (and, if it
  cleanly applies, inserting `--` before the host spec in the args array)
- `packages/ssh/src/command.test.ts` — regression tests
- Optionally `apps/desktop/src/settings/DesktopSavedEnvironments.ts` — reject
  leading-dash at the schema boundary (defense in depth)

**Out of scope**:

- `baseSshArgs` flags like `-o ...` / `-p port` — those are intentional fixed
  options, already separate args; do NOT route them through the new validation.
- The remote command args / pre-host args semantics beyond confirming the `--`
  placement does not break legitimate flags.

## Git workflow

- Branch: `advisor/009-ssh-host-spec-guard`
- One commit: `fix(ssh): reject leading-dash host spec fields to prevent ssh option injection`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Reject leading-dash alias/hostname/username in buildSshHostSpec

In `buildSshHostSpec`, after the trim/emptiness check, reject any of
`alias`/`hostname`/`username` (the trimmed values actually used) that begin with
`-`. Throw the same `Error` shape the function already throws (it is converted to
`SshInvalidTargetError` by `buildSshHostSpecEffect`), with a clear message like
`"SSH target fields must not begin with '-'."`. Keep the existing emptiness
behavior.

**Verify**: `bun typecheck` → exit 0.

### Step 2: Add a `--` separator before the host spec (if it does not break flags)

In the args array (lines 185–192), insert `"--"` immediately before `hostSpec`,
so the host spec and `remoteCommandArgs` cannot be parsed as ssh options:
`[...baseSshArgs(...), ...(input.preHostArgs ?? []), "--", hostSpec, ...(input.remoteCommandArgs ?? [])]`.
Confirm against `ssh(1)` usage in this codebase that `preHostArgs` are real ssh
options (which must stay _before_ `--`) and that `remoteCommandArgs` are the
remote command (which correctly go _after_ the host, after `--`). If inserting
`--` would break a legitimate existing invocation in the tests, do Step 1 only
and note Step 2 as deferred in your report.

**Verify**: `cd packages/ssh && bunx vitest run src/command.test.ts` → existing tests still pass (no legitimate invocation regressed).

### Step 3: Regression tests

In `packages/ssh/src/command.test.ts`, add tests:

- `buildSshHostSpec` throws (and `buildSshHostSpecEffect` yields
  `SshInvalidTargetError`) for an alias beginning with `-`, a hostname beginning
  with `-`, and a username beginning with `-`;
- a normal `user@host` target still produces the expected spec;
- `-p`/`-o` base args are unaffected (a normal invocation's arg array still
  contains them in order).
  The test file uses `@effect/vitest` (`import { assert, describe, it } from "@effect/vitest"`)
  with `ChildProcessSpawner` mock handles — match that style; for pure
  `buildSshHostSpec` you can assert synchronously, and for the Effect wrapper use
  the Effect test runner already in the file.

**Verify**: `cd packages/ssh && bunx vitest run src/command.test.ts` → all pass. Revert Step 1, confirm the leading-dash tests fail, re-apply.

### Step 4: Optional schema-boundary hardening

If low-cost, add a `Schema.filter`/refinement on the saved-environment
alias/hostname/username in
`apps/desktop/src/settings/DesktopSavedEnvironments.ts` rejecting leading-dash
values, so bad config is rejected at persistence time too. If the schema
plumbing is non-trivial, skip this — Steps 1–2 are the load-bearing fix.

**Verify**: `bun typecheck` → exit 0.

### Step 5: Full gate

**Verify**: `bun run test` → all pass; `bun typecheck`, `bun lint`,
`bun run fmt:check` → exit 0.

## Test plan

- New tests in `packages/ssh/src/command.test.ts` (Step 3 cases).
- Structural pattern: the existing `command.test.ts` (uses `@effect/vitest`,
  `ChildProcessSpawner.makeHandle`, Effect runner).
- Verification: `bun run test` → all pass.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `buildSshHostSpec` rejects leading-dash alias/hostname/username (a test proves it)
- [ ] Either a `--` separator precedes the host spec in the args array, OR your report documents why Step 2 was deferred
- [ ] Normal `user@host` and `-o`/`-p` base args still work (tests pass)
- [ ] `bun typecheck`, `bun run test`, `bun lint`, `bun run fmt:check` all exit 0
- [ ] Only in-scope files modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- Inserting `--` breaks a legitimate existing ssh invocation in the tests
  (do Step 1 only and report).
- `buildSshHostSpec` or the args array no longer matches the "Current state"
  excerpt.
- You discover host specs can legitimately start with `-` in some supported
  form (e.g. an `ssh://` URI path) — report before rejecting.

## Maintenance notes

- Any new code path that builds an `ssh` (or other CLI) invocation from
  user/config-supplied positional values should route through validated builders
  and use `--` to terminate options. A reviewer should watch for new spawn sites
  that interpolate config into positional args.
- This complements the repo's existing good practice in the git/source-control
  CLIs, which already use arg arrays + `--` separators.
