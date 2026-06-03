# Release-Facing Ged Workflow Positioning

## Goal

Update public release-facing documentation so GedCode is described around the Ged workflow, not merely as a minimal GUI for coding agents.

The README and public copy should make clear that GedCode helps users run coding-agent work through a predictable loop: clarify, plan, implement, verify, then commit or continue. The documentation should also explain how GedCode keeps this work inspectable and easier to resume across long-running turns, reconnects, restarts, and partial streams.

## Scope

- Update `README.md` with product positioning centered on the Ged workflow.
- Preserve the existing README screenshot line if present:
  `![GedCode workspace screenshot](./assets/screenshot/workspace.png)`
- Add a public `docs/ged-workflow.md` guide.
- Update marketing page/meta copy where it repeats the old generic product description.
- Keep provider setup and installation instructions accurate.

## Non-Goals

- No provider behavior changes.
- No release workflow changes.
- No links from the public README to historical `docs/superpowers/*` planning docs.
- No claim that GedCode hard-enforces every workflow phase or guarantees correctness.
- No claim that GedCode-managed child-thread orchestration is available when the current implementation points users toward harness-native subagents.

## Acceptance Criteria

- README leads with Ged workflow as the selling point.
- README includes one public link to `docs/ged-workflow.md`.
- `docs/ged-workflow.md` explains the workflow phases in user-facing language.
- Public copy stays accurate about current provider support: Codex, Claude, and OpenCode in the README.
- Marketing copy mentions Ged workflow without overclaiming unsupported orchestration details.
- Required repo gates pass: `bun fmt`, `bun lint`, `bun typecheck`.
