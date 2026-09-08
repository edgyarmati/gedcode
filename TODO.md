# TODO

## Bigger things

- [ ] Redesign remote transport and security as one professional, explicit system before extending
      remote behavior further:
  - eliminate or strictly gate non-loopback plaintext HTTP so credentials and session traffic are
    not exposed on untrusted networks;
  - define the WebSocket `Origin` policy and matching HTTP CORS allowlist for desktop, direct web,
    and hosted web clients;
  - decide ownership and migration for inherited hosted `t3.codes` pairing URLs and defaults rather
    than relying implicitly on upstream infrastructure;
  - when this work starts, the maintainer has authorized studying
    [pingdotgg/T3Code](https://github.com/pingdotgg/t3code) as a reference. Do not import or change
    remote behavior as part of unrelated work.

## Reliability debt

- [ ] Separate Codex app-server JSON-RPC responses from unsolicited notifications before placing a
      finite bound on the raw transport queue. Bounding the mixed stream directly can deadlock a
      request by dropping or blocking its response.
- [ ] Design durable, resumable delivery for orchestration domain events before bounding the
      remaining end-to-end orchestration queues. Silent dropping and generic backpressure are both
      unsafe for state-machine events.

## Performance debt

- [ ] Split the web production bundle along real feature boundaries. The current build still emits
      a roughly 4.1 MB main JavaScript chunk (about 1.2 MB gzip), and the attempted dynamic import of
      `useSettings` is ineffective because the module is also imported statically. Start with editor,
      diff, syntax-language, and settings-only dependencies, then enforce reviewed bundle budgets in
      CI.

## Code-quality debt

- [ ] Establish a reviewed zero-warning lint baseline. Prioritize the React hook and nested-component
      warnings because they can hide correctness or render-cost problems; separately classify
      immutable projection updates and test-only function-scoping warnings before changing them
      mechanically.

## Compatibility evidence

- [ ] Record an immutable `v0.4.4` SQLite and browser-persistence baseline from the exact published
      ref when it is available. Then use that fixture to identify and delete browser hydration
      branches that are provably below the supported `v0.4.4` upgrade floor.
- [ ] Replace the historical SQLite fixture's synthetic storage sentinel with a stable real event
      and replay it through `OrchestrationEventStore`; keep focused migration tests for retired
      event-type rewrites and removals.
