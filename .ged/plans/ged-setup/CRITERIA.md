# Acceptance criteria

1. **Setup preview and apply.** `GedSetup` lists the starter files missing from a project root and
   writes only those. Existing files are byte-identical afterwards; running it twice is a no-op.
   Covered by tests.
2. **Three entry points, one method.** Project settings and the command palette both reach setup
   with a preview and a confirm. The `ged_init` MCP tool calls the same service method and is gated
   as a write. The RPC is guarded in `CLIENT_GUARDED_RPC_SCOPES` and covered by the permission
   tests.
3. **Served playbooks.** `ged_playbook` returns each of `lead`, `grilling`, `verify`, `planner`,
   `implementer` and `verifier`. None of them names this repo's tooling (`vp`, `pnpm`) or a fixed
   model. `verify` and `implementer` point to the project's `STANDARDS.md` Checks section.
4. **Discovery.** The MCP server sends instructions, the same for every project, that name
   `ged_playbook` and say to clarify intent first in a project with `.ged/`. For a project without
   `.ged/` they say only that Ged is not set up and `ged_init` can set it up when the user asks.
5. **Grilling records.** The grilling playbook says that after confirmation, terms go to
   `CONTEXT-MAP.md` and decisions to `DECISIONS.md`.
6. **Models.** The lead playbook says to choose within the lead's own family, to read
   `model-notes.md` first, to record new user preferences there, and to announce any fallback.
   `ged_role_brief` and `model-policy.md` are gone; `ged_playbook` serves every brief.
7. **Verification.** The lead playbook encodes the three verification cases in SPEC decision 5.
   A verdict can record more than one verifier. The land gate:
   - passes when every recorded verifier passes at HEAD and at least one is from another vendor;
   - also passes when every verifier is same-family and the verdict records that no other vendor was
     installed, but prints a warning;
   - refuses everything else.
     Covered by tests.
8. **Upstream footprint.** Every modified upstream file is listed in `.ged/STANDARDS.md` with a
   reason. New behaviour lives in new files.
9. **Docs.** `docs/ged/workflow.md` explains how to start: Set up Ged, then a root thread.
   `docs/ged/user/` has a short section on the setup action.
