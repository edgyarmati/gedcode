# Tasks

1. Preset contracts/defaults
   - Define Codex-native subagent roles, reasoning levels, structured role preset schema, and defaults.
   - Change `gedSubagentPreset` full and patch schemas from string to structured record.
   - Update Codex settings annotation from textarea to custom selector control.

2. Shared normalize/format helper
   - Add `packages/shared/src/gedSubagentPreset.ts`.
   - Export it through an explicit package subpath.
   - Cover defaulting/normalization and stable prompt formatting.

3. Server resolution
   - Use the structured helper to resolve instance-vs-global precedence.
   - Format the resolved structured preset before passing it to the workflow prompt.
   - Preserve non-Codex and disabled-subagent behavior.

4. Settings UI
   - Extend provider settings control typing.
   - Add a Codex Ged subagent preset picker component.
   - Wire exact provider-instance model metadata into the settings form where available.
   - Changing a model/reasoning row writes the expected structured `gedSubagentPreset` value.

5. Verification cleanup
   - Update focused tests/docs affected by the control/default change.
   - Run required checks.
