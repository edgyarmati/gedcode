# TASKS

1. Cancel active stale `v0.1.0` release run if still running and confirm no GitHub Release exists.
2. Remove `macOS x64` from release workflow matrix and remove x64-only mac manifest merge/rename logic.
3. Remove `dist:desktop:dmg:x64` script and docs references.
4. Update `scripts/release-smoke.ts` so macOS smoke fixtures are arm64-only.
5. Run `bun fmt`, `bun lint`, `bun typecheck`, `bun run test`, and `bun run release:smoke`.
6. Commit/push, retag `v0.1.0`, and confirm fresh release run has no `Build macOS x64` job.
