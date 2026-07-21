import { describe, expect, it } from "@effect/vitest";

import { CURRENT_GED_SCHEMA_VERSION, decodeGedManifest, inspectGedSchema } from "./GedManifest.ts";

describe("GedManifest", () => {
  it("decodes the current committed manifest", () => {
    const manifest = decodeGedManifest(`{
      "schemaVersion": ${CURRENT_GED_SCHEMA_VERSION},
      "updatedAt": "2026-07-21T12:00:00.000Z",
      "lastReviewedAt": "2026-07-21T11:00:00.000Z",
      "generatedBy": "gedcode@0.3.0"
    }`);

    expect(manifest).toEqual({
      schemaVersion: CURRENT_GED_SCHEMA_VERSION,
      updatedAt: "2026-07-21T12:00:00.000Z",
      lastReviewedAt: "2026-07-21T11:00:00.000Z",
      generatedBy: "gedcode@0.3.0",
    });
  });

  it("classifies missing, legacy, current, outdated, and newer schemas", () => {
    expect(inspectGedSchema({ manifestContents: null, legacyVersionContents: null })).toEqual({
      status: "missing",
      sourceSchemaVersion: 0,
    });
    expect(inspectGedSchema({ manifestContents: null, legacyVersionContents: "2\n" })).toEqual({
      status: "legacy",
      sourceSchemaVersion: 2,
    });
    expect(
      inspectGedSchema({
        manifestContents: JSON.stringify({
          schemaVersion: CURRENT_GED_SCHEMA_VERSION,
          updatedAt: "2026-07-21T12:00:00.000Z",
          lastReviewedAt: "2026-07-21T12:00:00.000Z",
          generatedBy: "gedcode@0.3.0",
        }),
        legacyVersionContents: null,
      }),
    ).toMatchObject({ status: "current" });
    expect(
      inspectGedSchema({
        manifestContents: JSON.stringify({
          schemaVersion: 1,
          updatedAt: "2026-07-21T12:00:00.000Z",
          lastReviewedAt: "2026-07-21T12:00:00.000Z",
          generatedBy: "gedcode@0.2.0",
        }),
        legacyVersionContents: null,
      }),
    ).toMatchObject({ status: "outdated", sourceSchemaVersion: 1 });
    expect(
      inspectGedSchema({
        manifestContents: JSON.stringify({
          schemaVersion: CURRENT_GED_SCHEMA_VERSION + 1,
          updatedAt: "2026-07-21T12:00:00.000Z",
          lastReviewedAt: "2026-07-21T12:00:00.000Z",
          generatedBy: "gedcode@9.0.0",
        }),
        legacyVersionContents: null,
      }),
    ).toMatchObject({ status: "newer", sourceSchemaVersion: CURRENT_GED_SCHEMA_VERSION + 1 });
  });

  it("rejects malformed manifests and legacy versions", () => {
    expect(() => decodeGedManifest("{}")).toThrow(/schemaVersion/);
    expect(() =>
      decodeGedManifest(
        JSON.stringify({
          schemaVersion: CURRENT_GED_SCHEMA_VERSION,
          updatedAt: "not-a-date",
          lastReviewedAt: "2026-07-21T12:00:00.000Z",
          generatedBy: "gedcode@0.3.0",
        }),
      ),
    ).toThrow(/updatedAt/);
    expect(() =>
      inspectGedSchema({ manifestContents: "not json", legacyVersionContents: null }),
    ).toThrow(/manifest/i);
    expect(() =>
      inspectGedSchema({ manifestContents: null, legacyVersionContents: "2beta" }),
    ).toThrow(/legacy/i);
  });
});
