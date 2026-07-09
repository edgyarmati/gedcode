import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  TaskId,
  TaskTypeId,
  ThreadId,
} from "@t3tools/contracts";
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

import { initialEnvironmentState, useStore } from "../../store";
import type { OrchestratorTask, SidebarThreadSummary } from "../../types";
import { SidebarProvider } from "../ui/sidebar";
import { OrchestratorSidebarNav } from "./OrchestratorSidebarNav";

const environmentId = EnvironmentId.make("env-sidebar");
const projectId = ProjectId.make("proj-sidebar");
const blockedTaskId = TaskId.make("task-blocked");
const runningTaskId = TaskId.make("task-running");
const runningStageThreadId = ThreadId.make("thread-running-stage");

function makeTask(overrides: Partial<OrchestratorTask>): OrchestratorTask {
  return {
    id: TaskId.make("task"),
    environmentId,
    projectId,
    type: TaskTypeId.make("feature"),
    title: "Task",
    status: "working",
    branch: null,
    worktreePath: null,
    prUrl: null,
    pmMessageId: null,
    stageThreadIds: [],
    currentStageThreadId: null,
    roleModelSelections: {},
    playbookVersion: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeRunningSummary(): SidebarThreadSummary {
  return {
    id: runningStageThreadId,
    environmentId,
    projectId,
    title: "Working stage",
    interactionMode: "default",
    session: {
      provider: "codex",
      status: "running",
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
      orchestrationStatus: "running",
    },
    createdAt: "2026-07-01T00:00:00.000Z",
    archivedAt: null,
    latestTurn: null,
    branch: null,
    worktreePath: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
  } as SidebarThreadSummary;
}

function seedStore(): void {
  const blockedTask = makeTask({ id: blockedTaskId, status: "blocked", title: "Blocked task" });
  const runningTask = makeTask({
    id: runningTaskId,
    status: "working",
    title: "Running task",
    stageThreadIds: [runningStageThreadId],
    currentStageThreadId: runningStageThreadId,
  });
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
            name: "Sidebar Project",
            cwd: "/tmp/sidebar-project",
            defaultModelSelection: {
              instanceId: ProviderInstanceId.make("codex"),
              model: "gpt-5-codex",
            },
            createdAt: "2026-07-01T00:00:00.000Z",
            updatedAt: "2026-07-01T00:00:00.000Z",
            scripts: [],
          },
        },
        taskIds: [String(blockedTaskId), String(runningTaskId)],
        taskIdsByProjectId: {
          [projectId]: [String(blockedTaskId), String(runningTaskId)],
        },
        taskById: {
          [String(blockedTaskId)]: blockedTask,
          [String(runningTaskId)]: runningTask,
        },
        sidebarThreadSummaryById: {
          [runningStageThreadId]: makeRunningSummary(),
        },
        bootstrapComplete: true,
      },
    },
  });
}

function renderNav() {
  const rootRoute = createRootRoute({
    component: () => (
      <SidebarProvider>
        <OrchestratorSidebarNav />
      </SidebarProvider>
    ),
  });
  const orchProjectRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/orch/$environmentId/$projectId",
    component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([orchProjectRoute]),
    history: createMemoryHistory({
      initialEntries: [`/orch/${environmentId}/${projectId}`],
    }),
  });
  return render(<RouterProvider router={router} />);
}

afterEach(() => {
  useStore.setState({ activeEnvironmentId: null, environmentStateById: {} });
});

it("renders a project row with needs-attention and active counts and a running pulse", async () => {
  seedStore();
  renderNav();

  await expect
    .element(page.getByTestId(`orchestrator-project-row-${projectId}`))
    .toBeInTheDocument();
  await expect.element(page.getByText("Sidebar Project")).toBeInTheDocument();
  // One blocked task → needs attention = 1; one working task → active = 1.
  await expect.element(page.getByLabelText("1 needs attention")).toBeInTheDocument();
  await expect.element(page.getByLabelText("1 active")).toBeInTheDocument();
  // The working task's stage thread has a running session → pulse present.
  await expect.element(page.getByLabelText("Running")).toBeInTheDocument();
});
