# Verdict records

Evidence that an independent verifier ruled on a change. The land gate reads these; nothing merges
without one. See [../ORCHESTRATION.md](../ORCHESTRATION.md#4-stage-discipline).

One record per branch, named `<branch-with-slashes-as-dashes>.json`, with SHA provenance recorded
inside. This resolves the open question of per-task vs per-SHA keying: per-SHA keys churn on every
amend and leave orphans, while a branch-keyed record with a `headSha` field still lets the gate
detect staleness — which is the property that actually matters.

## Schema

```json
{
  "schemaVersion": 1,
  "branch": "feat/memory-toolkit",
  "headSha": "<full 40-char sha the verifier actually reviewed>",
  "status": "pass | fail",
  "verifiedAt": "<ISO 8601>",
  "round": 2,
  "implementer": { "driverKind": "codex", "model": "..." },
  "verifier":    { "driverKind": "claude", "model": "...", "taskId": "..." },
  "criteria": [
    { "criterion": "<verbatim from the plan>", "verdict": "met", "evidence": "parseRef.test.ts:41" }
  ]
}
```

## Rules the gate enforces

1. A record exists for the current branch.
2. `headSha` equals the current `HEAD`. A verdict is invalidated by any amend, rebase, or new
   commit — the gate compares against the live head rather than merely finding a record.
3. `status` is `pass`.
4. Every criterion is `met`. `unverifiable` is not a pass.
5. `verifier.driverKind` differs from `implementer.driverKind` — cross-vendor independence.

The gate fails closed: a malformed, missing, or unreadable record is a failure, never a skip.
