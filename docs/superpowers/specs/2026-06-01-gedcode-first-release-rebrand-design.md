# GedCode First-Release Docs, Rebrand & Sponsor Button — Design

**Date:** 2026-06-01
**Status:** Historical; implemented and superseded
**Branch:** `feat/first-release-rebrand` (off `chore/sync-upstream-beta73`)

> This records the original release design, not current architecture. The unused `t3://` static
> protocol path named below was removed during the August 2026 cleanup after packaged-app tests
> confirmed that updates and navigation do not depend on it.

## Goal

Prepare GedCode for its first public release by (1) finishing the t3code → GedCode
rebrand of the published CLI, (2) making all user-facing docs accurate for how
GedCode is actually distributed, and (3) adding a GitHub Sponsors button.

GedCode is a rebranded fork of [t3code](https://github.com/pingdotgg/t3code). The
repo title already says "GedCode", but install instructions, package names, and
release links still point at upstream (`pingdotgg/t3code`, `npx t3`, winget/AUR/brew
packages owned by upstream).

## Scope

Three independent units. Each can be built and verified on its own.

### Unit 1 — Sponsor button

Add `.github/FUNDING.yml`:

```yaml
github: [edgyarmati]
```

GitHub renders its native "Sponsor" button on the repo automatically. No UI code
(FUNDING.yml only — web app / marketing site / README badge were considered and
declined).

### Unit 2 — CLI rebrand `t3` → `gedcode` (published-CLI-only)

Rename the published npm package + binary so users run `npx gedcode`.

**In scope — exact surface:**

- `apps/server/package.json`:
  - `name`: `t3` → `gedcode`
  - `bin`: `t3` → `gedcode` (the bin target `./dist/bin.mjs` is unchanged)
  - `repository.url`: `https://github.com/pingdotgg/t3code` → `https://github.com/edgyarmati/gedcode`
- `--filter=t3` → `--filter=gedcode` in:
  - root `package.json` scripts (`start`, `build:desktop`) — 2 occurrences
  - `scripts/dev-runner.ts` (`dev`, `dev:server`) — 2 occurrences
  - `.github/workflows/release.yml` (install + build steps) — 2 occurrences
- Verify `apps/server/scripts/cli.ts publish` derives the package name from
  `package.json` (expected) rather than hardcoding `t3`.

**Explicitly out of scope (flagged, intentionally left as-is):**

- Desktop deep-link URL scheme `DESKTOP_SCHEME = "t3"` (`apps/desktop/src/electron/ElectronProtocol.ts`).
  Renaming the registered `t3://` protocol risks breaking auto-update deep-links;
  defer to a dedicated desktop-rebrand effort.
- Internal `@t3tools/*` workspace packages. They are `private` and never published,
  so they are invisible to users. Renaming them is large churn (hundreds of imports)
  with no user-facing benefit.

**Prerequisites (user-owned, not code blockers):**

- The `gedcode` name must be available on the npm registry.
- npm publish auth under the user's account (the workflow currently relies on
  upstream's OIDC trusted publishing; switching publishers is a release-time concern,
  not part of this code change).

**Verification:** full gate after the rename — `bun fmt && bun lint && bun typecheck && bun run test`.
The `--filter` changes are the main breakage risk (turbo resolves filters by package name).

### Unit 3 — Docs overhaul

Rebrand + accuracy pass across user-facing docs only. Internal docs
(`.ged/`, `.docs/`, `.plans/`) are out of scope.

**Files:** `README.md`, `CONTRIBUTING.md`, `REMOTE.md`, `KEYBINDINGS.md`,
`docs/release.md`, `docs/observability.md`, `docs/providers/*`.

**Changes:**

- `pingdotgg/t3code` → `edgyarmati/gedcode` (release links, repository URLs)
- `npx t3` → `npx gedcode`
- t3code / T3 Code naming → GedCode
- README **Installation** section: keep only
  - "Run without installing": `npx gedcode`
  - "Desktop app": download from [GitHub Releases](https://github.com/edgyarmati/gedcode/releases)
  - **Remove** the Windows (winget `T3Tools.T3Code`), macOS (Homebrew `t3-code`),
    and Arch (AUR `t3code-bin`) sections — those registries are owned by upstream
    and GedCode does not have its own entries yet. Better no command than a broken one.
- Remove the Discord link (`discord.gg/jn4EGJjrvv` — upstream's server)
- Remove the "We are not accepting contributions yet" note
- `docs/release.md`: references to the npm package `t3` → `gedcode`

### Unit 4 — Homebrew — DROPPED

Considered (custom tap `edgyarmati/homebrew-gedcode` + cask file + optional release
automation) and explicitly declined for this round. Install channels for the first
release are GitHub Releases + npm only.

## Non-goals

- Desktop app packaging rebrand (appId, URL scheme, installer names)
- Renaming internal `@t3tools/*` packages
- Setting up winget / AUR / Homebrew registry entries
- npm publish credential / OIDC trusted-publisher setup
- Marketing site (`apps/marketing`) content changes

## Risks & mitigations

- **Turbo `--filter` breakage** after the rename → caught by the build/test gate.
- **`gedcode` npm name availability** → user prerequisite, surfaced explicitly; does
  not block the code change.
- **Stale t3code references missed** → after edits, grep the in-scope files for
  `t3code|pingdotgg|npx t3|T3Tools|t3-code|t3code-bin|"t3"` to confirm none remain.

## Definition of done

- `.github/FUNDING.yml` present with the `edgyarmati` handle.
- `npx gedcode` is the published command; `t3` package name no longer used in the
  in-scope rename surface.
- In-scope docs contain no upstream-owned references; install instructions list only
  channels GedCode actually controls (Releases + npm).
- Full verification gate green.
