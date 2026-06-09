# TESTS

- `bun fmt`
- focused diff review: only the x64 runner changes in `.github/workflows/release.yml`
- `git ls-remote --tags origin v0.1.0` points at new commit
- `gh run list -R edgyarmati/gedcode --workflow=release.yml --limit 5` shows the new tag run
