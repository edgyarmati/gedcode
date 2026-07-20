import { describe, expect, it } from "vitest";

import { resolveAvailableEditorOptions } from "./editorOptions";

describe("resolveAvailableEditorOptions", () => {
  it("uses branded labels and icons for available editors only", () => {
    const options = resolveAvailableEditorOptions("Linux x86_64", ["cursor", "vscode", "zed"]);

    expect(options.map(({ label, value }) => ({ label, value }))).toEqual([
      { label: "Cursor", value: "cursor" },
      { label: "VS Code", value: "vscode" },
      { label: "Zed", value: "zed" },
    ]);
    expect(options.every((option) => option.Icon)).toBe(true);
  });

  it.each([
    ["MacIntel", "Finder"],
    ["Win32", "Explorer"],
    ["Linux x86_64", "Files"],
  ])("uses %s file-manager labeling", (platform, label) => {
    expect(resolveAvailableEditorOptions(platform, ["file-manager"])).toMatchObject([
      { label, value: "file-manager" },
    ]);
  });
});
