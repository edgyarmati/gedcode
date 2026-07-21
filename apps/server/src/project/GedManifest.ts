import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";

export const GED_MANIFEST_PATH = ".ged/MANIFEST.json";
export const LEGACY_GED_VERSION_PATH = ".ged/VERSION";
export const CURRENT_GED_SCHEMA_VERSION = 3;

export interface GedManifest {
  readonly schemaVersion: number;
  readonly updatedAt: string;
  readonly lastReviewedAt: string;
  readonly generatedBy: string;
}

export type GedSchemaInspection =
  | { readonly status: "missing"; readonly sourceSchemaVersion: 0 }
  | { readonly status: "legacy"; readonly sourceSchemaVersion: number }
  | {
      readonly status: "outdated" | "current" | "newer";
      readonly sourceSchemaVersion: number;
      readonly manifest: GedManifest;
    };

const MANIFEST_KEYS = ["generatedBy", "lastReviewedAt", "schemaVersion", "updatedAt"] as const;

const isIsoDateTime = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  return DateTime.make(value).pipe(
    Option.match({
      onNone: () => false,
      onSome: (parsed) => DateTime.formatIso(parsed) === value,
    }),
  );
};

export function decodeGedManifest(contents: string): GedManifest {
  let input: unknown;
  try {
    input = JSON.parse(contents);
  } catch {
    throw new Error("GED manifest is not valid JSON");
  }
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("GED manifest must be a JSON object");
  }
  const record = input as Record<string, unknown>;
  const keys = Object.keys(record).toSorted();
  if (
    keys.length !== MANIFEST_KEYS.length ||
    keys.some((key, index) => key !== MANIFEST_KEYS[index])
  ) {
    throw new Error(`GED manifest must contain exactly: ${MANIFEST_KEYS.join(", ")}`);
  }
  if (!Number.isSafeInteger(record.schemaVersion) || Number(record.schemaVersion) <= 0) {
    throw new Error("GED manifest schemaVersion must be a positive integer");
  }
  if (!isIsoDateTime(record.updatedAt)) {
    throw new Error("GED manifest updatedAt must be an ISO timestamp");
  }
  if (!isIsoDateTime(record.lastReviewedAt)) {
    throw new Error("GED manifest lastReviewedAt must be an ISO timestamp");
  }
  if (typeof record.generatedBy !== "string" || record.generatedBy.trim().length === 0) {
    throw new Error("GED manifest generatedBy must be a non-empty string");
  }
  return {
    schemaVersion: Number(record.schemaVersion),
    updatedAt: record.updatedAt,
    lastReviewedAt: record.lastReviewedAt,
    generatedBy: record.generatedBy.trim(),
  };
}

export function inspectGedSchema(input: {
  readonly manifestContents: string | null;
  readonly legacyVersionContents: string | null;
}): GedSchemaInspection {
  if (input.manifestContents !== null) {
    const manifest = decodeGedManifest(input.manifestContents);
    const status =
      manifest.schemaVersion === CURRENT_GED_SCHEMA_VERSION
        ? "current"
        : manifest.schemaVersion < CURRENT_GED_SCHEMA_VERSION
          ? "outdated"
          : "newer";
    return { status, sourceSchemaVersion: manifest.schemaVersion, manifest };
  }
  if (input.legacyVersionContents !== null) {
    const value = input.legacyVersionContents.trim();
    if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
      throw new Error("Legacy GED version must be a positive integer");
    }
    return { status: "legacy", sourceSchemaVersion: Number(value) };
  }
  return { status: "missing", sourceSchemaVersion: 0 };
}

export function encodeGedManifest(manifest: GedManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}
