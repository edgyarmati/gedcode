# Tests: GitHub Sponsor option and branch cleanup

## Required checks

If source/config files changed:

- `bun fmt`
- `bun lint`
- `bun typecheck`

## Manual acceptance

- `.github/FUNDING.yml` contains `github: [edgyarmati]`.
- GitHub repo can render its native Sponsor button from funding config.
- `git branch --format='%(refname:short)'` shows only `main` locally.
- `git branch -r` shows only `origin/HEAD`, `origin/main`, and any untouched non-origin remote branches.
