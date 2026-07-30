import { expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { SidebarProvider } from "./ui/sidebar";
import { InboxSidebar } from "./InboxSidebar";

it("renders the flat Inbox contract and opens Orchestrator entries in their project workspace", async () => {
  const navigate = vi.fn();
  await render(
    <SidebarProvider>
      <InboxSidebar
        entries={{
          normal: {
            shelves: {
              active: [{ id: "normal-active", title: "Active normal task" }],
              snoozed: [{ id: "normal-snoozed", title: "Snoozed normal task" }],
              settled: [{ id: "normal-settled", title: "Settled normal task" }],
            },
            selected: null,
          },
          orchestrator: [
            {
              id: "task-blocked",
              title: "Blocked task",
              projectId: "project-1",
              route: {
                to: "/orch/$environmentId/$projectId",
                params: { environmentId: "environment-1", projectId: "project-1" },
              },
            },
          ],
        }}
        onNavigate={navigate}
      />
    </SidebarProvider>,
  );

  await expect.element(page.getByTestId("inbox-primary-switch")).toBeInTheDocument();
  await expect
    .element(page.getByRole("button", { name: "Inbox", exact: true }))
    .toBeInTheDocument();
  await expect
    .element(page.getByRole("button", { name: "Orchestrator", exact: true }))
    .toBeInTheDocument();
  await expect
    .element(page.getByTestId("inbox-primary-switch"))
    .toHaveAttribute("data-animated-long-pill", "true");

  await expect.element(page.getByRole("button", { name: "Normal tasks" })).toBeInTheDocument();
  await expect
    .element(page.getByRole("button", { name: "Orchestrator tasks" }))
    .toBeInTheDocument();
  await expect.element(page.getByText("Active normal task")).toBeInTheDocument();
  await expect.element(page.getByRole("button", { name: "Snoozed" })).toBeInTheDocument();
  await expect.element(page.getByRole("button", { name: "Settled" })).toBeInTheDocument();
  await expect.element(page.getByText("Snoozed normal task")).not.toBeInTheDocument();
  await expect.element(page.getByText("Settled normal task")).not.toBeInTheDocument();
  await expect.element(page.getByText("Project: project-1")).not.toBeInTheDocument();

  await page.getByRole("button", { name: "Orchestrator tasks" }).click();
  await expect.element(page.getByText("Blocked task")).toBeInTheDocument();
  await page.getByText("Blocked task").click();
  expect(navigate).toHaveBeenCalledWith({
    to: "/orch/$environmentId/$projectId",
    params: { environmentId: "environment-1", projectId: "project-1" },
  });
});
