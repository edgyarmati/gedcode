import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { initialEnvironmentState, useStore } from "../store";
import type { SidebarThreadSummary } from "../types";
import { useUiStateStore } from "../uiStateStore";
import { AppAtomRegistryProvider } from "../rpc/atomRegistry";
import Sidebar from "./Sidebar";
import { SidebarProvider } from "./ui/sidebar";

const environmentId = EnvironmentId.make("env-inbox-sidebar");
const projectId = ProjectId.make("project-inbox-sidebar");
const threadId = ThreadId.make("thread-inbox-sidebar");

function seedStore(): void {
  const thread: SidebarThreadSummary = {
    id: threadId,
    environmentId,
    projectId,
    title: "Active normal task",
    interactionMode: "default",
    session: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    archivedAt: null,
    latestTurn: null,
    branch: null,
    worktreePath: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    inboxLifecycle: "active",
  } as SidebarThreadSummary;

  useStore.setState({
    activeEnvironmentId: environmentId,
    environmentStateById: {
      [environmentId]: {
        ...initialEnvironmentState,
        projectIds: [projectId],
        projectById: {
          [projectId]: {
            id: projectId,
            environmentId,
            name: "Inbox project",
            cwd: "/tmp/inbox-project",
            defaultModelSelection: {
              instanceId: ProviderInstanceId.make("codex"),
              model: "gpt-5-codex",
            },
            createdAt: "2026-07-01T00:00:00.000Z",
            updatedAt: "2026-07-01T00:00:00.000Z",
            scripts: [],
          },
        },
        threadIds: [threadId],
        sidebarThreadSummaryById: { [threadId]: thread },
        bootstrapComplete: true,
      },
    },
  });
}

afterEach(() => {
  useStore.setState({ activeEnvironmentId: null, environmentStateById: {} });
  useUiStateStore.setState({
    orchestratorMode: false,
    lastOrchestratorProject: null,
    projectOrder: [],
  });
});

it("switches the actual sidebar from Inbox to the Orchestrator project navigator", async () => {
  seedStore();
  const rootRoute = createRootRoute({
    component: () => (
      <SidebarProvider>
        <Sidebar />
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
  const projectRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/orch/$environmentId/$projectId",
    component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, orchestratorRoute, projectRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });

  await render(
    <QueryClientProvider client={new QueryClient()}>
      <AppAtomRegistryProvider>
        <RouterProvider router={router} />
      </AppAtomRegistryProvider>
    </QueryClientProvider>,
  );

  await expect
    .element(page.getByTestId("inbox-primary-switch"))
    .toHaveAttribute("data-animated-long-pill", "true");
  await expect.element(page.getByText("Active normal task")).toBeInTheDocument();

  await page
    .getByTestId("inbox-primary-switch")
    .getByRole("button", { name: "Orchestrator", exact: true })
    .click();
  await expect
    .element(page.getByTestId(`orchestrator-project-row-${projectId}`))
    .toBeInTheDocument();

  await page.getByTestId(`orchestrator-project-row-${projectId}`).click();
  await expect
    .poll(() => router.state.location.pathname)
    .toBe(`/orch/${environmentId}/${projectId}`);
});
