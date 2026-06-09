# SPEC: Standalone GitHub repo with upstream credit

## Goal

Detach `edgyarmati/gedcode` from the GitHub fork network so sponsorship UI can appear, while clearly crediting `pingdotgg/t3code` as the upstream project GedCode forked from.

## Approach

- Use GitHub Settings UI for fork detachment; GitHub does not expose a normal API/CLI flag for this.
- Preserve the local `upstream` remote pointing at `https://github.com/pingdotgg/t3code.git` for manual sync/reference.
- Add concise visible attribution in public project docs.

## Scope

- GitHub-side detach operation.
- Public attribution docs: `README.md`, `CREDITS.md`, and license/contribution docs if present/relevant.

## Non-goals

- Do not rewrite git history.
- Do not delete/recreate the repository.
- Do not remove the `upstream` git remote.
