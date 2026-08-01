# Spec: Restore Ged skill contract

## Goal

Restore the repository's durable skill inventory to the vendored docs-aware clarification workflow
that is shipped in `.agents/skills` and `.claude/skills`.

## Scope

- Restore the installed `grill-with-docs`, `grilling`, and `domain-modeling` declarations.
- Remove the conflicting `grill-me` declaration introduced by the prior guidance-only commit.
- Keep the contract test strict; do not weaken shipped-resource validation.

