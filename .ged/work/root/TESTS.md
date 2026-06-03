# Tests

## Current Status

Documentation edits are applied. Required repo gates pass on the final docs.

## Targeted Consistency Checks

Release workflow alignment:

```sh
rg -n "nightly|schedule|Vercel|OIDC|trusted publishing|NPM_TOKEN|workflow_dispatch" docs/release.md .github/workflows/release.yml
```

Remote SSH launch path:

```sh
rg -n "\\.t3/ssh-launch|\\.gedcode/ssh-launch" REMOTE.md packages/ssh/src
```

Keybinding defaults and commands:

```sh
rg -n "DEFAULT_KEYBINDINGS|diff.toggle|modelPicker|thread.previous|thread.next|modelPickerOpen" KEYBINDINGS.md packages/shared/src/keybindings.ts packages/contracts/src/keybindings.ts
```

Observability source of truth:

```sh
rg -n "TraceRecord.ts|t3_db_|Metrics.ts|observability.ts" docs/observability.md apps/server/src/observability/Metrics.ts packages/shared/src/observability.ts
```

Provider documentation coverage:

```sh
rg -n "Codex|Claude|OpenCode|opencode|Cursor" README.md docs/providers apps/server/src/provider/Drivers apps/server/src/provider/Layers/OpenCodeProvider.ts
```

Broken absolute checklist links:

```sh
rg -n "/Users/julius|codething-mvp" docs/effect-fn-checklist.md
```

Screenshot placeholder count:

```sh
rg -n "SCREENSHOT PLACEHOLDER|screenshot placeholder|TODO.*screenshot|!\\[.*screenshot" README.md docs
```

## Required Repo Gates

```sh
bun fmt
bun lint
bun typecheck
```

Do not run `bun test`; use `bun run test` only if tests are needed. No targeted code tests are expected for a documentation-only change.

## Evidence

- `rg -n "nightly|schedule|Vercel|OIDC|trusted publishing|NPM_TOKEN|workflow_dispatch|release:smoke" docs/release.md .github/workflows/release.yml`: exit 0. Expected hits show `workflow_dispatch` and `NPM_TOKEN` in the workflow and show nightly/Vercel/OIDC described only under "What Is Not Automated Today"; no `release:smoke` hit.
- `rg -n "\\.t3/ssh-launch|\\.gedcode/ssh-launch" REMOTE.md packages/ssh/src`: exit 0. All hits use `~/.gedcode/ssh-launch` / `$HOME/.gedcode/ssh-launch`.
- `rg -n "/Users/julius|codething-mvp" docs/effect-fn-checklist.md`: exit 1, no output.
- `rg -n "SCREENSHOT PLACEHOLDER|screenshot placeholder|TODO.*screenshot|!\\[.*screenshot" README.md docs --glob '!docs/superpowers/**'`: exit 0 with exactly one hit, `README.md:5`.
- `rg -n "TraceRecord.ts|t3_db_query_duration|t3_db_queries_total|~/.t3/ssh-launch|release:smoke" README.md docs REMOTE.md KEYBINDINGS.md --glob '!docs/superpowers/**'`: exit 1, no output.
- `tail -12 docs/effect-fn-checklist.md`: confirms the checklist no longer ends with stray empty code fences.
- `bun fmt`: passed.
- `bun lint`: passed with existing warnings.
- `bun typecheck`: passed.
- Post-verifier follow-up: verifier reported `@t3tools/shared:typecheck` failures in its environment.
  Fresh parent reruns passed:
  - `bun typecheck`: passed.
  - `bun --filter=@t3tools/shared run typecheck`: passed.

Extra release-specific check:

- `bun run release:smoke`: failed because the script's temporary workspace fixture cannot currently resolve `@t3tools/ged-workflow`. The release docs no longer recommend this broken rehearsal command.

## Verifier

- `ged-verifier`: found no content-accuracy blockers in scoped docs. It reported a typecheck blocker,
  but parent follow-up reproduced neither the full nor focused typecheck failure, so the finding is
  adjudicated as an isolated verifier environment mismatch.
