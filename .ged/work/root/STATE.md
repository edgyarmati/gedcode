# State

- **Phase**: implement
- **Epic**: #51 (Phase 3 — multi-stage roles + multi-backend); WP sub-issues #52+.
- **Active task**: WP-P6 (config editors). P4.1 + P5.1 (`0274474c9`), P5.2 (`2597c709b`),
  and P7 (full-pipeline + restart-durability integration proof) are done.
  Decision: project per-role editor lives behind a **sidebar context-menu item "Orchestration
  settings…" → Dialog** (mirrors the project-rename flow). Per-task override goes in the task header.
  Dispatch: project edits ride `project.meta.update` (roleModelSelections/rolePromptPrefixes, no
  createdAt); per-task override is `task.role-selections.set` (origin "human" + createdAt).
- **Status**: WP-P1–P3 engine foundation + #55 WS/store plumbing committed as baseline
  (`22c17fe69`), reviewed green (fmt/lint/typecheck/test/build). The WP-P2.6 verification gap
  (exactly-once prefix across quota-resume) is closed by `stageResolution.test.ts` (`4b2c4fdf6`).
  Remaining UX lane: P4.2 (WS mutation helpers for editors) and P6 (config editors).
- **Blockers**: None.
- **Next step**: P6 config editors, adding P4.2 WS mutation helpers as needed.

### Review note (other agent's foundation)

- Verdict: good job — all hard invariants correct + tested (PM-can't-set-config, no-silent-fallback,
  exactly-once prefix, append-only migration, durable stage-history, backend precedence).
- Optional engine-lane polish: (1) `task.stage-blocked` now updates `providerInstanceId` in the
  in-memory projector too (P7 parity fix); (2) stage-history model/instance are re-derived at
  projection rather than captured on `stage-started`.
