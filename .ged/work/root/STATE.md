# State

- **Phase**: verify
- **Active task**: Workflow status badge live-state gating
- **Status**: Badge fix implemented and focused verification passed; repo-wide typecheck is failing in unrelated release-script files.
- **Blockers**: `bun typecheck` fails in `scripts/promote-stable-update-manifests*`, outside this patch.
- **Next step**: Either fix the unrelated release-script typecheck errors or rerun full verification after that worktree state is resolved.
