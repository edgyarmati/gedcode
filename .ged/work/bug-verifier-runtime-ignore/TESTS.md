# Tests

## Focused test cases

Shared path helper:

- `.ged/runtime/root/checkpoints.json` => dot directory
- `.git/index` => dot directory
- `src/.cache/state.json` => dot directory
- `C:\repo\.ged\runtime\root\checkpoints.json` => dot directory
- `src/app.ts` => not dot directory
- `.env` => not inside dot directory
- `.gitignore` => not inside dot directory
- `src/.env` => not inside dot directory

Reactor predicate / behavior:

- `item.completed` + `file_change` + `.ged/runtime/root/checkpoints.json` skips invalidation.
- `item.completed` + `file_change` + `.git/index` skips invalidation.
- Dot-directory path in nested `payload.data.item.path` skips invalidation.
- Normal path in `payload.detail` invalidates.
- Normal path in nested `payload.data.input.file_path` invalidates.
- Mixed paths like `[".ged/runtime/root/checkpoints.json", "src/app.ts"]` invalidate.
- No path candidates invalidates.
- Non-`file_change` item events remain ignored.

## Focused commands

```sh
bun run test packages/shared/src/path.test.ts
bun run test apps/server/src/gedWorkflow/Layers/GedWorkflowEventReactor.test.ts
```

## Required repo gates

```sh
bun fmt
bun lint
bun typecheck
```

## Additional plan-review tests

- Dot-dir-only events short-circuit before session lookup/checkpoint I/O.
- `payload.detail` prose or multiline text fails safe and invalidates.
- Dot-dir path in `detail` plus normal source path in nested `data` invalidates.
- Realistic nested containers with explicit path keys are covered, including `item.path`, `input.file_path`, old/new path pairs, and arrays of file paths.
- Reactor-level hidden-file cases (`.env`, `.gitignore`, `src/.env`) invalidate.
