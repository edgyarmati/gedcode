# Fix Codex Preset Legacy String Decode

## Goal

Fix settings decode breakage for users with old persisted Codex `gedSubagentPreset` values stored as multiline strings after the field changed to a structured object.

## Approach

- Keep canonical runtime/persisted `gedSubagentPreset` as the structured object.
- Add decode compatibility in `packages/contracts/src/settings.ts` so legacy strings decode into the structured preset.
- Accept current structured object shape and legacy multiline string shape.
- Encode canonically as structured object, not string.

## Legacy parsing

- Blank string falls back to default preset.
- Parse lines like `ged-explorer: model=gpt-5.4-mini, reasoning=medium`.
- Preserve parseable role lines and default missing/unparseable roles.
- Invalid reasoning defaults for that role rather than failing all settings.
- No broad redesign of the picker or prompt flow.
