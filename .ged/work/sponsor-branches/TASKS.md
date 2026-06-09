# Tasks: GitHub Sponsor option and branch cleanup

1. Verify GitHub Sponsor option
   - Check `.github/FUNDING.yml` exists.
   - Ensure it configures `github: [edgyarmati]`.
   - Do not add app UI.

2. Verify repository checks if files changed
   - Run `bun fmt`.
   - Run `bun lint`.
   - Run `bun typecheck`.

3. Delete branches
   - Switch to `main` if not already on it.
   - Delete all local branches except `main`.
   - Delete all `origin` remote branches except `main`/`HEAD`.
   - Do not touch `upstream`.

4. Verify branch cleanup
   - Confirm local branches only include `main`.
   - Confirm origin remote branches only include `origin/main` and `origin/HEAD`.
