import type { EnvironmentApi } from "@t3tools/contracts";
import { EnvironmentId, ProjectId, TaskId, TaskTypeId } from "@t3tools/contracts";
import { expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import {
  __resetEnvironmentApiOverridesForTests,
  __setEnvironmentApiOverrideForTests,
} from "../../environmentApi";
import { __resetLocalApiForTests } from "../../localApi";
import { TaskHeader } from "./OrchestratorRoutes";

const environmentId = EnvironmentId.make("environment-browser");
const taskId = TaskId.make("task-browser");

const makeTask = (status: "planning" | "landed" | "abandoned" = "planning") =>
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
    roleModelSelections: {},
    playbookVersion: null,
    createdAt: "2026-06-14T00:00:00.000Z",
    updatedAt: "2026-06-14T00:00:00.000Z",
  }) as const;

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

  __resetEnvironmentApiOverridesForTests();
  vi.unstubAllGlobals();
});

it("does not render Cancel task for terminal tasks", async () => {
  render(<TaskHeader task={makeTask("abandoned")} />);

  await expect.element(page.getByRole("button", { name: "Cancel task" })).not.toBeInTheDocument();
});
