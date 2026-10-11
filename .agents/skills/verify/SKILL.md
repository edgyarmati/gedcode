---
name: verify
description: Run the narrow format, lint, typecheck, and test checks for the files you changed. Use before handing work off or landing it.
---

Run the checks **scoped to what you changed**, in sequence. Stop and report on the first failure.

> **Do not run repo-wide checks.** No `vp check`, no `vp run -r test`, no `vp run -r typecheck`
> unless the maintainer explicitly asks. CI owns the full suite. This is an upstream house rule.

## Steps

1. `vp fmt` — formatting.
2. `vp lint <changed files>` — lint. Repo-wide lint runs use
   `vp lint --report-unused-disable-directives`; prefer the file-scoped form.
3. `vp run --filter <package> typecheck` — the **narrowest affected package** only.
4. `vp test run <test files>` — focused tests for the changed behavior.

Never `bun install`, `bun test`, or `vitest` — this workspace is pnpm + Vite+, and Vitest is
dropped via override.

## If something unrelated fails

If a pre-existing, unrelated failure blocks the narrow check, document it and stop. Do not expand
scope to fix it without approval, and do not weaken a check to get to green.

## Reporting

On success: "Checks passed (fmt, lint, typecheck, tests) for `<scope>`." Name the scope — an
unscoped claim of success is misleading when the run was deliberately narrow.

On failure: name the step, show the relevant output, suggest a fix, and do not continue to later
steps.

## Note

This is the mechanical check, not verification in the Ged sense. Passing it is necessary and not
sufficient — landing additionally requires an independent verifier's verdict. See
the verifier brief at `.ged/roles/verifier.md` and `.ged/bin/land-gate.sh`.
