# Verification Strategy

## Required Gates

```sh
bun fmt
bun lint
bun typecheck
```

If test coverage is part of the release-readiness review, run:

```sh
bun run test
```

Never run `bun test`.

## Git Evidence

Capture before/after cleanup:

```sh
git status --short --branch
git log -1 --oneline --decorate
git diff --stat
git diff --cached --stat
```

After final commits:

```sh
git status --short --branch
git log --oneline --decorate -5
```

## Final Report

Include command outcomes, commits created, blockers, risks, skipped checks, and recommendation: `Go`, `Go with risks`, or `No-go`.
