# TESTS: Fix branch review findings

Focused checks:

```sh
bun --filter @t3tools/ged-workflow typecheck
bun run test --filter=@t3tools/ged-workflow
bun run test --filter=@t3tools/desktop -- src/app/DesktopEnvironment.test.ts src/app/DesktopAppIdentity.test.ts
bun run test --filter=@t3tools/web -- src/composerDraftStore.test.ts
```

Required final checks:

```sh
bun fmt
bun lint
bun typecheck
bun run test
```

Never run `bun test`.

Additional focused checks:

```sh
bun run test --filter=@t3tools/desktop -- src/app/DesktopEnvironment.test.ts src/app/DesktopAppIdentity.test.ts
bun run test --filter=@t3tools/scripts
rg -n "pingdotgg/t3code|t3code-latest-release|com\.t3tools\.t3code|t3code\.desktop|t3code-dev\.desktop|StartupWMClass=t3code|APP_DISPLAY_NAME.*T3 Code" apps/marketing apps/desktop scripts
```

Any remaining grep hits must be intentional compatibility references and called out.
