import "../../index.css";

import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  TaskId,
  TaskTypeId,
  type EnvironmentApi,
  type ServerConfig,
  type ServerProvider,
} from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import {
  __resetEnvironmentApiOverridesForTests,
  __setEnvironmentApiOverrideForTests,
} from "../../environmentApi";
import { AppAtomRegistryProvider, resetAppAtomRegistryForTests } from "../../rpc/atomRegistry";
import { resetServerStateForTests, setServerConfigSnapshot } from "../../rpc/serverState";
import type { OrchestratorTask, Project } from "../../types";
import { TaskRoleBackendSettings } from "./TaskRoleBackendSettings";

const environmentId = EnvironmentId.make("environment-worker-picker");
const projectId = ProjectId.make("project-worker-picker");
const taskId = TaskId.make("task-worker-picker");
const claudeInstanceId = ProviderInstanceId.make("claude_worker");

const providers: ReadonlyArray<ServerProvider> = [
  {
    instanceId: ProviderInstanceId.make("codex"),
    driver: ProviderDriverKind.make("codex"),
    displayName: "Codex",
    enabled: true,
    installed: true,
    version: "1",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-07-16T00:00:00.000Z",
    models: [
      {
        slug: "gpt-5",
        name: "GPT-5",
        isCustom: false,
        capabilities: createModelCapabilities({ optionDescriptors: [] }),
      },
    ],
    slashCommands: [],
    skills: [],
  },
  {
    instanceId: claudeInstanceId,
    driver: ProviderDriverKind.make("claudeAgent"),
    displayName: "Claude Worker",
    enabled: true,
    installed: true,
    version: "1",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-07-16T00:00:00.000Z",
    models: [
      {
        slug: "claude-sonnet",
        name: "Claude Sonnet",
        isCustom: false,
        capabilities: createModelCapabilities({
          optionDescriptors: [
            {
              id: "effort",
              label: "Reasoning",
              type: "select",
              options: [
                { id: "medium", label: "Medium" },
                { id: "high", label: "High", isDefault: true },
              ],
              currentValue: "high",
            },
          ],
        }),
      },
    ],
    slashCommands: [],
    skills: [],
  },
];

const project = {
  id: projectId,
  environmentId,
  name: "Project",
  cwd: "/tmp/project",
  defaultModelSelection: {
    instanceId: ProviderInstanceId.make("codex"),
    model: "gpt-5",
  },
  roleModelSelections: {},
  scripts: [],
} satisfies Project;

const task = {
  id: taskId,
  environmentId,
  projectId,
  type: TaskTypeId.make("feature"),
  title: "Task",
  roleCapabilityTiers: {},
} as OrchestratorTask;

afterEach(() => {
  __resetEnvironmentApiOverridesForTests();
  resetServerStateForTests();
  resetAppAtomRegistryForTests();
});

it("sets a semantic task capability tier without selecting a raw backend", async () => {
  const setTaskCapabilityTiers = vi.fn(async () => ({ sequence: 1 }));
  __setEnvironmentApiOverrideForTests(environmentId, {
    orchestrator: { setTaskCapabilityTiers },
  } as unknown as EnvironmentApi);
  setServerConfigSnapshot({
    providers,
    settings: DEFAULT_SERVER_SETTINGS,
  } as ServerConfig);

  await render(
    <AppAtomRegistryProvider>
      <TaskRoleBackendSettings environmentId={environmentId} project={project} task={task} />
    </AppAtomRegistryProvider>,
  );

  await expect.element(page.getByText("Capability tiers")).toBeInTheDocument();
  await userEvent.selectOptions(page.getByLabelText("Work capability tier"), "cheap");

  await vi.waitFor(() => {
    expect(setTaskCapabilityTiers).toHaveBeenCalledWith({
      taskId,
      roleCapabilityTiers: { work: "cheap" },
    });
  });
});
