---
name: sync-upstream
description: Sync local main from upstream t3code, then rebase the gedcode branch onto the updated main. User-triggered only.
disable-model-invocation: true
---

Sync the fork with upstream t3code and rebase the working branch.

## Steps

1. Fetch upstream: `git fetch upstream`
2. Switch to main: `git checkout main`
3. Fast-forward main: `git merge --ff-only upstream/main`
4. Switch back to gedcode: `git checkout gedcode`
5. Rebase onto updated main: `git rebase main`

## On Conflict

If the rebase has conflicts, stop and report the conflicting files. Do not auto-resolve — let the user decide how to handle each conflict.

## After Success

Report how many commits were pulled from upstream and confirm gedcode is rebased. Remind the user to `git push --force-with-lease origin gedcode` if they want to update the remote.
