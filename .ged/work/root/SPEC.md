# Spec

## Goal

Review and polish release-facing documentation so it matches the current GedCode repository before release, and leave exactly one obvious screenshot placeholder for the user to fill later.

## Scope

In scope:

- Update `README.md` for release-ready introductory copy, provider doc links, and one screenshot placeholder.
- Rewrite `docs/release.md` around the current `.github/workflows/release.yml`.
- Update `REMOTE.md` stale SSH launch storage paths.
- Sync `KEYBINDINGS.md` with `packages/shared/src/keybindings.ts` and `packages/contracts/src/keybindings.ts`.
- Update `docs/observability.md` stale schema path and metric list.
- Add an OpenCode provider guide under `docs/providers/` because OpenCode is implemented and advertised.
- Clean broken absolute links in `docs/effect-fn-checklist.md` without changing its checklist semantics.

Out of scope:

- Changing release workflows, provider behavior, source code, or release scripts.
- Editing historical planning material under `docs/superpowers/*`.
- Renaming real identifiers that still exist, including `@t3tools/*`, `T3CODE_*` env vars, `app.t3.codes`, `/__t3code/channel`, and `t3code_web_channel`.
- Creating real screenshot assets.

## Source Of Truth

- Release workflow: `.github/workflows/release.yml`.
- Keybinding defaults: `packages/shared/src/keybindings.ts`.
- Keybinding command/schema definitions: `packages/contracts/src/keybindings.ts`.
- Trace record types: `packages/shared/src/observability.ts`.
- Metrics definitions: `apps/server/src/observability/Metrics.ts`.
- Provider support: server provider drivers and settings for Codex, Claude, and OpenCode.

## Screenshot Placeholder

Add exactly one placeholder in `README.md` after the product description and before installation. The placeholder must be a Markdown comment rather than a broken image link, so the public README does not render missing media before the user adds the screenshot.

## Risks

- Overpromising nightly, hosted web, or OIDC release automation that the workflow does not currently run.
- Advertising OpenCode without enough setup details for a first-release user.
- Accidentally changing historical planning docs or real legacy identifiers.
- Leaving multiple screenshot placeholders or a visible broken image.
