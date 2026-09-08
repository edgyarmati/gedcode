# Verification plan

- Protocol regression: all exported PlanType schemas agree with installed 0.149.1's closed enum;
  account/read and account/rateLimits/read/updated notification decoding preserves new values;
  unknown strings and malformed account types remain rejected. Generator transform is narrow and
  idempotent, and does not change unrelated definitions.
- Provider regression: actual observed ChatGPT business-prolite plan produces authenticated/ready
  status and a business subscription label. Existing plan labels remain correct.
- Astra regression: exact official `gpt-6-astra` and explicit `astra` alias normalize predictably;
  catalog model/capabilities and explicit custom model survive provider discovery; session thread and
  turn parameters use the exact model, not a default or substitute. No automatic catalog insertion.
- Run only affected files with package-local `bun run test <files>`.
- Run `bun fmt`, `bun lint`; narrow typechecks: effect-codex-app-server, contracts, shared, server.
- Decode sanitized actual initialized/account/model-list responses against fixed schemas, then run
  real GedCode provider status probe in a temporary private CODEX_HOME; no model generation or
  persistent thread creation. Verify original auth/config content unchanged and clean up copies.
- `git diff --check`, `git status --short`, `git diff --cached --name-only` before handoff. No commits.


## Checked outcomes (2026-09-08)

| Command / check | Outcome |
| --- | --- |
| `codex --version`; `codex login status` | 0.149.1; ChatGPT login. |
| Isolated `codex app-server`: initialize, account/read (no refresh), model/list (including hidden), skills/list | All succeeded. Fresh catalog timestamp 2026-09-08T07:14:56Z. No Astra advertised. Temporary auth/config copies deleted; original content hashes unchanged. |
| `codex app-server generate-json-schema --experimental --out /tmp/ged-codex-schema` | Installed closed PlanType enum independently confirms all 17 variants, including 5 missing from GedCode. ReasoningEffort is already an open string in installed/source schemas. |
| Official model references | HTTP 200 from https://developers.openai.com/codex/models and https://developers.openai.com/api/docs/models/gpt-6-astra. Codex page explicitly gives `codex -m gpt-6-astra`. |
| Sanitized actual response decoding before fix | Initialize and model/list succeeded; account/read failed specifically on self_serve_business_prolite. |
| `bun run --cwd packages/effect-codex-app-server test src/planType.test.ts` before fix | Expected regression red: 5 missing-plan cases failed, 13 passed. |
| `bun run --cwd packages/effect-codex-app-server test src/planType.test.ts scripts/schemaCompatibility.test.ts src/protocol.test.ts src/client.test.ts` | 4 files / 26 tests passed. Narrow generator overlay tested; no broad protocol regeneration. |
| `bun run --cwd packages/shared test src/model.test.ts` | 1 file / 20 tests passed. |
| `bun run --cwd apps/server test src/provider/Layers/CodexProvider.test.ts src/provider/Layers/CodexSessionRuntime.test.ts src/provider/Layers/CodexAdapter.test.ts` | 3 files / 69 tests passed. |
| `bun fmt` | Passed, 1461 files checked/formatted; no unrelated formatting changes. |
| `bun lint` | Passed; 76 existing warnings in unchanged code, none in new/changed test logic. |
| `bun run --cwd packages/effect-codex-app-server typecheck` | Passed. |
| `bun run --cwd packages/contracts typecheck` | Passed. |
| `bun run --cwd packages/shared typecheck` | Initially passed, one final run failed resolving effect/Logger in unchanged observability.test.ts:7 with cascading diagnostics at 71/256/303; isolated retry passed without code/dependency changes. |
| `bun run --cwd apps/server typecheck` | Passed after correcting two new sync-schema-in-Effect diagnostics in the first implementation run; final check passed. |
| Sanitized actual response decoding after fix | Initialize, account/read, model/list all decode successfully. |
| Real `checkCodexProviderStatus` in private temporary CODEX_HOME | Ready, authenticated, 0.149.1, ChatGPT Business Subscription; 5 real catalog models, 16 skills, and exact gpt-6-astra retained only as an explicitly supplied custom model. No generation or persistent thread creation. Original auth/config hashes unchanged. |
| Installed app.asar read-only inspection | GedCode 0.5.0 server bundle contains old business plan but not self_serve_business_prolite, confirming the installed integration has the same missing variant. |
| Runtime logs read-only | ~/.gedcode/userdata/logs/server-child.log:2440 and 2456 (2026-09-08) report an existing quota-stage resume command-ID conflict. Not an authentication failure; no repair attempted. |
| `git diff --check`; `git diff --cached --name-only` | Passed; no staged files. |

## Limits and decisions

115 final focused tests pass. No full workspace suite, implementation commit, auth/config edit,
application restart, live model generation, or broad dependency/protocol upgrade was performed.
Astra's official ID is verified; this account's access is not. A live generation check and any
custom-model setting/application update require separate operator approval. Recommended default:
leave existing model defaults unchanged until account access is confirmed.

Shared typechecking has an unrelated intermittent module-resolution failure, despite a successful
unchanged retry. Existing lint warnings and installed-app quota resume conflicts remain out of scope.
