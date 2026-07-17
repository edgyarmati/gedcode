import {
  DEFAULT_SERVER_SETTINGS,
  ProjectId,
  ProviderInstanceId,
  type OrchestrationProject,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  buildOrchestratorPresetMigrationState,
  configuredOrchestratorDefaults,
  validateOrchestratorPresetMigrationCompletion,
} from "./orchestratorPresetMigration.ts";

const now = "2026-07-18T00:00:00.000Z";
const selection = (instanceId: string, model: string) => ({
  instanceId: ProviderInstanceId.make(instanceId),
  model,
});
const project = (id: string, roleModelSelections = {}): OrchestrationProject => ({
  id: ProjectId.make(id),
  title: id,
  workspaceRoot: `/tmp/${id}`,
  defaultModelSelection: null,
  roleModelSelections,
  rolePromptPrefixes: {},
  orchestratorConfig: {},
  scripts: [],
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
});

describe("Orchestrator preset migration state", () => {
  const legacyProject = project("legacy-project", {
    work: selection("codex-worker", "gpt-worker"),
  });
  const globalPresets = {
    cheap: selection("codex-cheap", "gpt-mini"),
    smart: selection("codex-smart", "gpt-smart"),
    genius: selection("claude-genius", "opus"),
  };

  it("enumerates only live projects with legacy role selections", () => {
    const state = buildOrchestratorPresetMigrationState({
      settings: {
        ...DEFAULT_SERVER_SETTINGS,
        orchestratorDefaults: {
          ...DEFAULT_SERVER_SETTINGS.orchestratorDefaults,
          defaultWorkerModelSelection: selection("codex-global", "gpt-global"),
        },
      },
      readModel: {
        projects: [
          project("clean-project"),
          legacyProject,
          { ...project("deleted-project", { plan: selection("codex", "gpt") }), deletedAt: now },
        ],
      },
    });

    expect(state).toMatchObject({
      status: "required",
      legacyGlobalSelection: selection("codex-global", "gpt-global"),
      projects: [
        { projectId: legacyProject.id, roleModelSelections: legacyProject.roleModelSelections },
      ],
    });
  });

  it("rejects missing, duplicate, and unknown project decisions", () => {
    const state = buildOrchestratorPresetMigrationState({
      settings: DEFAULT_SERVER_SETTINGS,
      readModel: { projects: [legacyProject] },
    });
    expect(() =>
      validateOrchestratorPresetMigrationCompletion({
        state,
        completion: { globalPresets, projects: [] },
      }),
    ).toThrow(/missing/);
    expect(() =>
      validateOrchestratorPresetMigrationCompletion({
        state,
        completion: {
          globalPresets,
          projects: [
            { projectId: legacyProject.id, capabilityPresets: {} },
            { projectId: legacyProject.id, capabilityPresets: {} },
          ],
        },
      }),
    ).toThrow(/Duplicate/);
    expect(() =>
      validateOrchestratorPresetMigrationCompletion({
        state,
        completion: {
          globalPresets,
          projects: [{ projectId: ProjectId.make("unknown"), capabilityPresets: {} }],
        },
      }),
    ).toThrow(/missing.*unknown/);
  });

  it("marks migration complete only after persisting complete global presets", () => {
    const settings = {
      ...DEFAULT_SERVER_SETTINGS,
      orchestratorDefaults: configuredOrchestratorDefaults({
        settings: DEFAULT_SERVER_SETTINGS,
        globalPresets,
      }),
    };
    const state = buildOrchestratorPresetMigrationState({
      settings,
      readModel: { projects: [legacyProject] },
    });
    expect(state.status).toBe("completed");
    expect(settings.orchestratorDefaults.defaultWorkerModelSelection).toBeNull();
    expect(settings.orchestratorDefaults.capabilityPresets).toEqual(globalPresets);
  });
});
