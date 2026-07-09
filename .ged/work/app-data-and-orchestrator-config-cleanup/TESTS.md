# Tests: App data directory and orchestrator config cleanup

- `cd packages/contracts && bun run test src/orchestrator/config.test.ts src/settings.test.ts`
- `cd packages/shared && bun run test src/orchestrator.test.ts`
- `cd apps/desktop && bun run test src/app/DesktopEnvironment.test.ts src/app/DesktopDataMigration.test.ts`
- `cd apps/server && bun run test src/cli/config.test.ts src/orchestration/decider.task.test.ts src/orchestration/Layers/PmRuntime.test.ts`
- `cd apps/web && bun run test src/components/orchestrator/projectOrchestrationSettings.logic.test.ts src/components/settings/SettingsPanels.logic.test.ts`
- `bun fmt`
- `bun lint`
- `bun typecheck`
- `git diff --check`
