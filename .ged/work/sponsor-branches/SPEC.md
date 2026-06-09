# Spec: GitHub Sponsor option and branch cleanup

## Goal

Ensure the repository has the GitHub-native Sponsor option and delete every local branch and every `origin` remote branch except `main`.

## Scope

- GitHub Sponsors repository configuration only.
- Local branch deletion, preserving `main` and not deleting the currently checked out branch until switched away.
- Remote branch deletion only on `origin`, preserving `origin/main` and `origin/HEAD`.

## Non-goals

- Do not add an in-app Sponsor button/icon.
- Do not touch `upstream` branches.
- Do not run `bun test`; use `bun run test` only if tests become necessary.

## Implementation notes

- Verify `.github/FUNDING.yml` exists and includes the intended GitHub Sponsors account.
- Generate deletion candidates from git refs and delete in loops/batches to handle many branches safely.
