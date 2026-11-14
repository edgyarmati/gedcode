---
name: sync-upstream
description: Rebase the Ged commits on main onto the latest upstream t3code main. User-triggered only.
---

Merge upstream T3 Code into the Ged layer.

## Layout

`main` is upstream's `main` merged with a **mostly additive** Ged layer. Syncs are merges, never
rebases: the history `main` has already published stays as it is, and each sync is one merge commit.
Do the merge on a branch in its own worktree and land it through the normal review gate.

| Remote     | Points at                             |
| ---------- | ------------------------------------- |
| `origin`   | `edgyarmati/gedcode` — ours           |
| `upstream` | `pingdotgg/t3code` — read-only source |

## Steps

```sh
git fetch upstream
git status --porcelain                        # must be clean before starting
git worktree add ../gedcode-integrate -b integrate-upstream-<date> main
cd ../gedcode-integrate
git merge --no-ff --no-commit upstream/main
```

Then re-run the narrow checks for anything that looks affected — see the
[verify](../verify/SKILL.md) skill. Do not run repo-wide checks.

## `pnpm-lock.yaml` is the one conflict you may resolve

It is generated, so there is nothing to merge by hand:

```sh
git checkout --theirs pnpm-lock.yaml   # in a merge, --theirs is upstream's side
vp i                                   # our pnpm-workspace.yaml re-drops apps/mobile
git add pnpm-lock.yaml
```

Then confirm `apps/mobile` is absent from the installed workspace, and that any change in the
project count is explained by packages upstream added or removed.

## Conflicts in a listed seam

A file in the [STANDARDS.md](../../../.ged/STANDARDS.md) tables is one we modify on purpose, so a
conflict there is expected. Take upstream's version and re-apply our change on top of it, keeping
the diff against `upstream/main` as small as the table says. If upstream reshaped the code so much
that the old seam no longer fits (a renamed or deleted file, a moved concept), make the smallest
equivalent change and update the table row.

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

`.github/workflows/` never conflicts, because we do not edit upstream's workflows — the ones that
cannot run here are disabled in repository settings and ours lives in `ged-ci.yml`. If upstream
adds a workflow, it arrives **enabled**: check whether it can run here (Blacksmith runners and T3's
credentials cannot), and disable it with `gh workflow disable "<name>" --repo edgyarmati/gedcode`
rather than deleting the file. If upstream adds a check `ged-ci.yml` does not cover, say so — that
file is kept honest by hand.

## Before committing the merge

A clean merge is not finished. Upstream's new code can bring:

- **New hard-coded identity**, such as home directories, OS service names, origins, repository links
  and command names. Product prose ("T3 Code") is rewritten at packaging time by
  `scripts/ged/identity.ts`; identity constants are not, so set them in source and add the file to
  the identity table. Grep the added lines (`git diff <merge-base> upstream/main`) for `t3code`,
  `.t3`, `t3.codes`, `pingdotgg` and `com.t3tools`.
- **Toolchain bumps** that turn new diagnostics into errors in Ged code. Typecheck every package
  that holds Ged code (`t3`, `@t3tools/desktop`, `@t3tools/web`, `@t3tools/contracts`,
  `@t3tools/provider-core`, `@t3tools/client-runtime`, `@t3tools/scripts`).
- **Ged tests that pin upstream payloads**, such as `AgentContextBudget.test.ts`. Re-measure them,
  and check that any growth is upstream's own.

## After success

Report how many commits came from upstream and confirm the Ged layer survived the merge. Re-verify
anything the orchestrator depends on — the mechanism inventory in `.ged/ORCHESTRATION.md` §2 is
explicitly marked load-bearing and re-check-after-merge, since the delegation design rests on
behavior that upstream could change without notice.

Landing follows the normal review gate (`.ged/bin/land-gate.sh`). Pushing is the user's call, and
because syncs are merges it never needs force: `git push origin main`. A workflow upstream added
appears in `gh workflow list` only after that push, so disable the inapplicable ones then.
