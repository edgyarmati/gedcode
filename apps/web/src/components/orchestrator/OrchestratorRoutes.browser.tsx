import type { EnvironmentApi } from "@t3tools/contracts";
import { EnvironmentId, EventId, GateId, ProjectId, TaskId, TaskTypeId } from "@t3tools/contracts";
import { afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { useCommandPaletteStore } from "../../commandPaletteStore";
import {
  __resetEnvironmentApiOverridesForTests,
  __setEnvironmentApiOverrideForTests,
} from "../../environmentApi";
import { __resetLocalApiForTests } from "../../localApi";
import { initialEnvironmentState, useStore } from "../../store";
import { SidebarProvider } from "../ui/sidebar";
import { OrchestratorHomeRoute, TaskHeader } from "./OrchestratorRoutes";

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
