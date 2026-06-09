# SPEC: Include missing orchestrator features in PR #7

## Goal

Update existing PR #7 branch `feat/first-release-rebrand` so it contains both:

- the current rebrand/docs work already in the PR
- the missing orchestrator/theme/subagent work from `origin/feat/ged-owned-workflow-orchestrator`

Push the reconciled result back to the existing PR branch.

## Approach

- Start from `feat/first-release-rebrand`.
- Fetch latest branch refs.
- Confirm the sibling branch contains the expected missing feature work.
- Merge or otherwise integrate `origin/feat/ged-owned-workflow-orchestrator` into `feat/first-release-rebrand`.
- Resolve conflicts preserving both GedCode rebrand changes and orchestrator features.
- Run required checks and push the existing PR branch.

## Risks

- Merge conflicts could regress rebrand strings or overwrite newer docs.
- Sibling branch may contain stale changes relative to current PR branch/main.
- Contracts/server/web changes need coordinated validation.
