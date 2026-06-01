import { ProviderInstanceId, type ModelSelection } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";
import {
  clearGedRoleModelSelection,
  resolveGedMainThreadModelSelection,
  resolveGedRoleModelSelection,
  setGedRoleModelSelection,
} from "./gedModelSelection.ts";

const selection = (name: string): ModelSelection => ({
  instanceId: ProviderInstanceId.make(`${name}_instance`),
  model: `${name}-model`,
});

const fallback = selection("fallback");
const globalMain = selection("global-main");
const projectMain = selection("project-main");
const parent = selection("parent");
const globalRole = selection("global-role");
const projectRole = selection("project-role");

describe("ged model selection resolver", () => {
  it("resolves main thread selection by existing thread, project, global, fallback order", () => {
    expect(resolveGedMainThreadModelSelection({ fallbackModelSelection: fallback })).toBe(fallback);
    expect(
      resolveGedMainThreadModelSelection({
        globalMainModelSelection: globalMain,
        fallbackModelSelection: fallback,
      }),
    ).toBe(globalMain);
    expect(
      resolveGedMainThreadModelSelection({
        projectDefaultModelSelection: projectMain,
        globalMainModelSelection: globalMain,
        fallbackModelSelection: fallback,
      }),
    ).toBe(projectMain);
    expect(
      resolveGedMainThreadModelSelection({
        existingThreadModelSelection: parent,
        projectDefaultModelSelection: projectMain,
        globalMainModelSelection: globalMain,
        fallbackModelSelection: fallback,
      }),
    ).toBe(parent);
  });

  it("resolves role selection by project role, global role, parent, project, global, fallback order", () => {
    expect(
      resolveGedRoleModelSelection({ role: "ged-explorer", fallbackModelSelection: fallback }),
    ).toBe(fallback);
    expect(
      resolveGedRoleModelSelection({
        role: "ged-explorer",
        globalMainModelSelection: globalMain,
        fallbackModelSelection: fallback,
      }),
    ).toBe(globalMain);
    expect(
      resolveGedRoleModelSelection({
        role: "ged-explorer",
        projectDefaultModelSelection: projectMain,
        globalMainModelSelection: globalMain,
        fallbackModelSelection: fallback,
      }),
    ).toBe(projectMain);
    expect(
      resolveGedRoleModelSelection({
        role: "ged-explorer",
        parentThreadModelSelection: parent,
        projectDefaultModelSelection: projectMain,
        globalMainModelSelection: globalMain,
        fallbackModelSelection: fallback,
      }),
    ).toBe(parent);
    expect(
      resolveGedRoleModelSelection({
        role: "ged-explorer",
        globalRoleModelSelections: { "ged-explorer": globalRole },
        parentThreadModelSelection: parent,
        fallbackModelSelection: fallback,
      }),
    ).toBe(globalRole);
    expect(
      resolveGedRoleModelSelection({
        role: "ged-explorer",
        projectRoleModelSelections: { "ged-explorer": projectRole },
        globalRoleModelSelections: { "ged-explorer": globalRole },
        parentThreadModelSelection: parent,
        fallbackModelSelection: fallback,
      }),
    ).toBe(projectRole);
  });

  it("resolves expanded role ids with the same precedence", () => {
    expect(
      resolveGedRoleModelSelection({
        role: "ged-verifier",
        projectRoleModelSelections: { "ged-verifier": projectRole },
        globalRoleModelSelections: { "ged-verifier": globalRole },
        parentThreadModelSelection: parent,
        projectDefaultModelSelection: projectMain,
        globalMainModelSelection: globalMain,
        fallbackModelSelection: fallback,
      }),
    ).toBe(projectRole);
  });

  it("updates and clears role maps immutably", () => {
    const original = { "ged-explorer": globalRole };
    const set = setGedRoleModelSelection(original, "ged-explorer", projectRole);
    expect(set).toEqual({ "ged-explorer": projectRole });
    expect(original).toEqual({ "ged-explorer": globalRole });
    const cleared = clearGedRoleModelSelection(set, "ged-explorer");
    expect(cleared).toEqual({});
    expect(set).toEqual({ "ged-explorer": projectRole });
  });

  it("updates and clears expanded role ids", () => {
    const set = setGedRoleModelSelection({}, "ged-worker", projectRole);
    expect(set).toEqual({ "ged-worker": projectRole });
    expect(clearGedRoleModelSelection(set, "ged-worker")).toEqual({});
  });
});
