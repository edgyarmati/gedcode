# TESTS: Theme Refresh

Required checks:

```sh
bun fmt
bun lint
bun typecheck
```

Focused verification:

- Legacy `t3code:theme=light` resolves to Gruvbox Light.
- Legacy `t3code:theme=dark` resolves to Gruvbox Dark.
- New Light/Dark, Gruvbox Light/Dark, Midnight, and Dracula can be selected and persisted.
- `system` remains stored as `system` and follows OS preference.
- Dark concrete themes set `.dark` and `data-theme`; light concrete themes clear `.dark`.
- Desktop bridge receives only `light`, `dark`, or `system`.
- Initial HTML boot script sets matching theme markers before React loads.

Additional review acceptance checks:

- Valid v2 storage wins over legacy storage.
- Invalid v2 falls back to valid legacy, otherwise `system`.
- `system` sets `data-theme` to concrete `light`/`dark`, never `system`.
- Terminal color refresh path reacts to `data-theme` mutations.
