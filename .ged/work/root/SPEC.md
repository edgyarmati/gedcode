# Spec: Fork-owned hosted pairing domain

## Goal

GedCode should support the hosted web pairing flow on a fork-owned domain instead of requiring T3 Code's `https://app.t3.codes` router domain.

## Current Findings

- `REMOTE.md` describes `https://app.t3.codes` as the hosted web app that can consume pairing URLs.
- Hosted pairing does not proxy backend traffic. The browser saves a remote environment from `/pair?host=...#token=...` and connects directly to the backend URL.
- `apps/web/src/hostedPairing.ts` already supports `VITE_HOSTED_APP_URL` for generated hosted pairing links and hosted-static detection, but defaults to `https://app.t3.codes`.
- `apps/web/vercel.ts` hard-codes the router host, channel cookie, and latest/nightly origins to T3 Code domains.

## Requirements

- Preserve existing behavior for deployments that still use the T3 defaults.
- Allow a fork deployment to configure its hosted router host and latest/nightly origins without source edits.
- Keep pairing tokens in the URL hash for generated hosted links.
- Document how the hosted app works and how a GedCode/fork deployment points links at its own hosted web app.
- Add focused regression coverage for configurable hosted URL behavior.
- Update `CHANGELOG.md` under `## Unreleased`.

## Non-Goals

- Do not add a backend proxy or tunnel service.
- Do not make plain HTTP LAN endpoints work from an HTTPS hosted page.
- Do not redesign remote environment management UI.
