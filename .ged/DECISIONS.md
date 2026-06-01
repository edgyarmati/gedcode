# Decisions

> Durable decisions and rationale (ADR-style).

## Ged workflow role configuration parity

- Date: 2026-05-27
- Decision: Gedcode should present Ged workflow orchestration configuration as first-class UI, matching GedPi concepts: subagents enabled, intercom bridge, critique mode, and per-role provider/model/thinking settings.
- Scope note: Runtime invocation is currently implemented for `ged-explorer`; the configuration model should be extensible to planner, plan-reviewer, verifier, and worker without forcing all role runtimes to be implemented in one slice.

## Ged subagent ownership mode

- Date: 2026-05-27
- Decision: Ged workflow settings should support a mode that uses harness-native subagents instead of Gedcode-managed role child threads. In harness-native mode, per-role custom model settings are disabled/ignored and the workflow prompt instructs the selected harness/provider to create/use its native subagent mechanism.
- Rationale: Some users want provider-native subagent behavior rather than Gedcode-owned child threads and per-role model routing. The two models are mutually exclusive to avoid confusing model ownership semantics.
