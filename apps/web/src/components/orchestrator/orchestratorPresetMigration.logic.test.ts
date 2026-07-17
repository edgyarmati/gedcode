import {
  ProjectId,
  ProviderInstanceId,
  type ModelSelection,
  type OrchestratorPresetMigrationState,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  buildPresetMigrationCompletion,
  emptyPresetDraft,
  isPresetMigrationDraftComplete,
} from "./orchestratorPresetMigration.logic";

const selection: ModelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5.6-sol",
  options: [{ id: "effort", value: "medium" }],
};
const projectId = ProjectId.make("project-existing");
const state: OrchestratorPresetMigrationState = {
  status: "required",
  legacyGlobalSelection: null,
  projects: [{ projectId, title: "Existing project", roleModelSelections: {} }],
};

describe("orchestrator preset migration draft", () => {
  it("requires all global presets and an explicit decision for every project", () => {
    const global = emptyPresetDraft();
    global.cheap = selection;
    global.smart = selection;
    global.genius = selection;

    expect(isPresetMigrationDraftComplete({ state, global, projects: new Map() })).toBe(false);
    expect(
      isPresetMigrationDraftComplete({
        state,
        global,
        projects: new Map([[projectId, { kind: "inherit" }]]),
      }),
    ).toBe(true);
  });

  it("requires a real override when a project chooses customization", () => {
    const global = { cheap: selection, smart: selection, genius: selection };
    expect(
      buildPresetMigrationCompletion({
        state,
        global,
        projects: new Map([[projectId, { kind: "customize", presets: emptyPresetDraft() }]]),
      }),
    ).toBeNull();

    expect(
      buildPresetMigrationCompletion({
        state,
        global,
        projects: new Map([
          [
            projectId,
            {
              kind: "customize",
              presets: { cheap: null, smart: selection, genius: null },
            },
          ],
        ]),
      }),
    ).toEqual({
      globalPresets: global,
      projects: [{ projectId, capabilityPresets: { smart: selection } }],
    });
  });
});
