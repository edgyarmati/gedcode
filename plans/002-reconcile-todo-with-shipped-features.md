# Plan 002: TODO.md reflects only genuinely-unbuilt work

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If a
> STOP condition occurs, stop and report — do not improvise. When done, update
> this plan's row in `plans/README.md` unless a reviewer told you they maintain
> the index.
>
> **Drift check (run first)**: `git diff --stat 65e913c7..HEAD -- TODO.md apps/web/src/components/Sidebar.logic.ts apps/web/src/hooks/useThreadActions.ts apps/web/src/components/ChatView.tsx`
> If any in-scope/evidence file changed, re-confirm the "Current state"
> excerpts before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `65e913c7`, 2026-06-13
- **Issue**: https://github.com/edgyarmati/gedcode/issues/9

## Why this matters

`TODO.md` is the strongest stated-intent signal a contributor (human or agent)
reads to find work. It currently lists 6 items, but **5 of them are already
implemented**. Someone picking up "thread archiving" or "scroll to bottom"
would re-implement shipped features, and the one genuinely-unstarted item
(message queueing) is hidden among false ones. Pruning the shipped items makes
the real backlog honest. This plan only edits `TODO.md`; it does not add or
change any feature.

## Current state — proof each item is already shipped

`TODO.md` today:

```
## Small things
- [ ] Submitting new messages should scroll to bottom
- [ ] Only show last 10 threads for a given project
- [ ] Thread archiving
- [ ] New projects should go on top
- [ ] Projects should be sorted by latest thread update

## Bigger things
- [ ] Queueing messages
```

Evidence that 5 of the 6 are done (verified by reading the code at `65e913c7`):

1. **Scroll to bottom on submit** — DONE. `apps/web/src/components/ChatView.tsx`
   `onSend` (line 2677) calls `await legendListRef.current?.scrollToEnd?.({ animated: false })`
   at line 2814 ("Scroll to the current end _before_ adding the optimistic
   message"), and `onSubmitPlanFollowUp` does the same at line 3212. There is a
   `showScrollToBottom` affordance and `isAtEndRef`/`maintainScrollAtEnd`
   pinning.
2. **Only show last N threads per project** — DONE.
   `apps/web/src/components/Sidebar.logic.ts` `selectVisibleSidebarThreads`
   (around line 418) slices threads to `previewLimit` with a hidden-threads /
   show-more mechanism (`threads.slice(0, previewLimit)` at line 435).
3. **Thread archiving** — DONE. `apps/web/src/hooks/useThreadActions.ts`
   `archiveThread`/`unarchiveThread` (line 61, exported at 290–291) dispatch the
   `thread.archive` command (line 77). The command + event exist in contracts:
   `packages/contracts/src/orchestration.ts` `ThreadArchiveCommand` (line 516),
   `thread.archived` event (line 793).
4. **New projects on top** & 5. **Projects sorted by latest thread update** —
   DONE. `apps/web/src/components/Sidebar.logic.ts` `sortProjectsForSidebar`
   (line 506) supports `updated_at` / `created_at` / `manual` ordering.

Genuinely unbuilt: **Queueing messages** — confirmed net-new (a separate plan,
015, designs it). `grep -rn "messageQueue|enqueue user|queuedMessage"` over web
finds only the optimistic-send buffer and server command/terminal workers, no
user-message queue.

## Commands you will need

| Purpose      | Command             | Expected on success |
| ------------ | ------------------- | ------------------- |
| Format check | `bun run fmt:check` | exit 0              |

## Scope

**In scope**: `TODO.md` only.

**Out of scope**: every code file named in "Current state" — they are evidence,
not edit targets. Do NOT "improve" any shipped feature here. Do NOT implement
message queueing (that is plan 015).

## Git workflow

- Branch: `advisor/002-reconcile-todo`
- One commit: `docs: prune shipped items from TODO.md`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Re-confirm each "done" claim before deleting it

For each of the 5 items, open the cited file:line and confirm the code matches
the "Current state" description. This guards against the list being stale in the
other direction.

**Verify**: each of these greps returns ≥1 match:

- `grep -n "scrollToEnd" apps/web/src/components/ChatView.tsx`
- `grep -n "selectVisibleSidebarThreads\|previewLimit" apps/web/src/components/Sidebar.logic.ts`
- `grep -n "archiveThread" apps/web/src/hooks/useThreadActions.ts`
- `grep -n "sortProjectsForSidebar" apps/web/src/components/Sidebar.logic.ts`

If any returns nothing, that item may NOT be shipped — see STOP conditions.

### Step 2: Rewrite TODO.md to keep only unbuilt work

Replace the file body so that the 5 confirmed-shipped items are removed. Keep
"Queueing messages". Result should be:

```
# TODO

## Bigger things

- [ ] Queueing messages
```

(If you prefer to preserve a record, you may instead add a `## Done` section
listing the 5 shipped items as checked `- [x]`, but the simplest correct
outcome is to delete them. Pick one; do not leave them unchecked under "to do".)

**Verify**: `grep -c "\[ \]" TODO.md` → 1 (only the queueing item remains unchecked).

### Step 3: Format

**Verify**: `bun run fmt:check` → exit 0.

## Test plan

No code tests (docs-only). Verification is the greps in Steps 1–2 plus
`bun run fmt:check`.

## Done criteria

- [ ] `TODO.md` contains exactly one unchecked item, "Queueing messages" (`grep -c "\[ \]" TODO.md` = 1)
- [ ] None of the 5 shipped items remain as open TODOs (`grep -iE 'scroll to bottom|last 10 threads|thread archiving|projects.*(top|sorted)' TODO.md` returns nothing, OR they appear only under a `## Done` section as `[x]`)
- [ ] `bun run fmt:check` exits 0
- [ ] Only `TODO.md` is modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- Any Step 1 grep returns no match — the feature may not actually be shipped, so
  do not delete that TODO item; report which one and stop.
- `TODO.md` already differs substantially from the "Current state" excerpt.

## Maintenance notes

- Keep `TODO.md` honest: when a feature ships, remove its TODO line in the same
  PR. The reviewer should reject PRs that implement a TODO item without removing
  it from this file.
- "Queueing messages" is intentionally left; plan 015 is its design spike.
