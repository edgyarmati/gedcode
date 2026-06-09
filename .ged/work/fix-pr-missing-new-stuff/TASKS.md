# TASKS

1. Baseline branch state
   - Confirm worktree state and fetch remotes.
   - Record current branch, PR branch head, main head, and sibling branch head.
   - Compare PR branch and sibling branch contents.

2. Integrate missing feature branch
   - Merge `origin/feat/ged-owned-workflow-orchestrator` into `feat/first-release-rebrand` unless inspection shows unrelated work.
   - Resolve conflicts preserving rebrand and orchestrator behavior.

3. Audit expected features
   - Confirm expanded theme presets are present and wired.
   - Confirm Ged subagent mode is present.
   - Confirm role prompt registry is present.
   - Confirm role invocation service is present.
   - Confirm role settings/model defaults are present.

4. Regression cleanup
   - Search for accidental legacy user-facing T3 strings introduced by merge.
   - Keep intentional internal `@t3tools/*` and compatibility identifiers.
   - Fix reconciliation failures only.

5. Update PR
   - Run verification.
   - Push `feat/first-release-rebrand` to update PR #7.
   - Report PR URL and verification results.

## Plan review safeguards

- Do not delegate this merge to workers; use a single integration owner.
- Protect branch state before push:
  - inspect `git status --porcelain`
  - do not force push
  - keep unrelated untracked `.ged/work/...` artifacts out of the implementation commit unless intentionally part of this work
- After integration, verify inclusion with `git merge-base --is-ancestor origin/feat/ged-owned-workflow-orchestrator HEAD` for a true merge, or document equivalent cherry-pick proof.
- Use `origin/main...HEAD` for diff checks after fetch.
- Verify migration numbering and focused touched areas: theme registry, Ged role prompts, role invocation service, workflow prompt/settings runtime mode, shared `gedModelSelection`, and composer/header Ged mode UI.
