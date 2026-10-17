# Verdict records

A verdict record is an independent verifier's ruling on one branch. It is the only
thing that lets a change land: `.ged/bin/land-gate.sh` refuses a branch that has no
current, passing, independent verdict.

One record per branch, named after the branch with `/` replaced by `-`:
`feat/memory-toolkit` → `.ged/verdicts/feat-memory-toolkit.json`.

## Shape

```json
{
  "schemaVersion": 2,
  "branch": "feat/memory-toolkit",
  "headSha": "9afde1c6d...",
  "implementer": { "driverKind": "claudeAgent", "model": "..." },
  "reviews": [
    {
      "verifier": { "driverKind": "codex", "model": "...", "taskId": "..." },
      "status": "pass",
      "otherVendorAvailable": true,
      "criteria": [
        {
          "criterion": "delegate_task rejects a depth-3 delegation",
          "verdict": "met",
          "evidence": "toolkits/memory/handlers.test.ts:84 — asserts DepthExceeded"
        }
      ]
    }
  ]
}
```

`reviews` holds one entry per verifier that ruled on `headSha`. Usually that is one;
important changes get two in parallel, a strong same-family verifier and a foreign
one. A ruling on a new commit starts the record over. `otherVendorAvailable` is what
GedCode reported when the verifier was chosen: whether any provider other than the
implementer's was installed.

`driverKind` must be one of the kinds in `packages/contracts/src/model.ts`:
`codex`, `claudeAgent`, `cursor`, `grok`, `muse`, `pi`, `acpRegistry`, `opencode`.
Note it is `claudeAgent`, not `claude` — the gate rejects unrecognised kinds rather
than treating an unknown string as a distinct vendor.

## What the gate enforces

The gate fails closed: anything it cannot positively confirm blocks the land.

1. The working tree is clean, excluding this directory. The verifier reviewed a
   commit; uncommitted changes are unverified by construction.
2. `schemaVersion` is `2`. Older records are refused; re-verify to record a current one.
3. `branch` is the current branch, and `headSha` equals the current head. Any amend
   or rebase invalidates the verdict.
4. There is at least one review, and every review has `status` `pass`.
5. Every criterion in every review is `met`. `unverifiable` is **not** a pass — it
   means the criterion was not written to be checkable, which is a planning defect.
6. Every criterion carries substantive text and evidence: at least three characters
   that survive stripping whitespace and invisible format characters (zero-width,
   bidi controls, soft hyphen).
7. At least one verifier's `driverKind` differs from the implementer's, compared
   case-insensitively and after trimming, so `"Codex "` cannot pose as a second
   vendor. The one exception: when every review records `otherVendorAvailable:
false`, a same-vendor verdict passes with a warning, because there was no other
   vendor to ask.
8. HEAD is on a named branch whose name maps to a usable filename.
9. The record is a real file, not a symlink.

## Why these are not committed

A tracked record and HEAD chase each other: committing a verdict changes HEAD, which
immediately makes the verdict it contains stale. There is no fixed point.

So records are untracked (`.gitignore` in this directory) and the gate skips this
directory when it checks for a dirty tree. The consequence is that the gate is a
**local, pre-push control**. CI cannot see these records and needs a separate
transport — a PR comment, a check-run annotation, or an artifact — if the same
guarantee is wanted there. That is unbuilt.

## Trust boundary

The record is **self-asserted and unsigned**. Anyone who can write to this directory
can forge a pass, and the implementer's own agent could write one naming a verifier
that never ran.

The gate is therefore a guard against _omission_, not against _forgery_: it stops a
lead that skipped verification, or that verified an older tree, or that let a
sycophantic same-vendor reviewer sign off. It does not stop a deliberately dishonest
agent. Raising it to that bar needs an attestation the agent cannot mint — a
signature from the orchestrator process, or verification recorded server-side in the
task record rather than on disk. Also unbuilt, and worth doing before this is relied
on for anything beyond a solo workflow.
