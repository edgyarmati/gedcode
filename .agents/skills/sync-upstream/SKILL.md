---
name: sync-upstream
description: Rebase the Ged commits on main onto the latest upstream t3code main. User-triggered only.
---

Pull upstream T3 Code and replay the Ged layer on top of it.

## Layout

`main` is upstream's `main` plus a small number of **purely additive** Ged commits. There is no
separate working branch.

| Remote     | Points at                             |
| ---------- | ------------------------------------- |
| `origin`   | `edgyarmati/gedcode` — ours           |
| `upstream` | `pingdotgg/t3code` — read-only source |

## Steps

```sh
git fetch upstream
git status --porcelain          # must be clean before starting
git rebase upstream/main
```

Then re-run the narrow checks for anything that looks affected — see the
[verify](../verify/SKILL.md) skill. Do not run repo-wide checks.

## `pnpm-lock.yaml` is the one conflict you may resolve

It is generated, so there is nothing to merge by hand:

```sh
git checkout --ours pnpm-lock.yaml   # mid-rebase, --ours is upstream's side
vp i                                 # our pnpm-workspace.yaml re-drops apps/mobile
git add pnpm-lock.yaml
```

Then confirm the workspace still reports 32 projects and that `apps/mobile` is absent.

## On any other conflict

**Stop and report the conflicting files. Do not auto-resolve.**

A conflict here is a signal worth taking seriously, not just a chore. The Ged layer modifies a
deliberately short list of upstream files and no more — the table in [STANDARDS.md](../../../.ged/STANDARDS.md) is the whole
list, and keeping it that short is the constraint the re-land was built around (see
`.ged/DECISIONS.md`). A conflict in any other file means either an upstream file was modified when a
new file would have done, or upstream has started using a path we claimed. Report which, and let the
user decide.

A conflict in `knip.jsonc` usually means upstream added an export whose only consumer is the Expo
app. Add the file to the scoped `ignoreIssues` blocks; do not widen them to a whole package.

## After success

Report how many commits came from upstream and confirm the Ged commits replayed cleanly. Re-verify
anything the orchestrator depends on — the mechanism inventory in `.ged/ORCHESTRATION.md` §2 is
explicitly marked load-bearing and re-check-after-merge, since the delegation design rests on
behavior that upstream could change without notice.

Pushing is the user's call: `git push --force-with-lease origin main`.
