# GedCode First-Release Rebrand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare GedCode for first release: add a GitHub Sponsors button, rebrand the published CLI `t3` → `gedcode`, and make all user-facing docs accurate (Releases + npm only).

**Architecture:** Three independent units — (1) a `.github/FUNDING.yml` file, (2) a contained published-CLI rename across `apps/server` + turbo filters, (3) a docs rebrand/accuracy pass. The rename is verified by the existing build/test gate; docs are verified by grep sweeps.

**Tech Stack:** Bun workspace monorepo, turbo, Effect CLI (`Command.make`), Vitest, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-06-01-gedcode-first-release-rebrand-design.md`

---

## File Structure

| File                            | Responsibility                                    | Unit |
| ------------------------------- | ------------------------------------------------- | ---- |
| `.github/FUNDING.yml`           | GitHub native Sponsor button config               | 1    |
| `apps/server/package.json`      | published package `name`, `bin`, `repository.url` | 2    |
| `apps/server/src/bin.ts`        | CLI program name (`Command.make`)                 | 2    |
| `apps/server/src/bin.test.ts`   | assertions on CLI command path                    | 2    |
| `package.json` (root)           | turbo `--filter` script targets                   | 2    |
| `scripts/dev-runner.ts`         | turbo `--filter` dev targets                      | 2    |
| `.github/workflows/release.yml` | turbo `--filter` release targets                  | 2    |
| `README.md`                     | install instructions, branding, links             | 3    |
| `REMOTE.md`                     | `npx` command branding                            | 3    |
| `docs/observability.md`         | `npx` command branding                            | 3    |
| `docs/release.md`               | npm package name references                       | 3    |
| `docs/providers/codex.md`       | product naming                                    | 3    |

**Out of scope (do NOT touch):** `apps/desktop/src/electron/ElectronProtocol.ts` (`DESKTOP_SCHEME = "t3"`), internal `@t3tools/*` packages, and the `/__t3code/channel` route + `t3code_web_channel` cookie + `app.t3.codes` domain in `docs/release.md` (these document actual code identifiers that are not being renamed).

---

## Task 1: Sponsor button (FUNDING.yml)

**Files:**

- Create: `.github/FUNDING.yml`

- [ ] **Step 1: Create the funding config**

```yaml
github: [edgyarmati]
```

- [ ] **Step 2: Verify it is valid YAML and present**

Run: `cat .github/FUNDING.yml && bunx js-yaml .github/FUNDING.yml`
Expected: prints the file, then `{ github: [ 'edgyarmati' ] }` with no parse error.
(If `js-yaml` is unavailable, just confirm the file content matches Step 1.)

- [ ] **Step 3: Commit**

```bash
git add .github/FUNDING.yml
git commit -m "chore: add GitHub Sponsors funding config"
```

---

## Task 2: Rename published CLI `t3` → `gedcode`

**Files:**

- Modify: `apps/server/package.json` (name, bin, repository)
- Modify: `apps/server/src/bin.ts:16`
- Modify: `apps/server/src/bin.test.ts:251,354`
- Modify: `package.json` (root) scripts `start`, `build:desktop`
- Modify: `scripts/dev-runner.ts` (`dev`, `dev:server`)
- Modify: `.github/workflows/release.yml` (install + build CLI steps)

- [ ] **Step 1: Update the CLI program name in bin.ts**

In `apps/server/src/bin.ts`, line 16, change the `Command.make` program name:

```ts
export const cli = Command.make("gedcode", { ...sharedServerCommandFlags }).pipe(
```

(was `Command.make("t3", ...)`)

- [ ] **Step 2: Update the command-path assertions in bin.test.ts**

In `apps/server/src/bin.test.ts`, update both assertions that expect the program name as the first element of `commandPath`:

Line ~251:

```ts
assert.deepEqual(error.commandPath, ["gedcode", "auth", "pairing", "create"]);
```

Line ~354:

```ts
assert.deepEqual(error.commandPath, ["gedcode", "project", "add"]);
```

(both were `["t3", ...]`)

- [ ] **Step 3: Run the server bin tests to verify they pass**

Run: `bun run --filter=t3 test -- bin.test.ts`
Expected: PASS. (Use `--filter=t3` here — the package is still named `t3` until Step 4.)
If the runner does not accept a file filter, run `bun run --filter=t3 test` and confirm `src/bin.test.ts` passes.

- [ ] **Step 4: Rename the package, bin, and repository in apps/server/package.json**

Change the top of `apps/server/package.json`:

```json
{
  "name": "gedcode",
  "version": "0.1.0",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/edgyarmati/gedcode",
    "directory": "apps/server"
  },
  "bin": {
    "gedcode": "./dist/bin.mjs"
  },
```

(was `"name": "t3"`, `"bin": { "t3": "./dist/bin.mjs" }`, repository url `https://github.com/pingdotgg/t3code`)

- [ ] **Step 5: Update turbo `--filter=t3` to `--filter=gedcode` in root package.json**

In `package.json` (root):

```json
    "start": "turbo run start --filter=gedcode",
```

```json
    "build:desktop": "turbo run build --filter=@t3tools/desktop --filter=gedcode",
```

(only the bare `t3` filter changes; leave `@t3tools/desktop` untouched)

- [ ] **Step 6: Update turbo `--filter=t3` in scripts/dev-runner.ts**

In `scripts/dev-runner.ts`, change both occurrences (the `dev` array entry and the `dev:server` entry):

```ts
    "--filter=gedcode",
```

```ts
  "dev:server": ["run", "dev", "--filter=gedcode"],
```

- [ ] **Step 7: Update turbo `--filter=t3` in release.yml**

In `.github/workflows/release.yml`:

Install step (~line 344):

```yaml
run: bun install --frozen-lockfile --filter=gedcode --filter=@t3tools/web --filter=@t3tools/scripts
```

Build CLI step (~line 353):

```yaml
run: bun --filter=gedcode run build
```

- [ ] **Step 8: Reinstall so the workspace re-resolves the renamed package**

Run: `bun install`
Expected: completes with `Saved lockfile` (the workspace package name changed).

- [ ] **Step 9: Run the full verification gate**

Run: `bun fmt && bun lint && bun typecheck && bun run test`
Expected: all green. The `--filter=gedcode` turbo targets must resolve (no "no package found" errors), and `bin.test.ts` passes with the new `["gedcode", ...]` paths.

- [ ] **Step 10: Commit**

```bash
git add apps/server/package.json apps/server/src/bin.ts apps/server/src/bin.test.ts package.json scripts/dev-runner.ts .github/workflows/release.yml bun.lock
git commit -m "refactor: rename published CLI t3 -> gedcode"
```

---

## Task 3: README rebrand + install accuracy

**Files:**

- Modify: `README.md`

- [ ] **Step 1: Replace the install section (lines ~15–41) with Releases + npm only**

Replace from `### Run without installing` through the Arch Linux block with:

````markdown
### Run without installing

```bash
npx gedcode
```
````

### Desktop app

Install the latest version of the desktop app from [GitHub Releases](https://github.com/edgyarmati/gedcode/releases).

````

This removes the Windows (`winget install T3Tools.T3Code`), macOS (`brew install --cask t3-code`), and Arch (`yay -S t3code-bin`) sections and points the Releases link at `edgyarmati/gedcode`.

- [ ] **Step 2: Remove the "not accepting contributions" line**

In the `## Some notes` section, delete this line (and its surrounding blank line):

```markdown
We are not accepting contributions yet.
````

The section should now read:

```markdown
## Some notes

We are very very early in this project. Expect bugs.

Observability guide: [docs/observability.md](./docs/observability.md)
```

- [ ] **Step 3: Remove the Discord line**

Delete this line near the end of the README:

```markdown
Need support? Join the [Discord](https://discord.gg/jn4EGJjrvv).
```

- [ ] **Step 4: Verify no stale references remain in README**

Run: `grep -nE "t3code|pingdotgg|npx t3|T3Tools|t3-code|discord.gg|not accepting contributions" README.md`
Expected: no output (exit 1).

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: rebrand README install instructions for first release"
```

---

## Task 4: Rebrand `npx t3` in REMOTE.md and observability.md

**Files:**

- Modify: `REMOTE.md` (lines ~67, 89, 96)
- Modify: `docs/observability.md` (lines ~68, 119)

- [ ] **Step 1: Replace `npx t3` with `npx gedcode` in REMOTE.md**

Update the three command lines:

```bash
npx gedcode serve --host "$(tailscale ip -4)"
```

```bash
npx gedcode serve --tailscale-serve
```

```bash
npx gedcode serve --tailscale-serve --tailscale-serve-port 8443
```

- [ ] **Step 2: Replace `npx t3` with `npx gedcode` in docs/observability.md**

Both occurrences (lines ~68 and ~119) become:

```bash
npx gedcode
```

- [ ] **Step 3: Verify**

Run: `grep -rn "npx t3" REMOTE.md docs/observability.md`
Expected: no output (exit 1).

- [ ] **Step 4: Commit**

```bash
git add REMOTE.md docs/observability.md
git commit -m "docs: update npx t3 -> npx gedcode in REMOTE and observability"
```

---

## Task 5: Rebrand npm package name in release.md + product name in codex.md

**Files:**

- Modify: `docs/release.md` (lines ~24, 97, 129)
- Modify: `docs/providers/codex.md` (line ~43)

- [ ] **Step 1: Update npm package references in docs/release.md**

Line ~24:

```markdown
- Publishes the CLI package (`apps/server`, npm package `gedcode`) with OIDC trusted publishing from the same workflow file:
```

Line ~97:

```markdown
- Publishes the CLI package (`apps/server`, npm package `gedcode`) to the `nightly` npm dist-tag using the same nightly version.
```

Line ~129:

```markdown
1. Confirm npm org/user owns package `gedcode` (or rename package first if needed).
```

**Do NOT change** lines ~59–61 and ~70 (`/__t3code/channel`, `t3code_web_channel`, `app.t3.codes`) — those name real code/router identifiers that are out of scope.

- [ ] **Step 2: Update product name in docs/providers/codex.md**

Line ~43:

```markdown
- both accounts can see the same GedCode/Codex sessions
```

(was `T3/Codex sessions`)

- [ ] **Step 3: Verify only intended references changed**

Run: `grep -nE "npm package \`t3\`|owns package \`t3\`|T3/Codex" docs/release.md docs/providers/codex.md`Expected: no output (exit 1).
Run:`grep -n "\_\_t3code\|t3code_web_channel\|app.t3.codes" docs/release.md`
Expected: still present (these are intentionally preserved).

- [ ] **Step 4: Commit**

```bash
git add docs/release.md docs/providers/codex.md
git commit -m "docs: rebrand npm package name and product references"
```

---

## Task 6: Final verification + stale-reference sweep

**Files:** none (verification only)

- [ ] **Step 1: Sweep all in-scope docs for missed upstream references**

Run:

```bash
grep -rnE "t3code|pingdotgg|npx t3|T3Tools|t3-code|t3code-bin" \
  README.md CONTRIBUTING.md REMOTE.md KEYBINDINGS.md \
  docs/release.md docs/observability.md docs/providers/
```

Expected: the ONLY allowed hits are the preserved router identifiers in `docs/release.md` (`__t3code`, `t3code_web_channel`). Anything else must be fixed before continuing.

- [ ] **Step 2: Confirm the renamed CLI builds and runs**

Run: `bun run --filter=gedcode build`
Expected: build succeeds and emits `apps/server/dist/bin.mjs`.

- [ ] **Step 3: Run the full gate one final time**

Run: `bun fmt && bun lint && bun typecheck && bun run test`
Expected: all green.

- [ ] **Step 4: Final commit (only if Step 1/3 required fixes)**

```bash
git add -A
git commit -m "chore: finalize first-release rebrand"
```

---

## Self-Review notes

- **Spec coverage:** Unit 1 → Task 1; Unit 2 → Task 2 (package/bin/program-name/filters); Unit 3 → Tasks 3–5; verification → Task 6. Homebrew (Unit 4) intentionally dropped. ✔
- **Out-of-scope guards** are stated in Task 2 file list and Task 5 Step 1/3. ✔
- **Type/name consistency:** the program name `gedcode` in `bin.ts` (Task 2 Step 1) matches the `bin.test.ts` assertions (Step 2) and the package `bin` key (Step 4). ✔
- **No placeholders:** every edit shows concrete content. ✔
