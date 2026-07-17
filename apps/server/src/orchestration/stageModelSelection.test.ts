import { describe, expect, it } from "vitest";
import {
  ProviderInstanceId,
  type ModelSelection,
  type OrchestrationProject,
} from "@t3tools/contracts";

import { resolveCapabilityPreset, resolveStageModelSelection } from "./stageModelSelection.ts";

function selection(instanceId: string, model: string): ModelSelection {
  return {
    instanceId: ProviderInstanceId.make(instanceId),
    model,
  };
}

function resolve(input?: {
  readonly projectRoleSelection?: ModelSelection | undefined;
  readonly globalSelection?: ModelSelection | null | undefined;
  readonly projectDefaultSelection?: ModelSelection | null | undefined;
}) {
  const project = (
    input?.projectRoleSelection === undefined
      ? { defaultModelSelection: input?.projectDefaultSelection ?? null }
      : {
          defaultModelSelection: input?.projectDefaultSelection ?? null,
          roleModelSelections: { work: input.projectRoleSelection },
        }
  ) satisfies Pick<OrchestrationProject, "defaultModelSelection" | "roleModelSelections">;

  return resolveStageModelSelection({
    project,
    orchestratorDefaults: {
      defaultWorkerModelSelection: input?.globalSelection ?? null,
    },
    role: "work",
  });
}

describe("resolveStageModelSelection", () => {
  it("prefers project role selection over global and project defaults", () => {
    const projectRoleSelection = selection("codex_project_role", "gpt-5-project-role");

    expect(
      resolve({
        projectRoleSelection,
        globalSelection: selection("codex_global", "gpt-5-global"),
        projectDefaultSelection: selection("codex_project", "gpt-5-project"),
      }),
    ).toEqual(projectRoleSelection);
  });

  it("uses the global worker default before the project default", () => {
    const globalSelection = selection("codex_global", "gpt-5-global");

    expect(
      resolve({
        globalSelection,
        projectDefaultSelection: selection("codex_project", "gpt-5-project"),
      }),
    ).toEqual(globalSelection);
  });

  it("falls back to the project default when no higher-priority selection exists", () => {
    const projectDefaultSelection = selection("codex_project", "gpt-5-project");

    expect(resolve({ projectDefaultSelection })).toEqual(projectDefaultSelection);
  });

  it("returns null when no selection resolves", () => {
    expect(resolve()).toBeNull();
  });
});

describe("resolveCapabilityPreset", () => {
  const globalPresets = {
    cheap: selection("codex-cheap", "gpt-mini"),
    smart: selection("codex-smart", "gpt-smart"),
    genius: selection("claude-genius", "opus"),
  };

  it("lets a project override one preset while inheriting the others", () => {
    expect(
      resolveCapabilityPreset({
        orchestratorDefaults: { capabilityPresets: globalPresets },
        projectConfig: {
          capabilityPresets: { smart: selection("claude-smart", "sonnet") },
        },
        tier: "smart",
      }),
    ).toEqual(selection("claude-smart", "sonnet"));

    expect(
      resolveCapabilityPreset({
        orchestratorDefaults: { capabilityPresets: globalPresets },
        projectConfig: { capabilityPresets: {} },
        tier: "genius",
      }),
    ).toEqual(globalPresets.genius);
  });

  it("returns null while global preset migration is incomplete", () => {
    expect(
      resolveCapabilityPreset({
        orchestratorDefaults: { capabilityPresets: null },
        projectConfig: { capabilityPresets: {} },
        tier: "cheap",
      }),
    ).toBeNull();
  });
});
