# Published release compatibility fixtures

GedCode treats every published stable or nightly release as a contractual upgrade input. `v0.1.0`
is the first tag whose desktop product name is `GedCode`; earlier tags identify the separate
upstream product as `T3 Code (Alpha)` and are intentionally outside this matrix. Existing data from
that product remains covered by GedCode's one-time legacy `~/.t3` import. The
compatibility tests do not reconstruct an old schema by running today's migration code to a lower
migration ID. They consume immutable artifacts produced by the code that actually shipped.

## Fixture contents

The fixture set contains:

- one compressed SQLite database for every distinct migration tree published through `v0.4.3`;
- seeded orchestration-event and checkpoint-diff rows, so tests prove data survives as well as the
  schema;
- one serialized composer and terminal payload generated independently from every published
  GedCode tag;
- one serialized helper-dismissal payload from every release where that store exists; and
- a machine-readable manifest with the tag commit, migration tree/blob or store-source blob,
  published releases covered by that artifact, byte lengths, and SHA-256 checksums.

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
current migration ID, and confirm both seeded durable rows remain intact.

Web tests verify each per-release serialized payload checksum, run it through the current store migration or
same-version hydration path, and confirm unsent drafts, terminal layout state, and helper dismissals
survive. They also require a composer and terminal fixture generated from every published tag.
