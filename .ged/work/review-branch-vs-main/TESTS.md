# TESTS: Branch review versus main

Required unless impossible, with any failure/skip documented:

```sh
bun fmt:check
bun lint
bun typecheck
git diff --check main...HEAD
```

Desirable full suite:

```sh
bun run test
```

Never run `bun test`.

If full tests are too slow or environment-constrained, run focused suites for changed orchestration/provider/server-runtime, desktop settings/identity, shared schema/json/git utilities, web composer/model selection, source-control/shell behavior, and affected package tests, then document skipped coverage.
