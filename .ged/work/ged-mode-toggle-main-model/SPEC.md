# Spec

## Goal

Make the composer Ged control an explicit thread-mode choice between:

- **Normal thread** (`gedWorkflowEnabled: false`)
- **Ged workflow** (`gedWorkflowEnabled: true`)

In Ged workflow mode, the composer model picker controls only the **main/parent thread model**. Ged subagent role models remain pre-set in existing Ged settings/project settings surfaces.

## Scope

- UI-only semantics around the existing `gedWorkflowEnabled` boolean.
- Keep server/contracts boolean-compatible.
- Do not implement additional subagent runtimes.
- Preserve global/project role model settings added previously.
- Build native client after verification so the user can inspect it.

## Design

- Replace the ambiguous Ged icon button with explicit mode copy: Normal thread vs Ged workflow.
- In compact composer controls, expose the same explicit mode state/action.
- Clarify copy that Ged workflow uses the selected composer model as the main thread model; role agents use presets from settings.
- Make composer fallback model resolution mode-aware where the user has not explicitly selected a model:
  - Normal thread uses normal app/project fallback.
  - Ged workflow uses resolved Ged main-thread fallback.
  - Explicit composer/thread model still wins.

## Non-goals

- No new server protocol enum.
- No role runtime beyond existing explorer behavior.
- No changes to role model resolution/presets beyond copy if needed.

## Acceptance details from plan review

- Model precedence must be explicit: composer draft picker selection > persisted thread model > mode-aware fallback.
- Normal mode fallback must not use `settings.gedModelSelections.mainThread` when no explicit selection exists.
- Ged workflow fallback must use resolved Ged main-thread selection when no explicit selection exists.
- Update every relevant composer/model-resolution path, including local draft thread construction and `ChatComposer` fallback props.
- Role model UI remains in global/project settings, never in the composer.
- Native client build must pass before commit/completion.
