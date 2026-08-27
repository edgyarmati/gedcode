# Retire Orchestrator Release Gating

## Goal

Remove GedCode's dedicated Orchestrator release-task, release-approval, and GitHub Actions dispatch
path. An explicit operator request to the PM may use the PM's ordinary shell access to invoke an
existing repository workflow with `gh`; GedCode must not require a second internal release task or
approval gate.

## Constraints

- Keep `.github/workflows/release.yml`, `release.sh`, release documentation, artifact generation,
  signing, Sparkle publishing, and all other repository-owned release automation unchanged.
- Do not expose tools or prompts that create release tasks, request release gates, or dispatch a
  workflow through an Orchestrator actuator.
- Preserve decoding, projection, persistence, and read-only UI presentation of historical release
  tasks, gates, and dispatch records so databases from every published version still open.
- Preserve migration 053 and its historical release-dispatch column.
- Existing legacy release tasks must remain cancellable, archivable, restorable, and deletable, but
  cannot start new work, request a new release gate, or dispatch a workflow.
- Existing project configuration that mentions the retired `release` task type must not make the
  project unusable during upgrade.
- Keep feature-task identity/idempotency stable across the removal.
- Do not automatically mutate, archive, or delete existing user tasks during migration.

## Acceptance Criteria

1. The default task-type registry and PM playbook resources expose only the `feature` task type.
2. PM/MCP tool schemas no longer expose `releaseSourceTaskId`, `requestReleaseApproval`, or
   `dispatchRelease`; generic approval accepts only active plan/land gates.
3. The PM system prompt explicitly treats a current human request as authorization to run an
   existing GitHub Actions workflow through ordinary shell/`gh` access and forbids inventing an
   Orchestrator release task or gate.
4. Creating, classifying, or starting new work for a `release` task is rejected as a retired task
   type, and legacy release-dispatch commands cannot cause external side effects.
5. Historical release event contracts, projection state, migration 053, and legacy UI status remain
   readable and pass published-release compatibility fixtures.
6. Existing configuration containing task type `release` is tolerated for upgrade compatibility;
   genuinely unknown task types remain rejected.
7. `.github/workflows/release.yml`, `release.sh`, and the release publication implementation are
   unchanged.
8. Focused tests, `bun fmt`, `bun lint`, and the server/web typechecks pass, and `CHANGELOG.md`
   documents the retirement under `## Unreleased`.
