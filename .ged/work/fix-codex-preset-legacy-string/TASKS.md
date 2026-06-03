# Tasks

1. Contracts compatibility
   - Refactor strict structured preset schema internally.
   - Add legacy multiline string decoder in contracts.
   - Export compatibility `CodexGedSubagentPreset` with structured runtime type.
   - Use it for full settings and patch settings.

2. Tests
   - Add full settings legacy string decode test.
   - Add patch legacy string decode test.
   - Assert encode output remains structured.

3. Verification
   - Run focused contracts tests.
   - Run `bun fmt`, `bun lint`, `bun typecheck`.
