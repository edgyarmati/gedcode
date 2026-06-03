# Verification Commands

- `git status --short --branch`
- `git remote -v`
- `git log -1 --oneline --decorate`
- `git tag --list 'v0.1.0'`
- `git diff --check origin/main...HEAD`
- `node --version`, `bun --version`, package manager/engines/mise checks
- `bun install --frozen-lockfile`
- `bun run fmt:check`
- `bun lint`
- `bun typecheck`
- `bun run test`
- `bun run build`
- `bun run release:smoke`
- grep tracked files for release/rebrand leftovers
- optional host/credential-dependent checks: desktop build/smoke, `npm view`, remote tag lookup, CLI/server smoke

Never run `bun test`; use `bun run test`.
