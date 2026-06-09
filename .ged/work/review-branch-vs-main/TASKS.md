# TASKS: Branch review versus main

1. Confirm branch, `HEAD`, local `main`, merge-base, status, diff stat, dirstat, and changed-file inventory.
2. Create a changed-file coverage checklist from `git diff --name-status --find-renames main...HEAD`.
3. Review dependency/tooling/CI/release/package metadata/scripts/lockfile changes.
4. Review generated Codex/ACP protocol artifacts and generator/script changes.
5. Review Effect/Crypto migration, service provisioning, auth/credential/session flows, and ID generation.
6. Review orchestration/checkpoint/provider runtime/WebSocket command ID paths.
7. Review TSGo migration and array-chain-to-loop refactors with behavior-equivalence heuristics.
8. Review Claude SDK/model/ultracode provider changes.
9. Review web composer model-selection changes.
10. Review desktop settings, identity, release/update, and persistence implications.
11. Review EventNdjson/schema JSON changes.
12. Review source-control, shell/process, SSH/Tailscale, and VCS provider changes.
13. Review rebrand completeness and classify remaining legacy references.
14. Run required verification: `bun fmt:check`, `bun lint`, `bun typecheck`, `git diff --check main...HEAD`; run `bun run test` or documented focused fallback if practical.
15. Produce final review report with findings, risk conclusions, file coverage summary, baseline SHAs, verification results, and cleanliness/status note.
