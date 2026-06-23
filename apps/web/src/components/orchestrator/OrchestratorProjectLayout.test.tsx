import { describe, expect, it } from "vitest";

import {
  getOrchestratorPmSectionClassName,
  getOrchestratorProjectGridClassName,
} from "./OrchestratorProjectLayout";

describe("getOrchestratorProjectGridClassName", () => {
  it("uses the board column by default and full width when collapsed", () => {
    expect(getOrchestratorProjectGridClassName(false)).toContain(
      "lg:grid-cols-[minmax(0,1fr)_22rem]",
    );
    expect(getOrchestratorProjectGridClassName(true)).toContain("lg:grid-cols-1");
  });

  it("drops the board divider when the board is collapsed", () => {
    expect(getOrchestratorPmSectionClassName(false)).toContain("lg:border-r");
    expect(getOrchestratorPmSectionClassName(true)).not.toContain("lg:border-r");
  });
});
