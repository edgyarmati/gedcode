# SPEC

## Goal

Backport the accepted SSH command diagnostics behavior from upstream commit `f5849f7d`.

## Scope

- Include redacted stdout on `SshCommandError` for non-zero SSH command exits.
- Prefer stderr for user-facing error messages, but fall back to redacted stdout when stderr is empty.
- Redact token-like JSON fields in surfaced stdout and cap diagnostic output length.
- Add focused SSH command tests for stdout fallback and redaction.
- Update changelog and upstream decision bookkeeping.

## Non-Goals

- Do not change SSH tunnel JSON parsing or pairing behavior outside shared command error reporting.
- Do not change auth prompting or SSH command arguments.
- Do not address unrelated desktop/source-control backlog items in this slice.

## Acceptance Criteria

- Failed SSH commands with empty stderr expose useful, redacted stdout diagnostics.
- Existing timeout, spawn, and success behavior remains unchanged.
- Focused SSH tests pass.
- Required repository checks pass.
- Completed upstream item is removed from the desktop/SSH/source-control backlog entry.
