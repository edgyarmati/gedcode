// @effect-diagnostics nodeBuiltinImport:off

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  COMPOSER_DRAFT_STORAGE_KEY,
  COMPOSER_DRAFT_STORAGE_VERSION,
  migratePersistedComposerDraftStoreState,
} from "./composerDraftStore";
import {
  HELPER_DISMISSAL_STORAGE_KEY,
  HELPER_DISMISSAL_STORAGE_VERSION,
  migratePersistedHelperDismissalState,
} from "./helperDismissalStore";
import {
  migratePersistedTerminalStateStoreState,
  TERMINAL_STATE_STORAGE_VERSION,
} from "./terminalStateStore";

interface BrowserFixtureManifestEntry {
  readonly id: string;
  readonly tag: string;
  readonly releases: ReadonlyArray<string>;
  readonly file: string;
  readonly commit: string;
  readonly sourceBlob: string;
  readonly sha256: string;
}

interface ReleaseCompatibilityManifest {
  readonly publishedGedcodeReleases: ReadonlyArray<string>;
  readonly browser: {
    readonly composer: ReadonlyArray<BrowserFixtureManifestEntry>;
    readonly terminal: ReadonlyArray<BrowserFixtureManifestEntry>;
    readonly helperDismissal: ReadonlyArray<BrowserFixtureManifestEntry>;
  };
}

interface PersistedPayload {
  readonly key: string;
  readonly version: number;
  readonly state: unknown;
}

const manifest = JSON.parse(
  readFileSync(
    new URL("../../../docs/release-compatibility-fixtures.json", import.meta.url),
    "utf8",
  ),
) as ReleaseCompatibilityManifest;
const browserFixtureDirectory = new URL("./fixtures/published-releases/", import.meta.url);

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function readPayload(fixture: BrowserFixtureManifestEntry): PersistedPayload {
  const bytes = readFileSync(new URL(fixture.file, browserFixtureDirectory));
  expect(sha256(bytes)).toBe(fixture.sha256);
  expect(fixture.commit).toMatch(/^[0-9a-f]{40}$/u);
  expect(fixture.sourceBlob).toMatch(/^[0-9a-f]{40}$/u);
  return JSON.parse(bytes.toString("utf8")) as PersistedPayload;
}

describe("published release browser persistence fixtures", () => {
  it("captures browser state independently from every published GedCode tag", () => {
    expect(manifest.browser.composer.map((entry) => entry.tag).toSorted()).toEqual(
      manifest.publishedGedcodeReleases.toSorted(),
    );
    expect(manifest.browser.terminal.map((entry) => entry.tag).toSorted()).toEqual(
      manifest.publishedGedcodeReleases.toSorted(),
    );
    expect(manifest.browser.helperDismissal.map((entry) => entry.tag).toSorted()).toEqual([
      "v0.4.0",
      "v0.4.1",
      "v0.4.2",
      "v0.4.3",
    ]);
    for (const fixture of [
      ...manifest.browser.composer,
      ...manifest.browser.terminal,
      ...manifest.browser.helperDismissal,
    ]) {
      expect(fixture.releases).toEqual([fixture.tag]);
    }
  });

  it.each(manifest.browser.composer)(
    "hydrates the actual $tag composer payload without losing the draft",
    (fixture) => {
      const payload = readPayload(fixture);
      expect(payload.key).toBe(COMPOSER_DRAFT_STORAGE_KEY);
      expect(payload.version).toBeLessThanOrEqual(COMPOSER_DRAFT_STORAGE_VERSION);

      const migrated = migratePersistedComposerDraftStoreState(payload.state);
      expect(Object.values(migrated.draftsByThreadKey)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ prompt: `published draft from ${fixture.tag}` }),
        ]),
      );
    },
  );

  it.each(manifest.browser.terminal)(
    "hydrates the actual $tag terminal payload without losing layout state",
    (fixture) => {
      const payload = readPayload(fixture);
      expect(payload.key).toBe("t3code:terminal-state:v1");
      expect(payload.version).toBeLessThanOrEqual(TERMINAL_STATE_STORAGE_VERSION);

      const state =
        payload.version < TERMINAL_STATE_STORAGE_VERSION
          ? migratePersistedTerminalStateStoreState(payload.state, payload.version)
          : (payload.state as {
              readonly terminalStateByThreadKey?: Record<
                string,
                { readonly terminalOpen?: boolean; readonly terminalHeight?: number }
              >;
            });
      expect(Object.values(state.terminalStateByThreadKey ?? {})).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ terminalOpen: true, terminalHeight: 321 }),
        ]),
      );
    },
  );

  it.each(manifest.browser.helperDismissal)(
    "hydrates the actual $tag helper-dismissal payload",
    (fixture) => {
      const payload = readPayload(fixture);
      expect(payload.key).toBe(HELPER_DISMISSAL_STORAGE_KEY);
      expect(payload.version).toBeLessThanOrEqual(HELPER_DISMISSAL_STORAGE_VERSION);

      const state = migratePersistedHelperDismissalState(payload.state, payload.version);
      expect(Object.values(state.dismissedAtByHelperKey)).toContain(1_767_225_600_000);
    },
  );
});
