import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DiffPanelShell } from "./DiffPanelShell";

describe("DiffPanelShell", () => {
  it("stacks sidebar header controls so narrow rails do not clip them", () => {
    const markup = renderToStaticMarkup(
      <DiffPanelShell
        mode="sidebar"
        header={
          <>
            <div>Turn selector</div>
            <div>View controls</div>
          </>
        }
      >
        <div>Diff</div>
      </DiffPanelShell>,
    );

    expect(markup).toContain("flex-col items-stretch");
    expect(markup).toContain("Turn selector");
    expect(markup).toContain("View controls");
  });
});
