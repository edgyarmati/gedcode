export const VERIFY = `# Verify playbook

The narrow mechanical check, run before handing work off or landing it. It is necessary, not
sufficient: landing also needs an independent verdict.

1. Read the **Checks** section of \`.ged/STANDARDS.md\`. It names this project's format, lint,
   typecheck and test commands and any scope rules. If the section is missing or empty, find the
   commands from the project's own config (package scripts, Makefile, CI workflows), run the
   narrowest ones, and tell the user so they can record them.
2. Run the checks **scoped to what changed**: the files touched, the narrowest affected package,
   the tests for the changed behaviour. Do not run repo-wide suites unless the standards or the user
   say so.
3. Stop at the first failure and report the step and its output. If a pre-existing, unrelated
   failure blocks you, report it and stop; do not widen the change to fix it, and never weaken a
   check to get to green.
4. On success, name the scope: "Checks passed (format, lint, typecheck, tests) for \`<scope>\`."
`;
