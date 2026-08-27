// @effect-diagnostics nodeBuiltinImport:off

import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";

import { CURRENT_SCHEMA_MIGRATION_ID, runMigrations } from "./Migrations.ts";
import * as NodeSqliteClient from "./NodeSqliteClient.ts";

interface DatabaseFixtureManifestEntry {
  readonly id: string;
  readonly tag: string;
  readonly migrationId: number;
  readonly releases: ReadonlyArray<string>;
  readonly file: string;
  readonly commit: string;
  readonly migrationsTree: string;
  readonly migrationsEntryBlob: string;
  readonly rawBytes: number;
  readonly rawSha256: string;
  readonly compressedSha256: string;
}

interface ReleaseCompatibilityManifest {
  readonly schemaVersion: number;
  readonly generatedBy: string;
  readonly publishedGedcodeReleases: ReadonlyArray<string>;
  readonly database: ReadonlyArray<DatabaseFixtureManifestEntry>;
}

const manifest = JSON.parse(
  readFileSync(
    new URL("../../../../docs/release-compatibility-fixtures.json", import.meta.url),
    "utf8",
  ),
) as ReleaseCompatibilityManifest;
const databaseFixtureDirectory = new URL("./fixtures/published-releases/", import.meta.url);

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("published release SQLite upgrade fixtures", () => {
  it("records immutable provenance for every published release", () => {
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.generatedBy).toBe("scripts/generate-release-compatibility-fixtures.ts");
    expect(manifest.publishedGedcodeReleases).toEqual([
      "v0.1.0",
      "v0.1.1-nightly.20260610.1",
      "v0.1.1",
      "v0.1.2",
      "v0.1.3-nightly.20260614.1",
      "v0.1.3",
      "v0.2.0",
      "v0.2.1",
      "v0.2.2-nightly.20260712.1",
      "v0.3.0-nightly.20260716.1",
      "v0.3.0",
      "v0.4.0",
      "v0.4.1",
      "v0.4.2",
      "v0.4.3",
    ]);
    expect(manifest.database.flatMap((entry) => entry.releases)).toEqual(
      manifest.publishedGedcodeReleases,
    );
    for (const fixture of manifest.database) {
      expect(fixture.commit).toMatch(/^[0-9a-f]{40}$/u);
      expect(fixture.migrationsTree).toMatch(/^[0-9a-f]{40}$/u);
      expect(fixture.migrationsEntryBlob).toMatch(/^[0-9a-f]{40}$/u);
    }
  });

  it.each(manifest.database)(
    "forward-migrates the tagged $tag database and retains seeded data",
    async (fixture) => {
      const compressed = readFileSync(new URL(fixture.file, databaseFixtureDirectory));
      expect(sha256(compressed)).toBe(fixture.compressedSha256);

      const taggedDatabase = gunzipSync(compressed);
      expect(taggedDatabase.byteLength).toBe(fixture.rawBytes);
      expect(sha256(taggedDatabase)).toBe(fixture.rawSha256);

      const directory = mkdtempSync(join(tmpdir(), "gedcode-published-release-upgrade-"));
      const databasePath = join(directory, "state.sqlite");
      writeFileSync(databasePath, taggedDatabase);

      try {
        const before = new DatabaseSync(databasePath, { readOnly: true });
        expect(
          before.prepare("SELECT MAX(migration_id) AS id FROM effect_sql_migrations").get(),
        ).toMatchObject({ id: fixture.migrationId });
        expect(
          before
            .prepare("SELECT payload_json FROM orchestration_events WHERE event_id = ?")
            .get(`release-fixture-event:${fixture.tag}`),
        ).toMatchObject({
          payload_json: JSON.stringify({
            fixtureTag: fixture.tag,
            sentinel: "published-release-data",
          }),
        });
        before.close();

        await Effect.runPromise(
          Effect.scoped(
            runMigrations().pipe(
              Effect.provide(NodeSqliteClient.layer({ filename: databasePath })),
            ),
          ),
        );

        const after = new DatabaseSync(databasePath, { readOnly: true });
        expect(
          after.prepare("SELECT MAX(migration_id) AS id FROM effect_sql_migrations").get(),
        ).toMatchObject({ id: CURRENT_SCHEMA_MIGRATION_ID });
        expect(after.prepare("PRAGMA integrity_check").get()).toMatchObject({
          integrity_check: "ok",
        });
        expect(
          after
            .prepare("SELECT payload_json FROM orchestration_events WHERE event_id = ?")
            .get(`release-fixture-event:${fixture.tag}`),
        ).toMatchObject({
          payload_json: JSON.stringify({
            fixtureTag: fixture.tag,
            sentinel: "published-release-data",
          }),
        });
        expect(
          after
            .prepare("SELECT diff FROM checkpoint_diff_blobs WHERE thread_id = ?")
            .get(`release-fixture-thread:${fixture.tag}`),
        ).toMatchObject({ diff: expect.stringContaining("published release fixture") });
        after.close();
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );
});
