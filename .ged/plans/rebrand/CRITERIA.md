# Acceptance criteria — GedCode 0.5 identity and the 0.4 upgrade

Written to be ruled `met` / `not_met` / `unverifiable` from the diff (`git diff origin/main...rebrand`)
and from command output, by a verifier who did not write the code.

## 1. App identity

- `scripts/ged/identity.ts` sets `GED_APP_ID` to `com.gedcode.app`; the desktop app id, Linux
  desktop entry names and the launchd label in `apps/server/src/cloud/bootService.ts` use
  `com.gedcode.*`. `git grep "com.t3tools.gedcode"` matches only history in `.ged/` docs.
- `.github/workflows/ged-release.yml` refuses a build whose `CFBundleIdentifier` is not
  `com.gedcode.app`.

## 2. 0.4 installs still update in place

- Sparkle 2.9.6 locates the new app in an update by file name (`GedCode.app`) and trusts it by the
  EdDSA key, without requiring the bundle id to match the installed one. Checkable against
  Sparkle's source at tag 2.9.6 (`Autoupdate/SUInstaller.m`, `Sparkle/SUUpdateValidator.m`).
- The packaged app is still named `GedCode.app`, and its data paths (`~/.gedcode`, Electron
  userData `gedcode`) do not depend on the bundle id.

## 3. User-visible names

- The CLI is `gedcode`, the project file is `gedcode.json` and only that file is read — there is no
  `t3.json` fallback — and new branches are prefixed `gedcode/`, or `gedcode-` when a plain
  `gedcode` branch blocks that namespace (upstream's same fallback, renamed).
- `scripts/ged/identity.ts` rewrites remaining user-visible "t3" prose in staged bundles, and its
  tests cover each rule including a case that must stay unchanged (`npm uninstall -g t3`).

## 4. Upgrading a 0.4 database

- On first start over a v0.4.8 database, `initializeV2Database` rewrites only the snapshot copy:
  v0.4's migration rows 31–80, its tables and its columns are removed, then upstream's migrations
  run and threads survive. The original `state.sqlite` is never written.
- A database whose ledger is not exactly v0.4's passes through unchanged.
- `apps/server/src/persistence/gedV04Import.test.ts` asserts both.

## 5. Telling the user

- `apps/desktop/src/ged/GedUpgradeNotice.ts` shows a one-time dialog only when `state.sqlite`
  exists and `statev2.sqlite` does not. It says the old Ged orchestrator is deprecated and not in
  0.5 in that form, that threads are kept, and that PM history does not carry over. A failed check
  logs and does not block startup.
- `docs/ged/releases/0.5.0.md` says the same, and the release workflow embeds it in the Sparkle
  feed and the GitHub release when the file exists; `scripts/sparkle/generate-feed.ts` fails if
  notes were given but none were embedded.

## 6. Upstream footprint

- Every upstream file this branch modifies is listed in `.ged/STANDARDS.md`'s modified-upstream
  table. Compare against `git diff --name-only upstream/main...rebrand`, ignoring files under
  `.ged/`, `docs/ged/`, `scripts/ged/`, `scripts/sparkle/`, `apps/desktop/src/ged/`, and other
  files the branch adds.

## 7. Tests

- These pass:
  - `cd scripts && vp test run ged sparkle`
  - `cd apps/server && vp test run src/persistence src/cloud/bootService.test.ts`
  - `cd apps/desktop && vp test run src/ged src/app`
- No secret (Sparkle private seed, `T3CODE_DEV_AUTH_TOKEN`, Clerk key) appears in the diff.
