# Changelog

Release notes are grouped by released version. Add a `## X.Y.Z` section before running
`./release.sh stable ...` or `./release.sh nightly ...`.

## Unreleased

- Ged workflow
  - Scope runtime checkpoints to each thread and guard checkpoint ownership.
  - Enforce auto-escalation and surface more accurate workflow status phases.
  - Clarify in the workflow prompt that the harness/runtime may upgrade initially trivial tasks to non-trivial after observing scope.
  - Require native Codex Ged subagents to use the configured role model and reasoning presets when subagent tools are available.
  - Show the workflow badge only while the latest turn is running and hide it while chat is idle.
- Release and packaging
  - Add release wrapper scripts and packaged-dev desktop identity metadata.
  - Keep packaged dev out of live mode and allow nightly releases after a stable release.
  - Ignore `docs/research` in format and lint checks.
- Provider support
  - Expose the Claude Fable model.
