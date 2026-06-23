# TASKS

Dependency-ordered. Ownership: **[impl]** = implementation-heavy agent's lane,
**[ux]** = decision/reasoning/UX lane. Each WP becomes a GitHub sub-issue of #51.

## WP-P1 — Contracts (schema-only) [impl] — foundational, gates everything

- [x] P1.1 Add `review`, `verify` to `OrchestrationStageRole`; add `reviewing` to
      `OrchestrationTaskStatus` (`verifying` already present). Verify: contracts typecheck.
- [x] P1.2 Replace `GedRoleModelSelections` `Record<string,_>` with a stage-role-keyed struct
      (keys ∈ the role union; unknown keys rejected at decode). Verify: decode test rejects a
      typo'd key.
- [x] P1.3 Add the per-task `roleModelSelections` override field to the Task aggregate; add the
      `task.role-selections.set` command + `task.role-selections-updated` event schemas
      (origin ∈ human|client). Verify: schema round-trip test.
- [x] P1.4 Add the project per-role prompt-prefix config map (stage-role-keyed, optional).
      Verify: decode test.
- [x] P1.5 Define the durable stage-history snapshot/read-model shape keyed by `stageThreadId`
      (role, providerInstanceId/model, status, startedAt/endedAt, taskId, projectId). Verify:
      schema compiles; snapshot type includes it.

## WP-P2 — Decider + projector + stageResolution + persistence [impl] — the core

- [x] P2.1 Role→status mapping (`review`→`reviewing`, `verify`→`verifying`) in decider
      `stage.start`; extend `activeStageRoleForTaskStatus`. Verify: unit tests per role.
- [x] P2.2 `review`/`verify` `stage.complete` behaves like `classify`/`plan` (hold status, clear
      current, settlement re-prompts PM). Verify: decider + settlement test.
- [x] P2.3 Model-selection resolution precedence `task ?? project ?? default` at `stage.start`.
      Verify: resolution unit test across all three layers.
- [x] P2.4 `task.role-selections.set` decider case + **origin=human/client invariant** (reject
      pm-runtime/system); engine command-classification + aggregate routing. Verify: adversarial
      test that a PM-origin set is rejected.
- [x] P2.5 Projection persistence: migration (new derived table) + repository for task-level
      overrides and the durable stage-history rows; projector writes a stage-history row on
      `stage-started`/`-completed`/`-blocked`. Verify: projection test + restart replay.
- [x] P2.6 Prepend the per-role prompt prefix at `stage.start` **exactly once**, including the
      quota-resume path that reuses original stage instructions (persist/recover raw
      instructions or mark prepared). Verify: regression test — quota-resumed stage is not
      double-prefixed.

## WP-P3 — PM tools + handoff [impl]

- [x] P3.1 Extend `handoffWorker` role enum to `review`/`verify` with tool-description guidance.
      Verify: tool schema test; PM can dispatch each role.
- [x] P3.2 Confirm settlement + `StageResultBuilder` are role-agnostic for the new roles; minimal
      PM system-prompt seed naming the new roles. Verify: settlement test for a `verify` result.

## WP-P4 — WS + read-model surfacing [ux]

- [x] P4.1 Project snapshot + streamed events carry the durable stage history (role+backend+
      status+timestamps) + the project/task selection config. **Done** in the baseline
      (`22c17fe69`); stage-started now also carries resolved backend/model (`0274474c9`).
- [x] P4.2 WS mutation methods / typed client helpers for the project per-role editor, the
      per-role prompt-prefix editor, and the per-task override. Verify: method round-trip test.
      **Project editor: no new method needed** — `project.meta.update` is already in the
      `ClientOrchestrationCommand` union, so P6.1/P6.2 dispatch through the generic
      `api.orchestration.dispatchCommand`. **Per-task override done [impl]**:
      `task.role-selections.set` is deliberately excluded from `ClientOrchestrationCommand`
      (task-level human mutations use dedicated, server-validated RPCs — see
      `orchestrator.resolveGate`), so `orchestrator.setTaskRoleSelections` now mirrors
      `resolveGate`: the server stamps `origin: "human"` + `createdAt`, dispatches through the
      decider, and the typed `wsRpcClient` + `environmentApi` helpers expose the method.

## WP-P5 — Web: stage-timeline [ux]

- [x] P5.1 Store slice + selectors for durable stage history per task (apply snapshot + streamed
      updates). **Done** (`0274474c9`): `stageHistoryByTaskId` slice + `selectTaskStageHistoryByRef`,
      seeded from snapshots + live from stage events. Required the stage-started event to carry the
      resolved backend/model (chosen design: "carry it on the event") since the web subscription is
      snapshot-once-then-events; decider stamps it, both projectors prefer it with a re-derivation
      fallback for older events.
- [x] P5.2 Stage-timeline component rendering each stage's role + backend + live status. **Done**
      (`2597c709b`): `StageTimeline` on the task rail; pure `buildStageTimelineRows` projection
      unit-tested; thin renderer using the Badge + rail-panel conventions.

## WP-P6 — Web: configuration UI [ux]

- [x] P6.1 Project-settings per-role backend editor (role → instance picker, "use default").
      **Done**: `ProjectOrchestrationSettingsDialog` opened from the sidebar project context-menu
      item "Orchestration settings…"; per-role instance+model Selects (or "use project default");
      dispatches `project.meta.update` (origin client/human). Typo'd role impossible — the picker
      iterates `ORCHESTRATION_STAGE_ROLES` and the contract's role-keyed struct rejects unknown keys.
- [x] P6.2 Per-role prompt-prefix editor. **Done**: per-role Textarea in the same dialog; blank
      prefixes omitted, the rest trimmed; round-trip covered by `projectOrchestrationSettings.logic.test.ts`.
- [ ] P6.3 Per-task backend-override panel on task detail. Verify: override dispatches + reflects.
      **Unblocked by P4.2** — dispatch through `api.orchestrator.setTaskRoleSelections`; UI reuses
      the project editor's backend picker + the same draft logic, no prefixes.

## WP-P7 — E2E + restart-durability + gates [ux]

- [x] P7.1 E2E: `classify→plan→review→work→verify→land` incl. per-task override resolution +
      exactly-once prefixing. **Done**: `orchestratorPipeline.integration.test.ts` drives the full
      flow, verifies backend precedence (`task` override → project role → project default), rejects
      non-human role-selection updates in the live engine path, and proves prompt prefixes are
      applied once across quota block → quota-ok auto-resume.
- [x] P7.2 Restart-durability proof mid-stage (stage history + overrides survive). **Done**:
      the integration harness reopens the same root/db after a blocked work stage and proves durable
      stage history, per-task role overrides, task status, and quota-blocked rows replay before the
      resumed stage starts.
- [x] P7.3 Gates: CHANGELOG `## Unreleased`, `docs/upstream-decisions.md`, plan index. Verify:
      `bun fmt/lint/typecheck/run test` all green.
