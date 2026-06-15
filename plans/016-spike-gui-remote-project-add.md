# Plan 016 [SPIKE]: Scope and close the GUI remote-project-add gap (REMOTE.md says "coming soon")

> **Executor instructions**: This is a DESIGN/SCOPING SPIKE that may include a
> small, well-bounded implementation if the missing piece turns out to be tiny
> and security-safe. Investigate first; only implement if Step 3's gate passes.
> If a STOP condition occurs, stop and report. Update this plan's row in
> `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 65e913c7..HEAD -- apps/web/src/components/CommandPalette.tsx REMOTE.md`
> If either changed, re-confirm the excerpts below.

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: MED (touches remote filesystem browse — a security-sensitive path)
- **Depends on**: none (but read plan 010's Origin/auth context if implementing)
- **Category**: direction
- **Planned at**: commit `65e913c7`, 2026-06-13
- **Issue**: https://github.com/edgyarmati/gedcode/issues/20

## Why this matters

`REMOTE.md` tells users "The GUIs do not currently support adding projects on
remote environments... Full GUI support for remote project management is coming
soon." But the code is closer to done than that implies: a remote clone-and-add
flow and a per-environment `project.create` dispatch already exist. This is a
documented capability gap where the remaining work may be small (likely the
"add an existing remote directory" browse case). Closing it lets remote users
manage projects from the GUI instead of shelling into `gedcode project`. The
spike's job is to pin down exactly which sub-case is missing and either close it
(if small and safe) or scope it.

## Current state (evidence)

- **The "coming soon" note** — `REMOTE.md` (near line 99):
  > The GUIs do not currently support adding projects on remote environments.
  > For now, use `gedcode project ...` on the server machine instead.
  > Full GUI support for remote project management is coming soon.
- **Remote clone-and-add already exists** —
  `apps/web/src/components/CommandPalette.tsx:727`:
  ```ts
  const startAddProjectClone = useCallback(
    (environmentId: EnvironmentId, source: AddProjectRemoteSource): void => {
      setAddProjectEnvironmentId(environmentId);
      setAddProjectCloneFlow({ step: "repository", environmentId, source });
      // ...keyed by environmentId, works for any environment...
  ```
- **Per-environment project.create dispatch exists** — `CommandPalette.tsx:1091`
  region dispatches `project.create` over the environment API (works for any
  environment, not just local).
- **Per-environment base directory is read** — `CommandPalette.tsx:470-483`:
  ```ts
  const environmentSettings =
    environmentId && primaryEnvironmentId && environmentId === primaryEnvironmentId
      ? settings
      : environmentId
        ? savedEnvironmentRuntimeById[environmentId]?.serverConfig?.settings
        : null;
  const baseDirectory = environmentSettings?.addProjectBaseDirectory?.trim() ?? "";
  // ...seeds the browse/clone path per environment...
  ```
- **The likely-missing piece**: adding an _existing_ directory on a remote
  environment requires browsing the remote filesystem. The filesystem-browse
  endpoint exists server-side but its remote/auth scoping is itself a security
  finding (see the audit). Confirm whether `startAddProjectBrowse` (or its
  equivalent) is wired for non-local environments — that is the suspected gap.

## Commands you will need

| Purpose            | Command                                                                                                                | Expected on success               |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Map add-project    | `git grep -n "AddProject\|addProject\|startAddProject\|project.create\|filesystemBrowse" apps/web/src apps/server/src` | the full add-project surface      |
| Find remote browse | `git grep -n "filesystemBrowse\|browse(" apps/web/src apps/server/src/workspace`                                       | the browse path + its env scoping |
| Typecheck/test     | `bun typecheck` ; `bun run test`                                                                                       | exit 0 / pass (if implementing)   |

## Scope

**In scope** (spike):

- A short scoping note: `docs/decisions/2026-06-remote-project-add.md` (create
  `docs/decisions/` if absent) identifying exactly which sub-case is missing.
- OPTIONALLY, if Step 3's gate passes: the small wiring to enable the missing
  sub-case for remote environments, + a doc update removing the stale REMOTE.md
  note.

**Out of scope**:

- The remote filesystem-browse _security scoping_ itself (root containment /
  network-mode restriction) — that is a separate security finding/plan; do not
  loosen or harden browse here, just determine whether it is wired for remote add.
- Any change to local project add.

## Git workflow

- Branch: `advisor/016-spike-remote-project-add`
- Commit: `docs: scope remote project add (spike)` (+ implementation commit only
  if Step 3 gate passes)
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Inventory the add-project flows and which support remote

Using the greps, document the add-project entry points (clone, add-existing,
publish-local) and for each whether it already accepts a non-local
`environmentId` end-to-end (web dispatch → server handler → execution on the
remote). Pin the exact gap.

**Verify**: the doc states, with file:line, which sub-case(s) work for remote
today and which do not.

### Step 2: Verify the gap is real (not just stale docs)

It is possible the GUI already supports remote add fully and `REMOTE.md` is
simply stale (this happened with 5 of 6 `TODO.md` items — see plan 002). If the
clone flow and project.create both work for remote and the only missing piece is
"add existing directory" browse, say so. If _everything_ works for remote, the
correct fix is docs-only: remove the "coming soon" note.

**Verify**: the doc clearly concludes one of: (a) fully works → docs-only fix;
(b) only add-existing-remote-browse missing → small wiring; (c) larger gap →
scope a follow-up build plan.

### Step 3: Decision gate

- If (a): update `REMOTE.md` to remove the stale "coming soon" note; run
  `bun run fmt:check`. Done.
- If (b) AND the remote browse endpoint already exists and is reachable for the
  environment (no NEW security surface introduced — you are reusing an existing,
  already-exposed capability): wire `startAddProjectBrowse` (or equivalent) for
  non-local environments, respecting the same denied-directory/auth guards the
  existing browse path uses. Then update REMOTE.md. Add/extend a focused test.
- If (c) OR wiring (b) would expose a new/unguarded remote filesystem surface:
  STOP — write the scoping doc and hand off; do not introduce remote browse
  exposure as a side effect of a convenience feature.

**Verify**: you can name which branch (a/b/c) you took and why, in the doc.

### Step 4 (only if you implemented b): verify

**Verify**: `bun typecheck` → exit 0; `bun run test` → all pass; `bun lint` and
`bun run fmt:check` → exit 0. The remote add-existing flow reuses the existing
browse guards (confirm by reading, not just running).

## Test plan

- (a)/(c): no code tests; the deliverable is the scoping doc (and a docs edit for
  (a)).
- (b): a focused test that the add-existing flow accepts a non-local
  `environmentId` and routes browse through the existing guarded path. Model
  after existing CommandPalette / add-project tests if present
  (`git grep -ln "AddProject\|addProject" apps/web/src/**/*.test.*`).

## Done criteria

- [ ] `docs/decisions/2026-06-remote-project-add.md` exists and concludes (a), (b), or (c) with file:line evidence
- [ ] If (a) or (b): the stale REMOTE.md "coming soon" note is removed
- [ ] If (b): the remote add-existing flow reuses existing browse guards (no new unguarded remote filesystem surface), and tests pass
- [ ] If implemented: `bun typecheck`, `bun run test`, `bun lint`, `bun run fmt:check` all exit 0
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- Closing the gap would require exposing remote filesystem browse beyond what is
  already reachable — STOP; that is a security decision, not a convenience tweak.
  Hand off to the security-scoping work for the browse endpoint.
- The gap is larger than "wire one existing flow for remote" (e.g. the server
  has no remote-execution path for project.create) — write the scoping doc and
  stop.
- The add-project code no longer matches the "Current state" excerpt.

## Maintenance notes

- Remote filesystem browse is a security-sensitive surface (it appears as its own
  finding in the audit: unbounded directory enumeration for paired clients). Any
  remote-add work must respect the same trust boundary; a reviewer should
  scrutinize that this feature does not widen it.
- If the conclusion is "docs were just stale", that is a perfectly good outcome —
  the cheapest fix is deleting the wrong sentence.
