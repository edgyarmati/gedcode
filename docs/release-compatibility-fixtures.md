# Historical release migration fixtures

GedCode's supported upgrade floor is `v0.4.4`. Data directories and browser state from older
GedCode releases or the separate `T3 Code (Alpha)` product are not supported compatibility inputs.
In particular, desktop startup no longer imports `~/.t3` or selects legacy Electron user-data
directories.

The repository retains fixtures from `v0.1.0` through `v0.4.3` as non-contractual regression
evidence. They are useful for exercising long migration chains, but passing them does not extend the
support floor. An immutable `v0.4.4` fixture has not been recorded because this checkout has no
`v0.4.4` tag. Capture that baseline from the exact published ref before deleting browser hydration
code solely because it predates the support floor.

The fixture tests do not reconstruct an old schema by running today's migration code to a lower
migration ID. They consume immutable artifacts produced by the code that actually shipped.

## Fixture contents

The fixture set contains:

- one compressed SQLite database for every distinct historical migration tree through `v0.4.3`;
- seeded orchestration-event and checkpoint-diff rows, so tests prove data survives as well as the
  schema;
- one serialized composer and terminal payload generated independently from every recorded
  historical GedCode tag;
- one serialized helper-dismissal payload from every release where that store exists; and
- a machine-readable manifest with the tag commit, migration tree/blob or store-source blob,
  historical releases covered by that artifact, byte lengths, and SHA-256 checksums.

The checked-in manifest is [`release-compatibility-fixtures.json`](release-compatibility-fixtures.json).
SQLite artifacts live under `apps/server/src/persistence/fixtures/published-releases/`; browser
payloads live under `apps/web/src/fixtures/published-releases/`. Generated browser payloads are
excluded from formatting so repository tooling cannot rewrite their checked bytes without updating
the recorded checksums.

## Provenance and regeneration

Run:

```sh
node scripts/generate-release-compatibility-fixtures.ts
```

The generator creates a detached temporary worktree for each representative published tag, installs
that tag's frozen dependencies, and executes that tag's own `Migrations.ts` or Zustand store source.
It normalizes migration timestamps, adds deterministic sentinel data, compresses SQLite databases,
writes the browser serialization output, records Git object identities and checksums, and then
removes the temporary worktrees.

The generator also verifies that every release grouped behind a representative SQLite fixture has
the exact same tagged `Migrations` Git tree. A mapping error therefore fails regeneration instead of
quietly claiming coverage for a different historical schema.

Generation requires the recorded tags to exist locally, Node with `node:sqlite`, Bun, and Git. A
fixture change must be reviewed together with its manifest change. Reviewers should confirm that a
new or retagged release is mapped to an existing identical source object or has a newly generated
artifact; editing version numbers or migration IDs alone is insufficient.

## Test contract

Server tests verify each compressed and raw checksum, inspect the historical database before the
upgrade, run the current migration implementation against that file, check SQLite integrity and the
current migration ID, and confirm both seeded durable rows remain intact. The historical sentinel
event is deliberately only a storage-integrity marker; focused migration tests must separately
decode real current event types through `OrchestrationEventStore`.

Web tests verify each recorded payload checksum, run it through the current store migration or
same-version hydration path, and confirm unsent drafts, terminal layout state, and helper dismissals
survive. This is regression coverage, not a promise to support those pre-`v0.4.4` payloads.
