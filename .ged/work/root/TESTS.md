# Tests

## Verification Plan

Required repository gates:

```sh
bun fmt
bun lint
bun typecheck
```

Targeted documentation checks:

```sh
rg -n '!\[GedCode workspace screenshot\]\(\./assets/screenshot/workspace\.png\)' README.md
rg -n 'docs/ged-workflow\.md' README.md
test -f docs/ged-workflow.md
! rg -n 'docs/superpowers' README.md docs/ged-workflow.md apps/marketing/src/pages/index.astro apps/marketing/src/layouts/Layout.astro
! rg -n 'hard-enforce|hard enforce|automatically enforces|guarantees correctness|child-thread|child thread' README.md docs/ged-workflow.md apps/marketing/src/pages/index.astro apps/marketing/src/layouts/Layout.astro
! rg -n 'Cursor' README.md apps/marketing/src/pages/index.astro apps/marketing/src/layouts/Layout.astro
```

Do not run `bun test`; use `bun run test` only if tests become necessary.

## Evidence

- `rg -n '!\\[GedCode workspace screenshot\\]\\(\\./assets/screenshot/workspace\\.png\\)' README.md`: passed; `README.md:5` contains the screenshot reference.
- `rg -n 'docs/ged-workflow\\.md' README.md`: passed; README links the public workflow guide.
- `test -f docs/ged-workflow.md`: passed.
- `rg -n 'docs/superpowers' README.md docs/ged-workflow.md apps/marketing/src/pages/index.astro apps/marketing/src/layouts/Layout.astro`: exit 1, no public links to historical planning docs.
- `rg -n 'hard-enforce|hard enforce|automatically enforces|guarantees correctness|child-thread|child thread' README.md docs/ged-workflow.md apps/marketing/src/pages/index.astro apps/marketing/src/layouts/Layout.astro`: exit 1, no overclaiming language in public surfaces.
- `rg -n 'Cursor' README.md apps/marketing/src/pages/index.astro apps/marketing/src/layouts/Layout.astro`: exit 1 after provider alignment; README and marketing release-facing copy now both name Codex, Claude, and OpenCode only.
- `bun fmt`: passed.
- `bun lint`: passed with existing warnings only.
- `bun typecheck`: passed.
- `file assets/screenshot/workspace.png`: confirms the README screenshot asset is a PNG at `3456 x 2156`.
- `view_image assets/screenshot/workspace.png`: inspected visually; it is a GedCode workspace screenshot.
- `ged-verifier`: passed release-facing content review after Cursor provider-copy alignment; remaining finding was to finalize `.ged/work/root/STATE.md` and `.ged/work/root/TASKS.md` before commit, which is now done.
