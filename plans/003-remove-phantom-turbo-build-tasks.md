# Plan 003: Turbo build wiring matches reality for source-only workspace packages

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If a
> STOP condition occurs, stop and report. Update this plan's row in
> `plans/README.md` when done unless a reviewer maintains the index.
>
> **Drift check (run first)**: `git diff --stat 65e913c7..HEAD -- turbo.json package.json packages/contracts/package.json packages/shared/package.json packages/client-runtime/package.json packages/ged-workflow/package.json packages/tailscale/package.json`
> If any changed, re-confirm the excerpts below; on a mismatch treat as a STOP.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `65e913c7`, 2026-06-13
- **Issue**: https://github.com/edgyarmati/gedcode/issues/10

## Why this matters

Several internal workspace libraries (`@t3tools/contracts`, `@t3tools/shared`,
`client-runtime`, `ged-workflow`, `tailscale`) are consumed by source `.ts`
subpath imports and have **no `build` script**, yet `turbo.json` declares a
generic `build` task with `dist/**` outputs for every package, their
`package.json`s declare `files: ["dist"]`, and the root `build:contracts`
script runs a turbo build that resolves to no command. The result: turbo
schedules phantom build tasks on every `dev`/`test` run (`dev` and `test`
`dependsOn` chains include these no-op builds), `build:contracts` is a silent
no-op, and the `files: ["dist"]` + `dist` exports are misleading config that
would publish an empty package if any of these were ever made non-private.
This is cheap to fix and removes a real source of "what actually builds here?"
confusion for both humans and agents.

## Current state

- `packages/contracts/package.json` — scripts are only `typecheck` + `test`
  (no `build`), but `"files": ["dist"]` is declared and `exports` point at raw
  TS (`"./src/index.ts"`):
  ```json
  "files": ["dist"],
  "exports": {
    ".": { "types": "./src/index.ts", "import": "./src/index.ts" },
    "./settings": { "types": "./src/settings.ts", "import": "./src/settings.ts" }
  },
  "scripts": { "typecheck": "tsgo --noEmit", "test": "vitest run" }
  ```
- `turbo.json` declares a single generic `build` task for all packages, plus
  `dev`/`test` chains that depend on builds:
  ```json
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**", "dist-electron/**"] },
    "dev":   { "dependsOn": ["@t3tools/contracts#build"], "cache": false, "persistent": true },
    "typecheck": { "dependsOn": ["^typecheck"], "outputs": [], "cache": false },
    "test":  { "dependsOn": ["^build"], "cache": false, "outputs": [] }
  }
  ```
- `package.json` (root) — `"build:contracts": "turbo run build --filter=@t3tools/contracts"`.
  Because `@t3tools/contracts` has no `build` script, this command does nothing.
- For confirmation, run: `turbo run build --filter=@t3tools/contracts --dry-run`
  → the task for `@t3tools/contracts#build` shows command `<NONEXISTENT>`.
- Which packages DO build: `apps/server`, `apps/web`, `apps/desktop` (and any
  package with a real `build`/`tsdown` script). Check each `package.json`'s
  `scripts.build` before changing anything.

## Commands you will need

| Purpose            | Command                                                 | Expected on success                        |
| ------------------ | ------------------------------------------------------- | ------------------------------------------ |
| Inspect build plan | `turbo run build --dry-run=json`                        | JSON; note which tasks are `<NONEXISTENT>` |
| Inspect contracts  | `turbo run build --filter=@t3tools/contracts --dry-run` | shows `<NONEXISTENT>` command              |
| Typecheck          | `bun typecheck`                                         | exit 0                                     |
| Test               | `bun run test`                                          | all pass (never `bun test`)                |
| Build (apps)       | `bun run build`                                         | exit 0; apps still build                   |
| Format / lint      | `bun fmt` ; `bun lint`                                  | exit 0                                     |

## Scope

**In scope**:

- `turbo.json`
- `package.json` (root) — only the `build:contracts` script line
- The `package.json` of each source-only library that has NO `build` script:
  `packages/contracts`, `packages/shared`, `packages/client-runtime`,
  `packages/ged-workflow`, `packages/tailscale` (verify each in Step 1)

**Out of scope**:

- `apps/server`, `apps/web`, `apps/desktop` package.jsons — they have real
  builds; do not change their build tasks.
- Any `exports`/`types`/`import` _paths_ — they correctly point at `src/*.ts`;
  only remove the misleading `files: ["dist"]` and dead build wiring.
- Do NOT add new build scripts. The repo's choice is source-`.ts` consumption;
  this plan removes dead wiring, it does not introduce a build step.

## Git workflow

- Branch: `advisor/003-phantom-turbo-build`
- One commit: `chore: remove phantom turbo build tasks from source-only packages`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Enumerate which packages have no build script

Run, for each workspace package, a check for a `build` script:

```
for p in packages/*/package.json apps/*/package.json; do
  echo "== $p =="; node -e "const s=require('./'+process.argv[1]).scripts||{}; console.log(s.build?('build: '+s.build):'NO build')" "$p"
done
```

Record the set with `NO build`. Those are your in-scope library package.jsons.

**Verify**: the list includes `packages/contracts` and excludes `apps/server`,
`apps/web`, `apps/desktop`.

### Step 2: Scope the turbo `build` task to packages that actually build

In `turbo.json`, prevent turbo from scheduling phantom builds. Preferred
approach (minimal, turbo-idiomatic): the generic `build` task can remain, since
turbo simply skips packages with no `build` script — but the explicit
`dev.dependsOn: ["@t3tools/contracts#build"]` references a non-existent task and
should be removed, and `test.dependsOn: ["^build"]` pulls phantom builds.

Make these edits:

- Remove `"@t3tools/contracts#build"` from `dev.dependsOn` (contracts has no
  build; `dev` already depends on contracts being importable from source).
- Change `test.dependsOn` from `["^build"]` to `[]` **only if** confirming that
  no in-scope test needs a sibling app build first. Server tests run against
  source; web tests run against source. Verify with Step 4. If any test breaks,
  restore `["^build"]` and instead leave `test` as-is (STOP and report — the
  build dependency is load-bearing).

**Verify**: `turbo run build --dry-run=json` no longer lists `<NONEXISTENT>`
tasks in the executed set for `dev`/`test` chains. `cat turbo.json` parses as
valid JSON (`node -e "JSON.parse(require('fs').readFileSync('turbo.json'))"`).

### Step 3: Remove misleading `files: ["dist"]` from source-only libs

For each in-scope library package.json (from Step 1), remove the
`"files": ["dist"]` entry, since nothing builds a `dist` and the package ships
its `src` via `exports`. Leave `exports`, `types`, `import` paths untouched.
Also remove the root `build:contracts` script line from `package.json` (it is a
confirmed no-op), or repoint it if a real build is later added (do not add one
here).

**Verify**: `git grep -n '"dist"' packages/*/package.json` returns no `files`
entries for the source-only libs. `grep -n "build:contracts" package.json`
returns nothing.

### Step 4: Full verification that nothing regressed

**Verify** (all must pass):

- `bun typecheck` → exit 0
- `bun run test` → all pass
- `bun run build` → exit 0 (apps still build; `apps/web`, `apps/server`,
  `apps/desktop` outputs produced)
- `bun fmt` then `bun run fmt:check` → exit 0
- `bun lint` → exit 0

## Test plan

No new unit tests — this is build-configuration. The test is that the full gate
sequence in Step 4 passes with the dead wiring removed. The risk is a hidden
consumer expecting `dist`; Step 4's `bun run build` + `bun run test` is the
guard. If `bun install --frozen-lockfile` is needed in a fresh tree, run it
first.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `turbo run build --dry-run=json` lists no `<NONEXISTENT>` build task in the `dev`/`test` execution set
- [ ] `grep -n "build:contracts" package.json` returns nothing
- [ ] No source-only library package.json contains `"files": ["dist"]`
- [ ] `bun typecheck` exits 0
- [ ] `bun run test` exits 0
- [ ] `bun run build` exits 0
- [ ] `bun lint` and `bun run fmt:check` exit 0
- [ ] Only `turbo.json`, root `package.json`, and source-only library package.jsons are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- Removing `test.dependsOn: ["^build"]` causes any test in `bun run test` to
  fail (the build dependency is real for some package) — restore it and report.
- Any of `packages/contracts`, `packages/shared`, etc. turns out to HAVE a
  `build` script (the "Current state" is stale) — re-scope and report.
- `bun run build` fails after your edits for any app.

## Maintenance notes

- If a library package is ever published to npm (made non-private), it will
  need a real `build` (e.g. `tsdown`) and the `files`/`exports` repointed at
  `dist`. This plan deliberately does NOT add that; it removes the half-present
  wiring so the next person makes a clean, deliberate choice.
- A reviewer should confirm `bun run build` still emits app artifacts and that
  the `dev` workflow (`bun dev`) still starts.
