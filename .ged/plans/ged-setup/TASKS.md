# Slices

1. **Served playbooks.** Add generic texts under `apps/server/src/ged/playbooks/` and the
   `ged_playbook` tool. Drop `model-policy.md` from `ged_role_brief`. (Criteria 3, 5, 6.)
2. **Verdicts.** Multi-verifier verdict schema, `ged_verdict_write` (same-family allowed only with a
   recorded reason), and the land gate rules plus tests. (Criterion 7.)
3. **Setup.** The `GedSetup` service with starter templates, and the `ged_init` tool, plus tests.
   (Criterion 1, the MCP part of 2.)
4. **Discovery.** MCP server instructions. (Criterion 4.)
5. **Client.** RPC contract and guard, the Project settings action, and the command-palette action.
   (Criterion 2.)
6. **This repo and docs.** Retire `roles/model-policy.md` and the duplicated skills, add
   `model-notes.md`, update docs and STANDARDS. (Criteria 8, 9.)
