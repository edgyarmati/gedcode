# Codex 0.149.1 compatibility and verified Astra selection

## Goal and clarified contract

Diagnose current Codex failure read-only; fix evidence-based integration incompatibility and support
OpenAI's verified GPT-6 Astra ID without claiming account access. The parent checkpointed all prior
changes as `50ded1b5e`; this task is the sole writer and must not stage or commit implementation.
Existing root work artifacts concern completed release-gating work and are preserved; this work uses
`codex-astra-compat` instead.

## Evidence (2026-09-08)

- `/opt/homebrew/bin/codex --version`: `codex-cli 0.149.1`; `codex login status`: ChatGPT login.
- Isolated private temporary CODEX_HOME copied auth/config, no cached catalog. App-server initialize,
  account/read (`refreshToken: false`), model/list (including hidden), skills/list succeeded. Original
  auth/config content hashes unchanged; disposable process/home cleaned up. No turn or tools run.
- Actual account plan `self_serve_business_prolite` fails the repository decoder at
  `["account"]["planType"]`. Initialize and model/list payloads decode successfully. Provider probe
  calls account/read before model discovery, making this a provider-wide blocker.
- Installed experimental JSON schema lists five new PlanType values: self_serve_business_prolite,
  ent26, enterprise_cbp_automation, edu_plus, edu_pro. Keep a closed enum, updating all occurrences.
- https://developers.openai.com/codex/models lists Astra with `codex -m gpt-6-astra`.
  https://developers.openai.com/api/docs/models/gpt-6-astra also confirms the ID (both HTTP 200).
- Fresh authenticated catalog lists GPT-5.6 Sol/Terra/Luna, GPT-5.5, GPT-5.4-Mini, and hidden
  GPT-Reserve/Codex Auto Review, not Astra. PI_MODEL is not proof of this Codex account's access.
- Read-only installed app logs show repeated historical quota-stage resume command-ID conflicts;
  these are a separate issue, not evidence of an auth problem, and will not be changed here.

## Bounded implementation

1. Add reproducible narrow PlanType schema compatibility updates for installed 0.149.1, cover
   account/read and rate-limit/account notifications, and map verified plan values to auth labels.
2. Preserve dynamic model discovery/custom-model behavior; support the explicit `astra` alias for
   verified `gpt-6-astra`, test exact ID propagation through model discovery/custom selection and
   thread/turn requests. Do not change defaults or inject Astra into an account catalog.
3. Add release note, run focused regressions and required checks, record diagnosis and limits.

## Constraints and acceptance

- No changes to user auth/config, apps, database, releases, dependencies, or unrelated runtime errors.
- No fallback/degraded paths or guessed IDs, no full workspace tests, no staging/commit.
- Closed account schemas accept precisely the installed PlanType variants; regenerated schemas retain
  this narrow compatibility update; supported old plans still work and invalid types still fail.
- Provider probe recognizes the observed authenticated account instead of a schema error.
- Explicit Astra IDs/alias are preserved end-to-end; catalog capabilities remain authoritative.
- Focused tests, fmt/lint, relevant package typechecks run; unrelated baseline failures documented.
- End with structured acceptance report. Account-level Astra generation remains unverified pending
  approval for a live request or availability in the account catalog; no silent substitute.
