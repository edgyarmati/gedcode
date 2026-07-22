import type { EnvironmentApi } from "@t3tools/contracts";
import {
  EnvironmentId,
  EventId,
  GateId,
  HelperRunId,
  ProjectId,
  ProviderInstanceId,
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
import type { Thread } from "../../types";
import { SidebarProvider } from "../ui/sidebar";
import {
  GatePanel,
  OrchestratorHomeRoute,
  ProjectContextStatusControls,
  StageProposedPlan,
  TaskHeader,
} from "./OrchestratorRoutes";
import { TaskBoard } from "./TaskBoard";
import { TaskChangeReviewPanel } from "./TaskChangeReviewPanel";
import { StageTimeline } from "./StageTimeline";
import { HelperRunTimeline } from "./HelperRunTimeline";

const environmentId = EnvironmentId.make("environment-browser");
const taskId = TaskId.make("task-browser");
const realOpenAddProject = useCommandPaletteStore.getState().openAddProject;

const makeTask = (
  status:
    | "planning"
    | "review"
    | "change-review"
    | "verifying"
    | "landed"
    | "no-changes-needed"
    | "abandoned" = "planning",
) =>
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
    changeReview: null,
    verification: null,
    noChangesNeeded: null,
    landing: null,
    roleCapabilityTiers: {},
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

it("shows compact project-context status and keeps manual review explicit", async () => {
  const onReview = vi.fn();
  const onResolve = vi.fn();
  const view = await render(
    <ProjectContextStatusControls
      active={false}
      latestRun={null}
      onReview={onReview}
      requesting={false}
    />,
  );

  await expect.element(page.getByText("Context · Ready")).toBeInTheDocument();
  await page.getByRole("button", { name: "Review project context" }).click();
  expect(onReview).toHaveBeenCalledOnce();

  await view.rerender(
    <ProjectContextStatusControls
      active
      latestRun={{ status: "pending-review" } as never}
      onReview={onReview}
      onResolve={onResolve}
      requesting={false}
    />,
  );
  await expect.element(page.getByText("Context · Needs attention")).toBeInTheDocument();
  await expect.element(page.getByRole("button", { name: "Review project context" })).toBeDisabled();
  await page.getByRole("button", { name: "Resolve" }).click();
  expect(onResolve).toHaveBeenCalledOnce();
});

it("omits empty Plan and Gates sections and renders them once populated", async () => {
  const empty = await render(
    <>
      <GatePanel environmentId={environmentId} gates={[]} taskId={taskId} />
      <StageProposedPlan
        environmentId={environmentId}
        project={undefined}
        stageThread={undefined}
      />
    </>,
  );

  await expect.element(page.getByText("No gates.")).not.toBeInTheDocument();
  await expect.element(page.getByText("No proposed plan yet.")).not.toBeInTheDocument();
  await expect.element(page.getByText("Plan", { exact: true })).not.toBeInTheDocument();

  const stageThread = {
    worktreePath: "/tmp/project",
    proposedPlans: [
      {
        id: "plan-browser",
        turnId: null,
        planMarkdown: "## Implemented plan",
        implementedAt: null,
        implementationThreadId: null,
        createdAt: "2026-06-14T00:00:00.000Z",
        updatedAt: "2026-06-14T00:00:00.000Z",
      },
    ],
  } as unknown as Thread;
  await empty.rerender(
    <>
      <GatePanel environmentId={environmentId} gates={[approvedLandGate]} taskId={taskId} />
      <StageProposedPlan
        environmentId={environmentId}
        project={undefined}
        stageThread={stageThread}
      />
    </>,
  );

  await expect.element(page.getByText("Gates", { exact: true })).toBeInTheDocument();
  await expect.element(page.getByRole("heading", { name: "Plan" })).toBeInTheDocument();
  await expect.element(page.getByText("Implemented plan")).toBeInTheDocument();
});

it("shows the effective worker permission mode in stage history", async () => {
  const stageThreadId = ThreadId.make("stage-permissions-browser");
  useStore.setState({
    environmentStateById: {
      [environmentId]: {
        ...initialEnvironmentState,
        stageHistoryByTaskId: {
          [taskId]: {
            [stageThreadId]: {
              projectId: ProjectId.make("project-browser"),
              taskId,
              stageThreadId,
              role: "work",
              capabilityTier: null,
              providerInstanceId: ProviderInstanceId.make("codex"),
              model: "gpt-5.6",
              modelOptions: null,
              runtimeMode: "full-access",
              status: "running",
              startedAt: "2026-07-14T00:00:00.000Z",
              endedAt: null,
            },
          },
        },
      },
    },
  });

  await render(<StageTimeline environmentId={environmentId} taskId={taskId} />);
  await expect.element(page.getByText("Full access", { exact: true })).toBeInTheDocument();
  await expect.element(page.getByText("codex · gpt-5.6", { exact: true })).toBeInTheDocument();
});

it("selects and highlights any persisted stage attempt", async () => {
  const firstStageThreadId = ThreadId.make("stage-work-first");
  const secondStageThreadId = ThreadId.make("stage-work-second");
  const selected = vi.fn();
  useStore.setState({
    environmentStateById: {
      [environmentId]: {
        ...initialEnvironmentState,
        stageHistoryByTaskId: {
          [taskId]: Object.fromEntries(
            [firstStageThreadId, secondStageThreadId].map((stageThreadId, index) => [
              stageThreadId,
              {
                projectId: ProjectId.make("project-browser"),
                taskId,
                stageThreadId,
                role: "work" as const,
                capabilityTier: null,
                providerInstanceId: ProviderInstanceId.make("codex"),
                model: "gpt-5.6-terra",
                modelOptions: null,
                runtimeMode: "full-access" as const,
                status: "completed" as const,
                startedAt: `2026-07-22T10:0${index}:00.000Z`,
                endedAt: `2026-07-22T10:0${index}:30.000Z`,
              },
            ]),
          ),
        },
      },
    },
  });

  await render(
    <StageTimeline
      environmentId={environmentId}
      onSelectStageThread={selected}
      selectedStageThreadId={secondStageThreadId}
      taskId={taskId}
    />,
  );

  const firstAttempt = page.getByRole("button", { name: /Work · Attempt 1/ });
  const secondAttempt = page.getByRole("button", { name: /Work · Attempt 2/ });
  await expect.element(secondAttempt).toHaveAttribute("aria-current", "true");
  await firstAttempt.click();
  expect(selected).toHaveBeenCalledWith(firstStageThreadId);
});

it("shows read-only helper history without adding a task-board card", async () => {
  const projectId = ProjectId.make("project-browser");
  const helperRunId = HelperRunId.make("helper-browser");
  const pmHelperRunId = HelperRunId.make("helper-pm-browser");
  useStore.setState({
    environmentStateById: {
      [environmentId]: {
        ...initialEnvironmentState,
        helperRunById: {
          [pmHelperRunId]: {
            id: pmHelperRunId,
            projectId,
            attachment: { kind: "pm", threadId: ThreadId.make("pm:project-browser") },
            accessMode: "read-only",
            tier: "cheap",
            providerInstanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5.6-mini",
            modelOptions: null,
            prompt: "Inspect the project architecture.",
            status: "running",
            transientRetryCount: 0,
            providerThreadId: ThreadId.make("helper:helper-pm-browser"),
            result: null,
            failureMessage: null,
            createdAt: "2026-07-18T12:00:00.000Z",
            startedAt: "2026-07-18T12:00:01.000Z",
            completedAt: null,
            updatedAt: "2026-07-18T12:00:01.000Z",
          },
          [helperRunId]: {
            id: helperRunId,
            projectId,
            attachment: { kind: "task", taskId },
            accessMode: "read-only",
            tier: "smart",
            providerInstanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5.6-sol",
            modelOptions: null,
            prompt: "Inspect the task architecture.",
            status: "completed",
            transientRetryCount: 0,
            providerThreadId: ThreadId.make("helper:helper-browser"),
            result: "Found the relevant architecture module.",
            failureMessage: null,
            createdAt: "2026-07-18T12:00:00.000Z",
            startedAt: "2026-07-18T12:00:01.000Z",
            completedAt: "2026-07-18T12:00:02.000Z",
            updatedAt: "2026-07-18T12:00:02.000Z",
          },
        },
      },
    },
  });

  await render(
    <>
      <HelperRunTimeline environmentId={environmentId} projectId={projectId} />
      <HelperRunTimeline environmentId={environmentId} taskId={taskId} />
      <TaskBoard environmentId={environmentId} projectId={projectId} tasks={[]} />
    </>,
  );
  await expect.element(page.getByText("Inspect the project architecture.")).toBeInTheDocument();
  await expect
    .element(page.getByText("Cheap · codex · gpt-5.6-mini · Read only"))
    .toBeInTheDocument();
  await expect.element(page.getByText("Inspect the task architecture.")).toBeInTheDocument();
  await expect
    .element(page.getByText("Smart · codex · gpt-5.6-sol · Read only"))
    .toBeInTheDocument();
  await expect.element(page.getByText("Browser task")).not.toBeInTheDocument();
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
  const view = await render(<TaskHeader task={makeTask("abandoned")} />);

  await expect.element(page.getByRole("button", { name: "Cancel task" })).not.toBeInTheDocument();
  await view.rerender(<TaskHeader task={makeTask("no-changes-needed")} />);
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

it("offers cancellation but not retention actions for an active task context menu", async () => {
  const cancelTask = vi.fn(async () => ({ sequence: 2, status: "requested" as const }));
  const listArchivedTasks = vi.fn(async () => []);
  __setEnvironmentApiOverrideForTests(environmentId, {
    orchestrator: { cancelTask, listArchivedTasks },
  } as unknown as EnvironmentApi);

  renderTaskBoard([makeTask("planning")]);

  await page.getByText("Browser task").click({ button: "right" });
  await expect.element(page.getByRole("button", { name: "Cancel task" })).toBeInTheDocument();
  await expect.element(page.getByRole("button", { name: "Archive task" })).not.toBeInTheDocument();
  (page.getByRole("button", { name: "Cancel task" }).element() as HTMLButtonElement).click();

  await expect.poll(() => cancelTask.mock.calls.length).toBe(1);
  expect(cancelTask).toHaveBeenCalledWith({ taskId });
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

it("shows change review as a Needs you action instead of dropping it from the board", async () => {
  const listArchivedTasks = vi.fn(async () => []);
  __setEnvironmentApiOverrideForTests(environmentId, {
    orchestrator: { listArchivedTasks },
  } as unknown as EnvironmentApi);

  renderTaskBoard([makeTask("change-review")]);

  await expect.element(page.getByText("Needs you", { exact: true })).toBeInTheDocument();
  await expect.element(page.getByText("Review changes", { exact: true })).toBeInTheDocument();
  await expect.element(page.getByText("Browser task", { exact: true })).toBeInTheDocument();
});

it("inspects and commits explicitly selected change-review paths", async () => {
  const changes = {
    head: "0123456789abcdef",
    dirty: true,
    paths: ["src/changed.ts"],
    staged: false,
    diff: "diff --git a/src/changed.ts b/src/changed.ts\n+updated",
    diffTruncated: false,
  };
  const inspectTaskChanges = vi.fn(async () => ({ taskId, changes }));
  const commitTaskChanges = vi.fn(async () => ({
    taskId,
    commit: "[task 123] fix",
    changes: { ...changes, dirty: false, paths: [], diff: "" },
    sequence: 4,
  }));
  __setEnvironmentApiOverrideForTests(environmentId, {
    orchestrator: { inspectTaskChanges, commitTaskChanges },
  } as unknown as EnvironmentApi);
  const task = {
    ...makeTask("change-review"),
    changeReview: {
      status: "pending" as const,
      workStageThreadId: ThreadId.make("work-stage-browser"),
      detectedHead: changes.head,
      resolution: null,
      requestedAt: "2026-06-14T00:01:00.000Z",
      resolvedAt: null,
    },
  };

  const view = await render(<TaskChangeReviewPanel environmentId={environmentId} task={task} />);
  await expect.element(page.getByText("src/changed.ts", { exact: true })).toBeInTheDocument();
  await expect.element(page.getByText("updated", { exact: false })).toBeInTheDocument();
  await page.getByRole("textbox", { name: "Commit message" }).fill("fix reviewed changes");
  await page.getByRole("button", { name: "Commit selected" }).click();

  await expect.poll(() => commitTaskChanges.mock.calls.length).toBe(1);
  expect(commitTaskChanges).toHaveBeenCalledWith({
    taskId,
    paths: ["src/changed.ts"],
    message: "fix reviewed changes",
  });

  await view.rerender(
    <TaskChangeReviewPanel environmentId={environmentId} task={{ ...task, status: "verifying" }} />,
  );
  await expect.element(page.getByText("Change review", { exact: true })).not.toBeInTheDocument();
});

it("returns change review with precise revision instructions", async () => {
  const changes = {
    head: "0123456789abcdef",
    dirty: true,
    paths: ["src/changed.ts"],
    staged: false,
    diff: "diff --git a/src/changed.ts b/src/changed.ts",
    diffTruncated: false,
  };
  const inspectTaskChanges = vi.fn(async () => ({ taskId, changes }));
  const returnTaskChanges = vi.fn(async () => ({
    taskId,
    stageThreadId: ThreadId.make("rework-stage-browser"),
    sequence: 5,
  }));
  __setEnvironmentApiOverrideForTests(environmentId, {
    orchestrator: { inspectTaskChanges, returnTaskChanges },
  } as unknown as EnvironmentApi);
  const task = {
    ...makeTask("change-review"),
    changeReview: {
      status: "pending" as const,
      workStageThreadId: ThreadId.make("work-stage-browser"),
      detectedHead: changes.head,
      resolution: null,
      requestedAt: "2026-06-14T00:01:00.000Z",
      resolvedAt: null,
    },
  };

  await render(<TaskChangeReviewPanel environmentId={environmentId} task={task} />);
  await page
    .getByRole("textbox", { name: "Revision instructions" })
    .fill("Keep the parser change but remove the unrelated fixture.");
  await page.getByRole("button", { name: "Revise" }).click();

  await expect.poll(() => returnTaskChanges.mock.calls.length).toBe(1);
  expect(returnTaskChanges).toHaveBeenCalledWith({
    taskId,
    instructions: "Keep the parser change but remove the unrelated fixture.",
  });
});

it("requires destructive confirmation before discarding selected changes", async () => {
  const changes = {
    head: "0123456789abcdef",
    dirty: true,
    paths: ["src/unwanted.ts"],
    staged: false,
    diff: "diff --git a/src/unwanted.ts b/src/unwanted.ts",
    diffTruncated: false,
  };
  const inspectTaskChanges = vi.fn(async () => ({ taskId, changes }));
  const discardTaskChanges = vi.fn(async () => ({
    taskId,
    changes: { ...changes, dirty: false, paths: [], diff: "" },
    sequence: 6,
  }));
  vi.stubGlobal(
    "confirm",
    vi.fn(() => true),
  );
  __setEnvironmentApiOverrideForTests(environmentId, {
    orchestrator: { inspectTaskChanges, discardTaskChanges },
  } as unknown as EnvironmentApi);
  const task = {
    ...makeTask("change-review"),
    changeReview: {
      status: "pending" as const,
      workStageThreadId: ThreadId.make("work-stage-browser"),
      detectedHead: changes.head,
      resolution: null,
      requestedAt: "2026-06-14T00:01:00.000Z",
      resolvedAt: null,
    },
  };

  await render(<TaskChangeReviewPanel environmentId={environmentId} task={task} />);
  await page.getByRole("button", { name: "Discard" }).click();

  await expect.poll(() => discardTaskChanges.mock.calls.length).toBe(1);
  expect(discardTaskChanges).toHaveBeenCalledWith({ taskId, paths: ["src/unwanted.ts"] });
});

it("records clean work as no changes needed and shows the archived outcome", async () => {
  const completeTaskWithoutChanges = vi.fn(async () => ({
    taskId,
    baseHead: "0123456789abcdef",
    head: "0123456789abcdef",
    sequence: 7,
  }));
  __setEnvironmentApiOverrideForTests(environmentId, {
    orchestrator: { completeTaskWithoutChanges },
  } as unknown as EnvironmentApi);
  await render(<TaskChangeReviewPanel environmentId={environmentId} task={makeTask("review")} />);
  await page.getByRole("button", { name: "No changes needed" }).click();
  await expect.poll(() => completeTaskWithoutChanges.mock.calls.length).toBe(1);

  __resetEnvironmentApiOverridesForTests();
  const archivedTask = {
    ...makeTask("no-changes-needed"),
    archivedAt: "2026-06-14T00:05:00.000Z",
    noChangesNeeded: {
      baseHead: "0123456789abcdef",
      head: "0123456789abcdef",
      completedAt: "2026-06-14T00:05:00.000Z",
    },
  };
  __setEnvironmentApiOverrideForTests(environmentId, {
    orchestrator: { listArchivedTasks: vi.fn(async () => [archivedTask]) },
  } as unknown as EnvironmentApi);
  renderTaskBoard([]);
  await page.getByRole("button", { name: /Archived/ }).click();
  await expect
    .element(page.getByText("No changes needed", { exact: true }).last())
    .toBeInTheDocument();
});

it("expands a split parent to show children in their declared order", async () => {
  const parentId = TaskId.make("task-split-parent");
  const firstChildId = TaskId.make("task-split-first");
  const secondChildId = TaskId.make("task-split-second");
  const parent = {
    ...makeTask("planning"),
    id: parentId,
    title: "Split parent",
    aggregateProgress: { total: 2, terminal: 1, landed: 1, abandoned: 0 },
  };
  const firstChild = {
    ...makeTask("landed"),
    id: firstChildId,
    title: "First child",
    parentTaskId: parentId,
    childOrder: 0,
  };
  const secondChild = {
    ...makeTask("planning"),
    id: secondChildId,
    title: "Second child",
    parentTaskId: parentId,
    childOrder: 1,
  };

  renderTaskBoard([secondChild, parent, firstChild]);

  await expect.element(page.getByText("Split parent")).toBeInTheDocument();
  await expect.element(page.getByText("First child")).not.toBeInTheDocument();
  await expect.element(page.getByText("Second child")).not.toBeInTheDocument();

  const expand = page.getByRole("button", { name: "Expand Split parent children" });
  await expect.element(expand).toHaveAttribute("aria-expanded", "false");
  await expand.click();

  await expect
    .element(page.getByRole("button", { name: "Collapse Split parent children" }))
    .toHaveAttribute("aria-expanded", "true");
  const first = page.getByText("First child").element();
  const second = page.getByText("Second child").element();
  expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
});

it("uses land-gate approval as the only normal landing action", async () => {
  const resolveGate = vi.fn(async () => ({ sequence: 2 }));
  __setEnvironmentApiOverrideForTests(environmentId, {
    orchestrator: { resolveGate },
  } as unknown as EnvironmentApi);

  render(<TaskHeader gates={[approvedLandGate]} task={makeTask("review")} />);

  await expect.element(page.getByRole("button", { name: "Land task" })).not.toBeInTheDocument();
  const pendingLandGate = {
    ...approvedLandGate,
    status: "pending" as const,
    approvedHash: null,
    decision: null,
    origin: null,
    resolvedAt: null,
  };
  await render(
    <GatePanel environmentId={environmentId} gates={[pendingLandGate]} taskId={taskId} />,
  );
  await page.getByRole("button", { name: "Approve" }).click();
  await expect.poll(() => resolveGate.mock.calls.length).toBe(1);
  expect(resolveGate).toHaveBeenCalledWith({
    taskId,
    gateId: approvedLandGate.gateId,
    gate: "land",
    approvedHash: approvedLandGate.contentHash,
    decision: "approved",
  });
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
