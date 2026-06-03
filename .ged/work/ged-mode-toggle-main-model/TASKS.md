# Tasks

## Planning

1. [x] Classify request.
2. [x] Run explorer reconnaissance.
3. [x] Draft/accept plan.

## Implementation

1. [ ] Add small UI helper/config for Ged workflow mode labels/copy.
2. [ ] Replace composer Ged button with explicit Normal thread / Ged workflow mode control.
3. [ ] Update compact composer controls to expose the same explicit mode choice.
4. [ ] Make all composer model fallback paths mode-aware (local draft thread and ChatComposer props): explicit draft picker > persisted thread model > mode-aware fallback.
5. [ ] Confirm composer model changes affect only the main/thread model and do not expose/mutate role presets in composer.
6. [ ] Polish copy so role models are clearly configured in settings.

## Verification/build

1. [ ] Add focused tests for normal fallback ignoring Ged main, Ged workflow using Ged main, explicit selection precedence, and role presets not mutating.
2. [ ] Run `bun fmt`.
3. [ ] Run `bun lint`.
4. [ ] Run `bun typecheck`.
5. [ ] Run `bun run test`.
6. [ ] Run clean-context verifier.
7. [ ] Build native client with `bun run build:desktop`.
8. [ ] Commit after native build passes.
