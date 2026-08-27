import { describe, expect, it } from "vitest";

import {
  COMPOSER_DRAFT_STORAGE_VERSION,
  migratePersistedComposerDraftStoreState,
} from "./composerDraftStore";
import { HELPER_DISMISSAL_STORAGE_VERSION } from "./helperDismissalStore";
import { PUBLISHED_RELEASE_BROWSER_PERSISTENCE_FIXTURES } from "./releasePersistenceFixtures";
import { TERMINAL_STATE_STORAGE_VERSION } from "./terminalStateStore";

const RELEASE_DRAFT_KEY = "release-fixture-environment\0release-fixture-thread";

describe("published release browser persistence matrix", () => {
  it.each(PUBLISHED_RELEASE_BROWSER_PERSISTENCE_FIXTURES)(
    "$tag has a supported migration path",
    ({ composer, terminal, helperDismissal }) => {
      expect(composer).toBeLessThanOrEqual(COMPOSER_DRAFT_STORAGE_VERSION);
      expect(terminal).toBeLessThanOrEqual(TERMINAL_STATE_STORAGE_VERSION);
      if (helperDismissal !== null) {
        expect(helperDismissal).toBeLessThanOrEqual(HELPER_DISMISSAL_STORAGE_VERSION);
      }

      // Zustand only invokes `migrate` for an older stored version. The v6
      // release payload exercises the only published composer upgrade boundary;
      // v7 payloads already match the current shape and are hydrated directly.
      if (composer < COMPOSER_DRAFT_STORAGE_VERSION) {
        const migrated = migratePersistedComposerDraftStoreState({
          draftsByThreadKey: {
            [RELEASE_DRAFT_KEY]: {
              prompt: "published release draft",
              attachments: [],
              modelSelectionByProvider: {},
              activeProvider: null,
            },
          },
          draftThreadsByThreadKey: {},
          logicalProjectDraftThreadKeyByLogicalProjectKey: {},
          stickyModelSelectionByProvider: {},
          stickyActiveProvider: null,
        });

        expect(migrated.draftsByThreadKey[RELEASE_DRAFT_KEY]?.prompt).toBe(
          "published release draft",
        );
      }
    },
  );
});
