# Model policy

Which model, privilege, and interaction mode each role gets. Read by the task lead at startup.
This lives in memory rather than in a prompt so it versions and diffs like everything else.

| Role        | Model                                              | `runtimeMode`       | `interactionMode` |
| ----------- | -------------------------------------------------- | ------------------- | ----------------- |
| Planner     | most capable available                             | `approval-required` | `plan`            |
| Implementer | cheap / fast                                       | `auto-accept-edits` | `default`         |
| Verifier    | capable, **different vendor than the implementer** | `approval-required` | `default`         |

## Why these

- **Planner gets the expensive model.** Planning is the highest-leverage and least token-hungry
  step; a bad plan is paid for by every slice downstream. It needs no write privilege.
- **Implementer gets the cheap model and the only write privilege.** Volume work, bounded scope,
  with a plan and criteria already in hand.
- **Verifier differs in vendor from the implementer.** Shared training priors and self-consistency
  pressure are the main sources of agreement bias; a different vendor removes both. It is the
  strongest available lever and costs one field (`target.driverKind`). Pinned to
  `approval-required` so it provably cannot edit — `DispatchModeLimit` is a privilege ceiling
  re-checked inside the thread's command lock, so the target cannot raise it mid-flight.

## Selection

Call `orchestrator_capabilities` first. It returns registered provider instances, advertised
models, whether each can run a child task, and model-visible reasons for unavailability. A
requested model must be advertised by the selected provider or the call fails with
`model_unavailable`.

## On unavailability

**Block and ask the operator. Do not silently downgrade.**

This follows the standing rule against unapproved degraded paths, and a silent planner downgrade is
precisely the regression nobody notices — output still appears, just worse. The same applies to
falling back to a same-vendor verifier: it voids the independence this design rests on, so it is an
operator decision, not a lead's.
