# Spec

## Goal

Add an end-to-end Ged model-defaults mode so users can configure provider/model selections globally and override them per project for:

- main Ged/user threads;
- each Ged subagent role thread, starting with `ged-explorer`.

Ged subagents remain normal orchestration child threads with one singular role task/turn. Existing behavior must remain safe: if no role model override is configured, a role child keeps using the parent thread model.

## Scope

In scope:

- Contracts for Ged subagent roles and role model selections.
- Global settings schema/persistence for Ged model defaults.
- Per-project role model override contracts/projections/persistence.
- Shared pure resolver for main-thread and role model selection.
- `GedRoleInvocationService` resolves project/global role overrides before creating child threads.
- Web UI for global Ged model defaults.
- Web UI for per-project Ged model overrides.
- Tests for contracts, resolver, persistence/projections, server invocation, and focused UI behavior.

Out of scope:

- Adding roles beyond currently supported `ged-explorer`.
- Changing provider/session restart semantics.
- Replacing existing per-turn model overrides.
- Large model picker redesign.
- Automatically invoking all Ged roles from every parent turn.

## Concepts

- **Main thread model default**: the default provider/model for normal user/Ged parent threads.
- **Role model default**: provider/model for a specific Ged subagent role.
- **Global default**: stored in server settings and applies everywhere unless overridden.
- **Project override**: stored with the orchestration project and beats global defaults for that project.
- **Existing thread model**: once a thread exists, its stored `modelSelection` remains authoritative for that thread unless a turn supplies a per-turn override.

## Proposed Contracts

Add a `GedSubagentRole` contract, initially only `ged-explorer`.

Add global server settings:

```ts
gedModelSelections: {
  mainThread: ModelSelection | null;
  roles: Partial<Record<GedSubagentRole, ModelSelection>>;
}
```

Add project-level role overrides:

```ts
roleModelSelections: Partial<Record<GedSubagentRole, ModelSelection>>;
```

Keep existing `OrchestrationProject.defaultModelSelection` as the per-project main-thread override. `null` means inherit the global main-thread default.

## Resolution Order

Main-thread selection for new/draft threads:

1. Existing persisted thread `modelSelection` when editing/continuing an existing thread.
2. Per-project `defaultModelSelection`.
3. Global `settings.gedModelSelections.mainThread`.
4. Existing app fallback/default model.

Per-turn `thread.turn.start.modelSelection` remains an explicit override for that turn.

Role/subagent selection:

1. Project `roleModelSelections[role]`.
2. Global `settings.gedModelSelections.roles[role]`.
3. Parent thread `modelSelection`.
4. Project `defaultModelSelection`.
5. Global `settings.gedModelSelections.mainThread`.
6. Existing app fallback/default model.

The parent-thread fallback preserves current behavior when no role override exists.

## Server Behavior

`GedRoleInvocationServiceLive` must:

- read server settings;
- read parent thread and project shell/detail;
- resolve the effective role model using the shared resolver;
- use the resolved model in child `thread.create` and child `thread.turn.start`;
- include the resolved model in the explorer prompt context;
- continue emitting one child thread, two linkage activities, and one child turn;
- continue forcing `runtimeMode: "approval-required"`, `interactionMode: "default"`, and `gedWorkflowEnabled: false`.

## Web Behavior

Global settings UI should add a Ged model defaults section near the existing Ged workflow toggle:

- main thread model default;
- explorer role model default;
- clear/reset controls.

Project UI should add a minimal project model override control:

- project main-thread override writes `project.meta.update.defaultModelSelection`;
- explorer override writes `project.meta.update.roleModelSelections`;
- clear removes the override and shows inherited state.

New/draft main thread model selection should respect project/global main defaults without changing existing persisted thread behavior.

## Compatibility

- Legacy settings decode to `gedModelSelections: { mainThread: null, roles: {} }`.
- Legacy projects decode/project to `roleModelSelections: {}`.
- Existing threads and turns continue to use their stored/explicit model selections.
- Provider availability is not preflighted by the resolver; existing provider UI normalization and provider runtime errors remain responsible for unavailable instances/models.

## Critique Clarifications

- Settings patching for `gedModelSelections.roles` must use whole-map replacement so clearing a role cannot leave stale keys.
- Project `roleModelSelections` updates must replace the whole map, not merge role keys. Clearing `ged-explorer` means dispatching a map without that key.
- New projects must default `defaultModelSelection` to `null` unless the user explicitly sets a project main-thread override. Bootstrap/new-thread creation should resolve project/global/fallback model at thread creation time instead of persisting a hardcoded project override.
- Main-thread integration must cover visible draft model selection, new thread create/bootstrap command payloads, plan implementation thread creation, and server startup/bootstrap thread creation paths.
- The role resolver accepts optional parent model for defensive reuse, but `GedRoleInvocationService` normally supplies parent thread model; parent fallback intentionally preserves current behavior.
