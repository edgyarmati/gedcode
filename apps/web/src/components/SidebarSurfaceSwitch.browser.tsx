import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { afterEach, expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { useUiStateStore } from "../uiStateStore";
import { SidebarSurfaceSwitch } from "./Sidebar";
import { SidebarProvider } from "./ui/sidebar";

afterEach(() => {
  useUiStateStore.setState({
    orchestratorMode: false,
    lastOrchestratorProject: null,
  });
});

it("switches between the restored Chat sidebar and Orchestrator with the animated pill", async () => {
  const rootRoute = createRootRoute({
    component: () => (
      <SidebarProvider>
        <SidebarSurfaceSwitch />
      </SidebarProvider>
    ),
  });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => null,
  });
  const orchestratorRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/orch",
    component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, orchestratorRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });

  await render(<RouterProvider router={router} />);

  const surfaceSwitch = page.getByTestId("sidebar-surface-switch");
  await expect.element(surfaceSwitch).toHaveAttribute("data-animated-long-pill", "true");
  await expect
    .element(surfaceSwitch.getByRole("button", { name: "Chat", exact: true }))
    .toHaveAttribute("aria-pressed", "true");

  await surfaceSwitch.getByRole("button", { name: "Orchestrator", exact: true }).click();

  await expect.poll(() => router.state.location.pathname).toBe("/orch");
  await expect
    .element(surfaceSwitch.getByRole("button", { name: "Orchestrator", exact: true }))
    .toHaveAttribute("aria-pressed", "true");
});
