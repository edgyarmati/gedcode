import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import {
  getOrchestratorProjectGridClassName,
  OrchestratorBoardVisibilityButton,
} from "./OrchestratorProjectLayout";
import { useUiStateStore } from "../../uiStateStore";

function Harness() {
  const collapsed = useUiStateStore((state) => state.orchestratorBoardCollapsed);
  const setCollapsed = useUiStateStore((state) => state.setOrchestratorBoardCollapsed);

  return (
    <>
      <OrchestratorBoardVisibilityButton collapsed={collapsed} setCollapsed={setCollapsed} />
      <main className={getOrchestratorProjectGridClassName(collapsed)} data-testid="project-grid">
        <section>PM chat</section>
        {collapsed ? null : <aside>Tasks</aside>}
      </main>
    </>
  );
}

describe("orchestrator project board visibility", () => {
  it("defaults to showing the board and lets the chat take the full width when hidden", async () => {
    useUiStateStore.setState({ orchestratorBoardCollapsed: false });

    const screen = await render(<Harness />);

    try {
      await expect.element(screen.getByText("Tasks")).toBeInTheDocument();
      await expect
        .element(screen.getByTestId("project-grid"))
        .toHaveClass(/lg:grid-cols-\[minmax\(0,1fr\)_22rem\]/);

      const toggle = screen.getByRole("button", { name: "Hide task board" });
      await expect.element(toggle).toHaveAttribute("aria-expanded", "true");
      await expect.element(toggle).toHaveAttribute("aria-pressed", "false");

      await toggle.click();

      await expect.element(screen.getByText("Tasks")).not.toBeInTheDocument();
      await expect.element(screen.getByTestId("project-grid")).toHaveClass(/lg:grid-cols-1/);
      expect(useUiStateStore.getState().orchestratorBoardCollapsed).toBe(true);
      await expect
        .element(screen.getByRole("button", { name: "Show task board" }))
        .toHaveAttribute("aria-expanded", "false");
    } finally {
      await screen.unmount();
    }
  });
});
