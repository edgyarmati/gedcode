# Tasks

1. Baseline git state: branch, remotes, tags, working tree, diff check.
2. Audit version/toolchain/package metadata for beta 0.1.0 readiness.
3. Compare release workflow, release scripts, and docs for consistency.
4. Grep for rebrand leftovers (`T3`, `t3code`, `t3.codes`, `T3CODE`, `T3-Code`, `Alpha`) and classify risk.
5. Run required quality gates: `bun run fmt:check`, `bun lint`, `bun typecheck`, `bun run test`, `bun run build`.
6. Check release smoke/npm/desktop feasibility and artifact identity where possible.
7. Perform minimal functional smoke checks after build where possible.
8. Synthesize go/no-go report and recommended remediation list.

## Reviewer refinements

- Anchor audit to exact current checkout SHA and branch.
- Treat beta semantics (`v0.1.0` vs prerelease, npm `latest` vs `beta`) as an explicit go/no-go question.
- Check remote tag/npm/GitHub release availability when network allows; otherwise classify unknown.
- After mutating-prone checks, re-run `git status --short` and report generated changes/artifacts.
- Do not publish, push tags, dispatch release workflows, or run any command that intentionally releases artifacts.
- Define smoke success as command exits cleanly and expected version/help/static endpoint output is present.
