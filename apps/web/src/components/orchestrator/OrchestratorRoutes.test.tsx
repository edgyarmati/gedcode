import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { EnvironmentId, ProjectId, ProviderInstanceId } from "@t3tools/contracts";

import type { Project } from "../../types";
import { confirmAndClearPmChat } from "./OrchestratorRoutes.logic";
import { PmChatComposer } from "./PmChatComposer";
import { TaskPrLink } from "./TaskPrLink";

describe("TaskPrLink", () => {
  it("renders a clickable PR link when a task has a PR URL", () => {
    const markup = renderToStaticMarkup(
      <TaskPrLink prUrl="https://github.com/acme/project/pull/42" />,
    );

    expect(markup).toContain("View PR");
    expect(markup).toContain('href="https://github.com/acme/project/pull/42"');
    expect(markup).toContain('target="_blank"');
  });

  it("confirms before dispatching Clear PM chat", async () => {
    const projectId = ProjectId.make("project-1");
    const confirm = vi.fn(async () => true);
    const clearPmChat = vi.fn(async () => ({ sequence: 1 }));

    await expect(
      confirmAndClearPmChat({
        projectId,
        confirm,
        clearPmChat,
      }),
    ).resolves.toBe(true);

    expect(confirm).toHaveBeenCalledOnce();
    expect(clearPmChat).toHaveBeenCalledWith({ projectId });
  });

  it("does not dispatch Clear PM chat when confirmation is cancelled", async () => {
    const projectId = ProjectId.make("project-1");
    const confirm = vi.fn(async () => false);
    const clearPmChat = vi.fn(async () => ({ sequence: 1 }));

    await expect(
      confirmAndClearPmChat({
        projectId,
        confirm,
        clearPmChat,
      }),
    ).resolves.toBe(false);

    expect(confirm).toHaveBeenCalledOnce();
    expect(clearPmChat).not.toHaveBeenCalled();
  });
});

describe("PmChatComposer", () => {
  it("renders a focused PM input without inert chat controls", () => {
    const environmentId = EnvironmentId.make("environment-local");
    const projectId = ProjectId.make("project-1");
    const project = {
      id: projectId,
      environmentId,
      name: "Project",
      cwd: "/tmp/project",
      repositoryIdentity: null,
      defaultModelSelection: null,
      orchestratorConfig: {
        enabled: true,
        pmModelSelection: {
          instanceId: ProviderInstanceId.make("claudeAgent"),
          model: "claude-sonnet-4-6",
        },
      },
      scripts: [],
    } satisfies Project;

    const markup = renderToStaticMarkup(
      <PmChatComposer
        environmentId={environmentId}
        project={project}
        projectId={projectId}
        thread={undefined}
      />,
    );

    expect(markup).toContain("Message PM");
    expect(markup).toContain("Send PM message");
    expect(markup).toContain("PM model:");
    expect(markup).toContain("claudeAgent · claude-sonnet-4-6");
    expect(markup).not.toContain('role="combobox"');
    expect(markup).not.toContain('data-slot="select-trigger"');
    expect(markup).not.toContain("Ged workflow");
    expect(markup).not.toContain("Runtime mode");
    expect(markup).not.toContain("Workflow");
  });
});
