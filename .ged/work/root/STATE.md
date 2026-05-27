# State

- **Phase**: implement
- **Active task**: Initial `GedRoleInvocationService` slice
- **Status**: Prompt builder, service API, live service, and focused prompt/service tests are implemented. Provider reactor integration coverage remains a follow-up in the current task list.
- **Blockers**: None currently. Verifier found and implementation fixed an invocation-id collision risk; awaiting verifier re-check before commit.
- **Next step**: Run clean-context verifier, adjudicate findings, then commit if accepted.
