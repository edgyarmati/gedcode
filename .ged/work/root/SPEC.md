# SPEC

## Goal

Publish a stable GedCode `v0.1.2` release from the fixed commit so users receive macOS artifacts that are not reported as damaged.

## Requirements

- Add a `0.1.2` changelog section describing the macOS artifact fix.
- Ensure the local release wrapper dispatches GitHub Actions against `edgyarmati/gedcode`, not upstream `pingdotgg/t3code`.
- Run required local gates before dispatch.
- Dispatch the stable patch release workflow for `0.1.2`.
- Mark the broken `v0.1.1` release as superseded after `v0.1.2` is published.

## Non-Goals

- Do not reissue or mutate the `v0.1.1` tag as a new build.
- Do not add Apple notarization requirements while no Apple Developer membership exists.
