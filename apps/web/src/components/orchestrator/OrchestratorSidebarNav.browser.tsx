import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  TaskId,
  TaskTypeId,
  ThreadId,
  type EnvironmentApi,
} from "@t3tools/contracts";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { useCommandPaletteStore } from "../../commandPaletteStore";
import { CLIENT_SETTINGS_STORAGE_KEY } from "../../clientPersistenceStorage";
import { getClientSettings } from "../../hooks/useSettings";
import {
  __resetEnvironmentApiOverridesForTests,
  __setEnvironmentApiOverrideForTests,
} from "../../environmentApi";
import { __resetLocalApiForTests } from "../../localApi";
import { getProjectOrderKey } from "../../logicalProject";
import { initialEnvironmentState, useStore } from "../../store";
import type { OrchestratorTask, SidebarThreadSummary } from "../../types";
import { useUiStateStore } from "../../uiStateStore";
import { SidebarProvider } from "../ui/sidebar";
import { OrchestratorSidebarNav } from "./OrchestratorSidebarNav";

const environmentId = EnvironmentId.make("env-sidebar");
const projectId = ProjectId.make("proj-sidebar");
const secondProjectId = ProjectId.make("proj-sidebar-second");
const blockedTaskId = TaskId.make("task-blocked");
const runningTaskId = TaskId.make("task-running");
const runningStageThreadId = ThreadId.make("thread-running-stage");
const realOpenAddProject = useCommandPaletteStore.getState().openAddProject;

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
    cancellation: null,
    changeReview: null,
    verification: null,
    noChangesNeeded: null,
    landing: null,
    archivedAt: null,
    deletedAt: null,
    roleCapabilityTiers: {},
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

function seedSortableProjects(): void {
  const latestActivityThreadId = ThreadId.make("thread-latest-activity");
  const newestProjectThreadId = ThreadId.make("thread-newest-project");
  const latestActivityProject = {
    id: projectId,
    environmentId,
    name: "Latest activity",
    cwd: "/tmp/latest-activity",
    defaultModelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5-codex",
    },
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    scripts: [],
  };
  const newestProject = {
    ...latestActivityProject,
    id: secondProjectId,
    name: "Newest project",
    cwd: "/tmp/newest-project",
    createdAt: "2026-07-03T00:00:00.000Z",
    updatedAt: "2026-07-03T00:00:00.000Z",
  };
  const summary = (input: {
    id: ThreadId;
    projectId: ProjectId;
    createdAt: string;
    latestUserMessageAt: string;
  }): SidebarThreadSummary =>
    ({
      ...makeRunningSummary(),
      ...input,
      session: null,
      title: String(input.id),
      latestUserMessageAt: input.latestUserMessageAt,
    }) as SidebarThreadSummary;

  useStore.setState({
    activeEnvironmentId: environmentId,
    environmentStateById: {
      [environmentId]: {
        ...initialEnvironmentState,
        projectIds: [projectId, secondProjectId],
        projectById: {
          [projectId]: latestActivityProject,
          [secondProjectId]: newestProject,
        },
        threadIds: [latestActivityThreadId, newestProjectThreadId],
        sidebarThreadSummaryById: {
          [latestActivityThreadId]: summary({
            id: latestActivityThreadId,
            projectId,
            createdAt: "2026-07-01T00:00:00.000Z",
            latestUserMessageAt: "2026-07-05T00:00:00.000Z",
          }),
          [newestProjectThreadId]: summary({
            id: newestProjectThreadId,
            projectId: secondProjectId,
            createdAt: "2026-07-03T00:00:00.000Z",
            latestUserMessageAt: "2026-07-04T00:00:00.000Z",
          }),
        },
        bootstrapComplete: true,
      },
    },
  });
  useUiStateStore.setState({
    projectOrder: [getProjectOrderKey(newestProject), getProjectOrderKey(latestActivityProject)],
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

beforeEach(async () => {
  window.localStorage.removeItem(CLIENT_SETTINGS_STORAGE_KEY);
  await __resetLocalApiForTests();
});

afterEach(async () => {
  __resetEnvironmentApiOverridesForTests();
  useStore.setState({ activeEnvironmentId: null, environmentStateById: {} });
  useUiStateStore.setState({ projectOrder: [] });
  useCommandPaletteStore.setState({
    open: false,
    openIntent: null,
    openAddProject: realOpenAddProject,
  });
  window.localStorage.removeItem(CLIENT_SETTINGS_STORAGE_KEY);
  await __resetLocalApiForTests();
});

it("uses a custom project menu and renames through the environment command API", async () => {
  const dispatchCommand = vi.fn(async (_command: unknown) => ({ sequence: 2 }));
  __setEnvironmentApiOverrideForTests(environmentId, {
    orchestration: { dispatchCommand },
  } as unknown as EnvironmentApi);
  seedStore();
  renderNav();

  await page.getByTestId(`orchestrator-project-row-${projectId}`).click({ button: "right" });
  await expect.element(page.getByRole("button", { name: "Rename project" })).toBeInTheDocument();
  await expect.element(page.getByRole("button", { name: "Remove project" })).toBeDisabled();
  (page.getByRole("button", { name: "Rename project" }).element() as HTMLButtonElement).click();

  const title = page.getByRole("textbox", { name: "Project title" });
  await title.fill("Renamed project");
  title.element().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

  await expect.poll(() => dispatchCommand.mock.calls.length).toBe(1);
  expect(dispatchCommand.mock.calls[0]?.[0]).toMatchObject({
    type: "project.meta.update",
    projectId,
    title: "Renamed project",
  });
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

it("opens the add-project flow from the orchestrator sidebar", async () => {
  const openAddProject = vi.fn();
  useCommandPaletteStore.setState({ openAddProject });
  seedStore();
  renderNav();

  const trigger = page.getByTestId("orchestrator-sidebar-add-project-trigger");
  await expect.element(trigger).toBeInTheDocument();

  await trigger.click();

  expect(openAddProject).toHaveBeenCalledOnce();
});

it("shares project sort settings and persisted manual order with Chat", async () => {
  seedSortableProjects();
  renderNav();

  await expect.element(page.getByText("Latest activity")).toBeInTheDocument();
  await expect.element(page.getByText("Newest project")).toBeInTheDocument();
  const latestActivity = page.getByText("Latest activity").element();
  const newestProject = page.getByText("Newest project").element();
  expect(
    latestActivity.compareDocumentPosition(newestProject) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).not.toBe(0);

  await page.getByRole("button", { name: "Sort Orchestrator projects" }).click();
  await page.getByRole("menuitemradio", { name: "Manual" }).click();

  await expect.element(page.getByLabelText("Drag Latest activity")).toBeInTheDocument();
  await expect.element(page.getByLabelText("Drag Newest project")).toBeInTheDocument();
  expect(
    newestProject.compareDocumentPosition(latestActivity) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).not.toBe(0);
  expect(getClientSettings().sidebarProjectSortOrder).toBe("manual");
});
