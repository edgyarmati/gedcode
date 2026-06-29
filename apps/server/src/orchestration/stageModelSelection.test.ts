import { describe, expect, it } from "vitest";
import {
  ProviderInstanceId,
  type ModelSelection,
  type OrchestrationProject,
  type OrchestrationTask,
} from "@t3tools/contracts";

import { resolveStageModelSelection } from "./stageModelSelection.ts";

function selection(instanceId: string, model: string): ModelSelection {
  return {
    instanceId: ProviderInstanceId.make(instanceId),
    model,
  };
}

function resolve(input?: {
  readonly taskSelection?: ModelSelection | undefined;
  readonly projectRoleSelection?: ModelSelection | undefined;
  readonly globalSelection?: ModelSelection | null | undefined;
  readonly projectDefaultSelection?: ModelSelection | null | undefined;
}) {
  const task = (
    input?.taskSelection === undefined ? {} : { roleModelSelections: { work: input.taskSelection } }
  ) satisfies Pick<OrchestrationTask, "roleModelSelections">;
  const project = (
    input?.projectRoleSelection === undefined
      ? { defaultModelSelection: input?.projectDefaultSelection ?? null }
      : {
          defaultModelSelection: input?.projectDefaultSelection ?? null,
          roleModelSelections: { work: input.projectRoleSelection },
        }
  ) satisfies Pick<OrchestrationProject, "defaultModelSelection" | "roleModelSelections">;

  return resolveStageModelSelection({
    task,
    project,
    orchestratorDefaults: {
      defaultWorkerModelSelection: input?.globalSelection ?? null,
    },
    role: "work",
  });
}

describe("resolveStageModelSelection", () => {
  it("prefers per-task role override over all defaults", () => {
    const taskSelection = selection("codex_task", "gpt-5-task");

    expect(
      resolve({
        taskSelection,
        projectRoleSelection: selection("codex_project_role", "gpt-5-project-role"),
        globalSelection: selection("codex_global", "gpt-5-global"),
        projectDefaultSelection: selection("codex_project", "gpt-5-project"),
      }),
    ).toEqual(taskSelection);
  });

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
