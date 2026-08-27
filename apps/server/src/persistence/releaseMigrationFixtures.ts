/**
 * Published GedCode releases and the newest migration present in each tag.
 *
 * This inventory was reconciled against GitHub Releases and the tagged trees
 * on 2026-08-27. Stable and published nightly releases are contractual upgrade
 * inputs; untagged development snapshots remain best-effort.
 */
export const PUBLISHED_RELEASE_MIGRATION_FIXTURES = [
  { tag: "v0.1.0", migrationId: 32 },
  { tag: "v0.1.1-nightly.20260610.1", migrationId: 32 },
  { tag: "v0.1.1", migrationId: 32 },
  { tag: "v0.1.2", migrationId: 32 },
  { tag: "v0.1.3-nightly.20260614.1", migrationId: 32 },
  { tag: "v0.1.3", migrationId: 32 },
  { tag: "v0.2.0", migrationId: 44 },
  { tag: "v0.2.1", migrationId: 45 },
  { tag: "v0.2.2-nightly.20260712.1", migrationId: 48 },
  { tag: "v0.3.0-nightly.20260716.1", migrationId: 53 },
  { tag: "v0.3.0", migrationId: 55 },
  { tag: "v0.4.0", migrationId: 73 },
  { tag: "v0.4.1", migrationId: 73 },
  { tag: "v0.4.2", migrationId: 73 },
  { tag: "v0.4.3", migrationId: 76 },
] as const;
