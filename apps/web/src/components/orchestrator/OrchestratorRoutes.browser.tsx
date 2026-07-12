import type { EnvironmentApi } from "@t3tools/contracts";
import {
  EnvironmentId,
  EventId,
  GateId,
  ProjectId,
  TaskId,
  TaskTypeId,
  ThreadId,
} from "@t3tools/contracts";
import { afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";

import { useCommandPaletteStore } from "../../commandPaletteStore";
import {
  __resetEnvironmentApiOverridesForTests,
  __setEnvironmentApiOverrideForTests,
} from "../../environmentApi";
import { __resetLocalApiForTests } from "../../localApi";
import { initialEnvironmentState, useStore } from "../../store";
import { SidebarProvider } from "../ui/sidebar";
import { OrchestratorHomeRoute, TaskHeader } from "./OrchestratorRoutes";
import { TaskBoard } from "./TaskBoard";

const environmentId = EnvironmentId.make("environment-browser");
const taskId = TaskId.make("task-browser");
const realOpenAddProject = useCommandPaletteStore.getState().openAddProject;

const makeTask = (status: "planning" | "review" | "landed" | "abandoned" = "planning") =>
  ({
    id: taskId,
    environmentId,
    projectId: ProjectId.make("project-browser"),
    type: TaskTypeId.make("feature"),
    title: "Browser task",
    status,
    branch: null,
    worktreePath: null,
    prUrl: null,
    pmMessageId: null,
    stageThreadIds: [],
    currentStageThreadId: null,
    cancellation: null,
    landing: null,
    roleModelSelections: {},
    playbookVersion: null,
    createdAt: "2026-06-14T00:00:00.000Z",
    updatedAt: "2026-06-14T00:00:00.000Z",
    archivedAt: null,
    deletedAt: null,
  }) as const;

const approvedLandGate = {
  environmentId,
  gateId: GateId.make("gate-land-browser"),
  taskId,
  gate: "land" as const,
  contentHash: "sha256:browser-land",
  stageThreadId: null,
  status: "resolved" as const,
  approvedHash: "sha256:browser-land",
  decision: "approved" as const,
  origin: "human" as const,
  requestedAt: "2026-06-14T00:01:00.000Z",
  resolvedAt: "2026-06-14T00:02:00.000Z",
};

function renderTaskBoard(tasks: Parameters<typeof TaskBoard>[0]["tasks"]) {
  const rootRoute = createRootRoute({
    component: () => (
      <TaskBoard
        environmentId={environmentId}
        projectId={ProjectId.make("project-browser")}
        tasks={tasks}
      />
    ),
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  return render(<RouterProvider router={router} />);
}

afterEach(async () => {
  __resetEnvironmentApiOverridesForTests();
  await __resetLocalApiForTests();
  vi.unstubAllGlobals();
  useCommandPaletteStore.setState({
    open: false,
    openIntent: null,
    openAddProject: realOpenAddProject,
  });
  useStore.setState({
    activeEnvironmentId: null,
    environmentStateById: {
      [environmentId]: initialEnvironmentState,
    },
  });
});

it("opens the add-project flow from the orchestrator landing header", async () => {
  const openAddProject = vi.fn();
  useCommandPaletteStore.setState({ openAddProject });

  render(
    <SidebarProvider>
      <OrchestratorHomeRoute />
    </SidebarProvider>,
  );

  const trigger = page.getByRole("button", { name: "New project" });
  await expect.element(trigger).toBeInTheDocument();

  await trigger.click();

  expect(openAddProject).toHaveBeenCalledOnce();
});

it("cancels a non-terminal task from the task header", async () => {
  const cancelTask = vi.fn(async () => ({ sequence: 1 }));
  const confirm = vi.fn(() => true);
  __resetEnvironmentApiOverridesForTests();
  await __resetLocalApiForTests();
  vi.stubGlobal("confirm", confirm);
  __setEnvironmentApiOverrideForTests(environmentId, {
    orchestrator: { cancelTask },
  } as unknown as EnvironmentApi);

  render(<TaskHeader task={makeTask()} />);

  await page.getByRole("button", { name: "Cancel task" }).click();

  await expect.poll(() => cancelTask.mock.calls.length).toBe(1);
  expect(confirm).toHaveBeenCalledOnce();
  expect(cancelTask).toHaveBeenCalledWith({ taskId });
});

it("does not render Cancel task for terminal tasks", async () => {
  render(<TaskHeader task={makeTask("abandoned")} />);

  await expect.element(page.getByRole("button", { name: "Cancel task" })).not.toBeInTheDocument();
});

it("interrupts the active worker stage without waiting for the PM", async () => {
  const interruptStage = vi.fn(async () => ({
    taskId,
    stageThreadId: ThreadId.make("stage-browser"),
    sequence: 2,
    status: "requested" as const,
  }));
  __setEnvironmentApiOverrideForTests(environmentId, {
    orchestrator: { interruptStage },
  } as unknown as EnvironmentApi);
  const task = {
    ...makeTask("planning"),
    stageThreadIds: [ThreadId.make("stage-browser")],
    currentStageThreadId: ThreadId.make("stage-browser"),
  };

  render(<TaskHeader task={task} />);
  await page.getByRole("button", { name: "Interrupt active stage" }).click();

  await expect.poll(() => interruptStage.mock.calls.length).toBe(1);
  expect(interruptStage).toHaveBeenCalledWith({ taskId });
  await expect.element(page.getByRole("button", { name: "Interrupt active stage" })).toBeDisabled();
  await expect.element(page.getByText("Stopping…")).toBeInTheDocument();
});

it("archives a terminal task from its native-style context menu", async () => {
  const archiveTask = vi.fn(async () => ({ sequence: 2 }));
  const listArchivedTasks = vi.fn(async () => []);
  __setEnvironmentApiOverrideForTests(environmentId, {
    orchestrator: { archiveTask, listArchivedTasks },
  } as unknown as EnvironmentApi);

  renderTaskBoard([makeTask("abandoned")]);

  await page.getByRole("button", { name: /Abandoned/ }).click();
  await page.getByText("Browser task").click({ button: "right" });
  (page.getByRole("button", { name: "Archive task" }).element() as HTMLButtonElement).click();

  await expect.poll(() => archiveTask.mock.calls.length).toBe(1);
  expect(archiveTask).toHaveBeenCalledWith({ taskId });
});

it("restores an archived task from the archived board section", async () => {
  const restoreTask = vi.fn(async () => ({ sequence: 3 }));
  const archivedTask = {
    ...makeTask("abandoned"),
    archivedAt: "2026-06-14T00:05:00.000Z",
  };
  const listArchivedTasks = vi.fn(async () => [archivedTask]);
  __setEnvironmentApiOverrideForTests(environmentId, {
    orchestrator: { listArchivedTasks, restoreTask },
  } as unknown as EnvironmentApi);

  renderTaskBoard([]);

  await expect.element(page.getByRole("button", { name: /Archived/ })).toBeInTheDocument();
  await expect.element(page.getByText("No tasks yet.")).not.toBeInTheDocument();
  await page.getByRole("button", { name: /Archived/ }).click();
  await page.getByText("Browser task").click({ button: "right" });
  (page.getByRole("button", { name: "Restore task" }).element() as HTMLButtonElement).click();

  await expect.poll(() => restoreTask.mock.calls.length).toBe(1);
  expect(restoreTask).toHaveBeenCalledWith({ taskId });
});

it("lands a review task with the current approved gate", async () => {
  const landTask = vi.fn(async () => ({ sequence: 2, alreadyLanded: false }));
  __setEnvironmentApiOverrideForTests(environmentId, {
    orchestrator: { landTask },
  } as unknown as EnvironmentApi);

  render(<TaskHeader gates={[approvedLandGate]} task={makeTask("review")} />);

  await page.getByRole("button", { name: "Land task" }).click();

  await expect.poll(() => landTask.mock.calls.length).toBe(1);
  expect(landTask).toHaveBeenCalledWith({ taskId });
  await expect.element(page.getByRole("button", { name: "Landing task" })).toBeDisabled();
  await expect.element(page.getByRole("button", { name: "Land task" })).not.toBeInTheDocument();
});

it("keeps a failed landing request retryable", async () => {
  const landTask = vi
    .fn<EnvironmentApi["orchestrator"]["landTask"]>()
    .mockRejectedValueOnce(new Error("connection reset"))
    .mockResolvedValueOnce({ sequence: 3, alreadyLanded: false });
  __setEnvironmentApiOverrideForTests(environmentId, {
    orchestrator: { landTask },
  } as unknown as EnvironmentApi);

  render(<TaskHeader gates={[approvedLandGate]} task={makeTask("review")} />);
  await page.getByRole("button", { name: "Land task" }).click();

  await expect
    .element(page.getByText("Landing request failed", { exact: true }).first())
    .toBeInTheDocument();
  await page.getByRole("button", { name: "Retry landing" }).click();

  await expect.poll(() => landTask.mock.calls.length).toBe(2);
  await expect.element(page.getByRole("button", { name: "Landing task" })).toBeDisabled();
});

it("retries a durable exhausted landing failure", async () => {
  const landTask = vi.fn(async () => ({ sequence: 4, alreadyLanded: false }));
  __setEnvironmentApiOverrideForTests(environmentId, {
    orchestrator: { landTask },
  } as unknown as EnvironmentApi);
  const task = {
    ...makeTask("landed"),
    worktreePath: "/repo/.gedcode/orchestrator/tasks/task-browser",
    landing: {
      status: "failed" as const,
      failureMessage: "provider unavailable",
      branchPushed: false,
      updatedAt: "2026-06-14T00:03:00.000Z",
    },
  };

  render(<TaskHeader task={task} />);
  await page.getByRole("button", { name: "Retry landing" }).click();

  await expect.poll(() => landTask.mock.calls.length).toBe(1);
  expect(landTask).toHaveBeenCalledWith({ taskId });
  await expect.element(page.getByRole("button", { name: "Landing task" })).toBeDisabled();
});

it("shows PR opening and durable landing failure without claiming the task is landed", async () => {
  const view = await render(<TaskHeader task={makeTask("landed")} />);

  await expect.element(page.getByText("Opening pull request…")).toBeInTheDocument();
  await expect.element(page.getByText("Landed", { exact: true })).not.toBeInTheDocument();

  await view.rerender(
    <TaskHeader
      activities={[
        {
          id: EventId.make("task-pr-open-failed:task-browser"),
          tone: "error",
          kind: "task.landing.pr-open-failed",
          summary: "Landing: PR open failed - network down; branch pushed: yes",
          payload: { taskId: String(taskId) },
          turnId: null,
          createdAt: "2026-06-14T00:03:00.000Z",
        },
      ]}
      task={makeTask("landed")}
    />,
  );

  await expect
    .element(page.getByText("Landing failed", { exact: true }).first())
    .toBeInTheDocument();
  await expect.element(page.getByText("Opening pull request…")).not.toBeInTheDocument();
  await expect.element(page.getByText("Landed", { exact: true })).not.toBeInTheDocument();
});
