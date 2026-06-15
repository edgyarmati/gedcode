# Plan 004: Test coverage is measurable via an opt-in coverage provider

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If a
> STOP condition occurs, stop and report. Update this plan's row in
> `plans/README.md` when done unless a reviewer maintains the index.
>
> **Drift check (run first)**: `git diff --stat 65e913c7..HEAD -- vitest.config.ts package.json apps/server/vitest.config.ts apps/web/vitest.config.ts turbo.json`
> If any changed, re-confirm the excerpts below; on a mismatch treat as a STOP.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (enables informed work on plans 011–013)
- **Category**: tests
- **Planned at**: commit `65e913c7`, 2026-06-13
- **Issue**: https://github.com/edgyarmati/gedcode/issues/11

## Why this matters

The repo has ~299 test files but **no coverage instrument**, so nobody can
answer "which branches inside our large tested files are actually exercised?"
Files like `apps/server/src/git/GitManager.ts` (~1791 LOC) and the WS routing
layer have suites, but with no coverage tool there is no signal on which
conditional branches (skip semantics, error paths) are hit. Adding an opt-in
coverage provider (no failing threshold yet) gives that signal cheaply and is a
prerequisite for confidently scoping the performance refactors in plans 011–013.

## Current state

- `vitest.config.ts` (root) has no `coverage` block:
  ```ts
  import * as path from "node:path";
  import { defineConfig } from "vitest/config";
  export default defineConfig({
    resolve: {
      alias: [
        {
          find: /^@t3tools\/contracts$/,
          replacement: path.resolve(import.meta.dirname, "./packages/contracts/src/index.ts"),
        },
      ],
    },
  });
  ```
- `apps/server/vitest.config.ts` merges the root config and bumps timeouts; no
  coverage block. `apps/web/vitest.config.ts` is effectively empty.
- `package.json` catalog pins `@effect/vitest` and `vitest: "^4.0.0"` but no
  `@vitest/coverage-v8` / `c8` / istanbul anywhere.
- Per-package test scripts: `apps/server` `"test": "vitest run"`, `apps/web`
  `"test": "vitest run --passWithNoTests"`, root `"test": "turbo run test"`.
- `turbo.json` `test` task has `cache: false`.

## Commands you will need

| Purpose          | Command                                                             | Expected on success                 |
| ---------------- | ------------------------------------------------------------------- | ----------------------------------- |
| Install dep      | `bun add -D @vitest/coverage-v8@catalog: -w` (see Step 1 for exact) | lockfile updated, exit 0            |
| Run with cov     | `bun run test:coverage` (added in this plan)                        | tests pass, coverage report printed |
| Typecheck        | `bun typecheck`                                                     | exit 0                              |
| Normal test gate | `bun run test`                                                      | all pass (never `bun test`)         |
| Lint / format    | `bun lint` ; `bun fmt`                                              | exit 0                              |

## Scope

**In scope**:

- `package.json` (root) — add `@vitest/coverage-v8` to the catalog + devDeps,
  add a `test:coverage` script
- `vitest.config.ts` (root) — add a `coverage` config block (provider only, no
  failing threshold)
- `turbo.json` — add a `test:coverage` task (optional, non-blocking)
- `bun.lock` — will change as a result of the install (commit it)

**Out of scope**:

- Do NOT set a coverage `threshold` that fails CI. Collect a baseline first.
- Do NOT modify `.github/workflows/ci.yml` to add a coverage gate (that is a
  separate decision; this plan only makes coverage _available_).
- Do NOT edit any test file or source file.

## Git workflow

- Branch: `advisor/004-vitest-coverage`
- One commit: `test: add opt-in vitest coverage provider`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Add the coverage provider dependency

Vitest is pinned to `^4.0.0` via the catalog, so the coverage package version
must match vitest's major. Add `@vitest/coverage-v8` to the root `package.json`
`workspaces.catalog` with the same version as `vitest` (`^4.0.0`), then add
`"@vitest/coverage-v8": "catalog:"` to root `devDependencies`. Then run
`bun install` to update the lockfile.

If a catalog entry feels heavy, the minimal alternative is a direct root devDep:
`bun add -D @vitest/coverage-v8 -w`. Prefer the catalog approach to match repo
convention (every shared dep version lives in the catalog).

**Verify**: `bun pm ls 2>/dev/null | grep coverage-v8` (or `grep -n
"coverage-v8" package.json bun.lock`) shows the package present. `bun install`
exits 0.

### Step 2: Configure the coverage provider in the root vitest config

In `vitest.config.ts`, add a `test.coverage` block. Keep it provider-only with
no failing threshold:

```ts
export default defineConfig({
  resolve: {
    /* unchanged alias */
  },
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      reportsDirectory: "./coverage",
      // No `thresholds` yet — collect a baseline before ratcheting.
    },
  },
});
```

Add `coverage/` to `.gitignore` if not already ignored.

**Verify**: `node -e "require('./vitest.config.ts')"` is not valid for TS; instead
confirm the file typechecks via Step 5 and that the config parses when vitest
runs in Step 3.

### Step 3: Add a `test:coverage` script

In root `package.json` scripts, add:
`"test:coverage": "turbo run test -- --coverage"` (turbo passes `--coverage`
through to each package's `vitest run`). If turbo arg-passthrough is awkward,
fall back to a per-package invocation, e.g.
`"test:coverage": "cd apps/server && bunx vitest run --coverage"` for a single
package baseline. Optionally add a `test:coverage` task to `turbo.json` mirroring
the `test` task (`cache: false`, no outputs).

**Verify**: `bun run test:coverage` runs the suite and prints a coverage table
(text reporter). It is OK for it to take a while; it must exit 0.

### Step 4: Confirm the normal test gate is unchanged

The default `bun run test` must NOT collect coverage (coverage is opt-in via the
new script) so CI timing is unaffected.

**Verify**: `bun run test` → all pass, and does not error about coverage.

### Step 5: Full gate

**Verify**: `bun typecheck` → exit 0; `bun lint` → exit 0; `bun fmt` then
`bun run fmt:check` → exit 0.

## Test plan

No new unit tests. The deliverable is the capability. Validation:

- `bun run test:coverage` produces a coverage report (text + `coverage/` html).
- `bun run test` still passes and does not collect coverage.
  Record the baseline numbers in the PR description (do not commit a threshold).

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -n "coverage-v8" package.json` shows the dep present
- [ ] `vitest.config.ts` contains a `coverage` block with `provider: "v8"`
- [ ] `bun run test:coverage` exits 0 and prints a coverage summary
- [ ] `bun run test` exits 0 (and is NOT slowed by coverage)
- [ ] `bun typecheck`, `bun lint`, `bun run fmt:check` exit 0
- [ ] `coverage/` is gitignored (no coverage artifacts staged: `git status` clean of `coverage/`)
- [ ] Only `package.json`, `bun.lock`, `vitest.config.ts`, `turbo.json`, `.gitignore` are modified
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- `@vitest/coverage-v8` has no version compatible with the pinned `vitest`
  (`^4.0.0`) — report the version conflict; do not downgrade vitest.
- `bun run test:coverage` fails for a reason other than missing coverage config
  (e.g. a test itself fails) — that is a pre-existing failure, report it.
- Enabling coverage changes test _results_ (a test passes without coverage but
  fails with it) — report; do not paper over it.

## Maintenance notes

- Next step (a separate task, not this plan): collect the baseline, then add a
  non-zero `thresholds` block and wire `test:coverage` into CI as a soft gate
  that ratchets upward. Do not jump straight to a high threshold.
- Plans 011–013 (performance) touch `ProjectionPipeline.ts` and web `store.ts`;
  running `test:coverage` on those areas first tells the executor which branches
  are already protected before refactoring.
