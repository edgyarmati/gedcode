# Plan 001: Source-control docs list only the providers the code still ships (GitHub + GitLab)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 65e913c7..HEAD -- docs/source-control-providers.md README.md CHANGELOG.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: docs
- **Planned at**: commit `65e913c7`, 2026-06-13
- **Issue**: https://github.com/edgyarmati/gedcode/issues/8

## Why this matters

The `cleanup/drop-upstream-features` branch removed the Bitbucket and Azure
DevOps source-control integrations (commit `ddfb1fd3`, recorded in
`CHANGELOG.md`), but `docs/source-control-providers.md` still advertises all
four providers with full setup instructions. The README links users straight
to this doc. A user who follows it will export `T3CODE_BITBUCKET_*` env vars,
run `az extension add`, and wait for a connection that the code can never make
— there is no Bitbucket or Azure provider left in the build. Actively-wrong
setup docs are worse than missing ones. This brings the doc back in sync with
the shipped code.

## Current state

- `docs/source-control-providers.md` — the public source-control reference,
  linked from `README.md:40`. It currently lists four providers and documents
  setup for two that were deleted:
  - Line 11: `- **Bitbucket** – Pull request workflows (via API token authentication)`
  - Line 12: `- **Azure DevOps** – Pull request support for Microsoft-hosted repositories`
  - Line 21: Command-palette bullet naming **Bitbucket repository**, **Azure DevOps repository**
  - Line 27: "Publish local projects" naming Bitbucket / Azure DevOps
  - Line 36: "Supports GitHub Pull Requests, GitLab Merge Requests, and Bitbucket Pull Requests"
  - Lines 82–92: full **For Bitbucket** setup section (mentions the env var
    names `T3CODE_BITBUCKET_EMAIL` / `T3CODE_BITBUCKET_API_TOKEN` — these are
    variable _names_, not secrets)
  - Lines 94–107: full **For Azure DevOps** setup section (`brew install azure-cli`, `az extension add`, `az login`)
  - Line 120: troubleshooting bullet "**Bitbucket not connecting**"
  - Line 127: external link `[Azure CLI](https://docs.microsoft.com/en-us/cli/azure/)`
- The code that actually ships, for confirmation — `apps/server/src/sourceControl/`
  contains only `GitHubCli.ts`, `GitHubSourceControlProvider.ts`, `GitLabCli.ts`,
  `GitLabSourceControlProvider.ts` and their support files. No Bitbucket/Azure
  files remain. The registry wires only the two:
  - `apps/server/src/sourceControl/SourceControlProviderRegistry.ts` imports and
    registers `GitHubSourceControlProvider` and `GitLabSourceControlProvider` only.
- `CHANGELOG.md` "## Unreleased" already contains: `Remove: Drop Bitbucket and
Azure DevOps source-control integrations; GitHub and GitLab remain.` (no new
  changelog entry needed for a docs-only sync, but see Step 3).

This is a documentation-only change. No runtime code is touched.

## Commands you will need

| Purpose      | Command                                                                                       | Expected on success    |
| ------------ | --------------------------------------------------------------------------------------------- | ---------------------- |
| Format check | `bun run fmt:check`                                                                           | exit 0                 |
| Format       | `bun fmt`                                                                                     | rewrites files, exit 0 |
| Confirm dead | `git grep -in -E 'bitbucket\|azure devops\|azure-devops' -- docs/source-control-providers.md` | no matches after edit  |

(There is no markdown linter gate in this repo; `bun lint` is oxlint over
source code and does not cover `.md`. `bun run fmt:check` does cover Markdown.)

## Scope

**In scope** (the only files you should modify):

- `docs/source-control-providers.md`

**Out of scope** (do NOT touch, even though they look related):

- `apps/web/src/vscode-icons-manifest.json` — contains `bitbucket`/`azure`
  entries, but these are cosmetic VS Code _file-type icon_ mappings, not
  provider code. Leave them.
- `packages/contracts/src/editor.ts` — any `Cursor` reference there is the IDE
  "open in editor" target, unrelated to source-control providers.
- Any file under `apps/server/src/sourceControl/` — code is already correct.

## Git workflow

- Branch: `advisor/001-source-control-docs-cleanup`
- One commit; message style is conventional commits (recent log shows
  `docs: record upstream feature removals`, `chore: remove ...`). Use:
  `docs: drop removed Bitbucket and Azure DevOps source-control providers`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Remove Bitbucket and Azure DevOps from the provider list and feature copy

In `docs/source-control-providers.md`:

- Delete the two list items at lines 11–12 (Bitbucket, Azure DevOps), leaving
  the GitHub and GitLab bullets.
- Line 21: reduce the choices to "**GitHub repository**, **GitLab repository**,
  or paste any **Git URL**" and drop the `workspace/repository` /
  `project/repository` path-format examples that referred to Bitbucket/Azure.
- Line 27: change the parenthetical to "(GitHub, GitLab)".
- Line 36: change to "Supports GitHub Pull Requests and GitLab Merge Requests."

**Verify**: `git grep -in -E 'bitbucket|azure' -- docs/source-control-providers.md` → only matches left should be ones you will remove in Step 2 (the setup sections). After Step 2 this returns nothing.

### Step 2: Remove the Bitbucket and Azure DevOps setup + troubleshooting sections

- Delete the "### For Bitbucket" section (lines ~82–92).
- Delete the "### For Azure DevOps" section (lines ~94–107).
- Delete the troubleshooting bullet "**Bitbucket not connecting**" (line ~120).
- Delete the `[Azure CLI](...)` link (line ~127) from the "Need more help?" list.
- Keep the GitHub and GitLab setup sections, the generic Git requirement note,
  and the GitHub/GitLab CLI links.

**Verify**: `git grep -in -E 'bitbucket|azure devops|azure-cli|azure/' -- docs/source-control-providers.md` → no matches. (NOTE: scope the grep to this file only. The planning/decision docs `docs/superpowers/plans/2026-06-13-upstream-feature-cleanup.md`, `docs/superpowers/specs/...`, and `docs/upstream-decisions.md` intentionally retain the provider names as historical records — do NOT edit them, and a grep over all of `docs/` will correctly still match them.)

### Step 3: Confirm the changelog already covers this

The `CHANGELOG.md` "## Unreleased" section already has the removal entry
(quoted in "Current state"). A docs-sync does not need its own entry. Do NOT
add a duplicate. If — and only if — the removal entry is absent from
`## Unreleased` when you read it, add: `- Docs: Remove setup docs for the
dropped Bitbucket and Azure DevOps source-control providers.`

**Verify**: `bun run fmt:check` → exit 0.

## Test plan

No code tests apply (docs-only). The verification is the two `git grep` commands
above returning no Bitbucket/Azure matches in `docs/`, plus `bun run fmt:check`
passing. There is no markdown test suite to add to.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `git grep -in -E 'bitbucket|azure devops|azure-cli' -- docs/source-control-providers.md` returns no matches (scope to this file; historical docs under `docs/superpowers/` and `docs/upstream-decisions.md` keep the names by design)
- [ ] `docs/source-control-providers.md` still documents GitHub and GitLab setup (`git grep -c 'GitLab' docs/source-control-providers.md` ≥ 1 and `... 'GitHub' ...` ≥ 1)
- [ ] `bun run fmt:check` exits 0
- [ ] No files outside `docs/source-control-providers.md` (and possibly `CHANGELOG.md` per Step 3) are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The provider list in `docs/source-control-providers.md` no longer matches the
  "Current state" excerpt (someone already edited it).
- `apps/server/src/sourceControl/` contains a `Bitbucket*` or `AzureDevOps*`
  file — that would mean the provider was NOT actually removed and the docs may
  be correct; do not delete docs for a provider that still exists.
- `bun run fmt:check` fails for a reason unrelated to your edit.

## Maintenance notes

- The root cause was that the upstream-cleanup checklist
  (`docs/superpowers/plans/2026-06-13-upstream-feature-cleanup.md`) never
  included `docs/source-control-providers.md` in its grep/file list. A reviewer
  should consider adding a "grep docs/ for removed feature names" step to future
  removal checklists so docs don't drift again.
- If a new source-control provider is ever added, this is the doc to update.
