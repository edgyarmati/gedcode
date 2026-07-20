import type { EditorId, EnvironmentApi } from "@t3tools/contracts";
import { EnvironmentId, ProjectId, TaskId } from "@t3tools/contracts";
import { afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import {
  __resetEnvironmentApiOverridesForTests,
  __setEnvironmentApiOverrideForTests,
} from "../../environmentApi";
import { OrchestratorLaunchPicker } from "./OrchestratorLaunchPicker";

const environmentId = EnvironmentId.make("launch-environment");
const projectId = ProjectId.make("launch-project");
const taskId = TaskId.make("launch-task");

afterEach(() => {
  __resetEnvironmentApiOverridesForTests();
  localStorage.clear();
});

function installLauncherApi(input: {
  readonly editors?: ReadonlyArray<EditorId>;
  readonly reveal?: boolean;
  readonly terminal?: boolean;
}) {
  const launch = vi.fn<EnvironmentApi["orchestrator"]["launch"]>(async (request) => ({
    launched: true,
    ...request,
  }));
  __setEnvironmentApiOverrideForTests(environmentId, {
    orchestrator: {
      getLaunchCapabilities: async () => ({
        editors: input.editors ?? ["cursor"],
        reveal: input.reveal ?? false,
        terminal: input.terminal ?? false,
      }),
      launch,
    },
  } as unknown as EnvironmentApi);
  return launch;
}

it("opens the project root in the configured editor", async () => {
  const launch = installLauncherApi({ editors: ["cursor"] });
  render(
    <OrchestratorLaunchPicker
      environmentId={environmentId}
      target={{ kind: "project-root", projectId }}
    />,
  );

  const primary = page.getByRole("button", { name: "Open in Cursor" });
  await expect.element(primary).toBeEnabled();
  await primary.click();

  await expect.poll(() => launch.mock.calls.length).toBe(1);
  expect(launch).toHaveBeenCalledWith({
    target: { kind: "project-root", projectId },
    operation: { kind: "editor", editor: "cursor" },
  });
});

it("opens exact task-worktree actions and makes an alternate editor preferred", async () => {
  const launch = installLauncherApi({ editors: ["cursor", "zed"], reveal: true, terminal: true });
  render(
    <OrchestratorLaunchPicker
      environmentId={environmentId}
      target={{ kind: "task-worktree", projectId, taskId }}
    />,
  );

  await expect.element(page.getByRole("button", { name: "Open in Cursor" })).toBeEnabled();
  await page.getByRole("button", { name: "Open workspace options" }).click();
  await expect
    .element(page.getByRole("menuitem", { name: "Reveal in file manager" }))
    .toBeVisible();
  await expect.element(page.getByRole("menuitem", { name: "Open terminal" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Zed" }).click();

  await expect.poll(() => launch.mock.calls.length).toBe(1);
  expect(launch).toHaveBeenLastCalledWith({
    target: { kind: "task-worktree", projectId, taskId },
    operation: { kind: "editor", editor: "zed" },
  });
  await expect.element(page.getByRole("button", { name: "Open in Zed" })).toBeEnabled();

  await page.getByRole("button", { name: "Open workspace options" }).click();
  await page.getByRole("menuitem", { name: "Open terminal" }).click();
  await expect.poll(() => launch.mock.calls.length).toBe(2);
  expect(launch).toHaveBeenLastCalledWith({
    target: { kind: "task-worktree", projectId, taskId },
    operation: { kind: "terminal" },
  });
});

it("disables unavailable environments and tasks without worktrees", async () => {
  const launch = installLauncherApi({ editors: [], reveal: false, terminal: false });
  const view = await render(
    <OrchestratorLaunchPicker
      environmentId={environmentId}
      target={{ kind: "project-root", projectId }}
    />,
  );

  await expect.element(page.getByTestId("orchestrator-launch-primary")).toBeDisabled();
  await expect.element(page.getByTestId("orchestrator-launch-menu")).toBeDisabled();

  await view.rerender(
    <OrchestratorLaunchPicker
      disabled
      disabledReason="This task does not have an available worktree."
      environmentId={environmentId}
      target={{ kind: "task-worktree", projectId, taskId }}
    />,
  );
  await expect
    .element(page.getByTestId("orchestrator-launch-primary"))
    .toHaveAttribute("title", "This task does not have an available worktree.");
  expect(launch).not.toHaveBeenCalled();
});
