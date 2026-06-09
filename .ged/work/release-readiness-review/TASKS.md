# Tasks

## 1. Baseline State

- [ ] Record current branch/SHA and list changed/untracked files.
- [ ] Record both unstaged and staged/index state before any staging.
- [ ] Confirm checkout branch or document mismatch.
- [ ] Record branch divergence from origin/main or relevant base.

## 2. Inspect Diffs

- [ ] Review tracked/staged diffs and untracked files.
- [ ] Classify files into icon assets, runtime warning details, `.ged/work`, or unrelated/unknown.
- [ ] Use path-specific `git add`; never broad-stage unrelated changes.

## 3. Validate Quality Before Commit

- [ ] Run `bun fmt` first and inspect any mutations.
- [ ] Run `bun lint`.
- [ ] Run `bun typecheck`.
- [ ] Run `bun run test` for release-readiness evidence; never run `bun test`.
- [ ] If a required gate fails, fix only clearly in-scope issues or report `No-go`.

## 4. Resolve Icon Asset Group

- [ ] Inspect asset/resource changes for expected GedCode icon swap only.
- [ ] Confirm binary asset provenance/size and whether source asset directories should be included.
- [ ] Stage only icon-related files with path-specific staging.
- [ ] Commit with a conventional commit.

## 5. Resolve Runtime Warning Detail Group

- [ ] Inspect runtime warning detail surfacing changes.
- [ ] Confirm behavior is bounded and appropriate for release.
- [ ] Stage only runtime-warning-related files with path-specific staging.
- [ ] Commit with a conventional commit.

## 6. Resolve `.ged/work` Artifacts

- [ ] Inspect untracked `.ged/work` planning files.
- [ ] Do not commit `.ged/work` artifacts unless explicitly confirmed or already established as durable project records.
- [ ] Otherwise leave untracked intentionally and document in the final report.
- [ ] Do not delete without explicit confirmation.

## 7. Final Working Tree Check

- [ ] Re-run git status/log and document remaining untracked files.
- [ ] Ensure no formatter or source changes remain unstaged unintentionally.

## 8. Release-Readiness Assessment

- [ ] Anchor report to final HEAD SHA and branch divergence.
- [ ] Summarize evidence across branch changes, checks, blockers, non-blocking risks, skipped checks, and final go/no-go recommendation.
