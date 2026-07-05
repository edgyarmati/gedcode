import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  ApprovalRequestId,
  EnvironmentId,
  EventId,
  ProjectId,
  ProviderInstanceId,
  TaskId,
  ThreadId,
} from "@t3tools/contracts";

import type { Project, Thread } from "../../types";
import { confirmAndCancelTask, confirmAndClearPmChat } from "./OrchestratorRoutes.logic";
import { buildPmUserInputRespondCommand, PmChatComposer } from "./PmChatComposer";
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

  it("confirms before dispatching Cancel task", async () => {
    const taskId = TaskId.make("task-1");
    const confirm = vi.fn(async () => true);
    const cancelTask = vi.fn(async () => ({ sequence: 1 }));

    await expect(confirmAndCancelTask({ taskId, confirm, cancelTask })).resolves.toBe(true);

    expect(confirm).toHaveBeenCalledOnce();
    expect(cancelTask).toHaveBeenCalledWith({ taskId });
  });

  it("does not dispatch Cancel task when confirmation is cancelled", async () => {
    const taskId = TaskId.make("task-1");
    const confirm = vi.fn(async () => false);
    const cancelTask = vi.fn(async () => ({ sequence: 1 }));

    await expect(confirmAndCancelTask({ taskId, confirm, cancelTask })).resolves.toBe(false);

    expect(confirm).toHaveBeenCalledOnce();
    expect(cancelTask).not.toHaveBeenCalled();
  });
});

describe("PmChatComposer", () => {
  const environmentId = EnvironmentId.make("environment-local");
  const projectId = ProjectId.make("project-1");
  const pmThreadId = ThreadId.make("pm:project-1");
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

  const pmThread = {
    id: pmThreadId,
    environmentId,
    codexThreadId: null,
    projectId,
    title: "Project PM",
    modelSelection: {
      instanceId: ProviderInstanceId.make("claudeAgent"),
      model: "claude-sonnet-4-6",
    },
    runtimeMode: "full-access",
    interactionMode: "default",
    session: null,
    messages: [],
    proposedPlans: [],
    error: null,
    createdAt: "2026-06-14T10:00:00.000Z",
    archivedAt: null,
    latestTurn: null,
    branch: null,
    worktreePath: "/tmp/project",
    turnDiffSummaries: [],
    activities: [],
  } satisfies Thread;

  it("renders a focused PM input without inert chat controls", () => {
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

  it("shows pending PM user-input questions in the PM composer", () => {
    const markup = renderToStaticMarkup(
      <PmChatComposer
        environmentId={environmentId}
        project={project}
        projectId={projectId}
        thread={{
          ...pmThread,
          activities: [
            {
              id: EventId.make("activity-user-input-requested"),
              kind: "user-input.requested",
              tone: "info",
              summary: "User input requested",
              payload: {
                requestId: "req-user-input-1",
                questions: [
                  {
                    id: "scope",
                    header: "Scope",
                    question: "Which scope should the PM use?",
                    options: [
                      {
                        label: "Small",
                        description: "Keep the plan narrow.",
                      },
                    ],
                    multiSelect: false,
                  },
                ],
              },
              turnId: null,
              createdAt: "2026-06-14T10:01:00.000Z",
            },
          ],
        }}
      />,
    );

    expect(markup).toContain("Which scope should the PM use?");
    expect(markup).toContain("Small");
    expect(markup).toContain("Type your own answer");
    expect(markup).toContain("Message PM");
  });

  it("builds PM user-input answer commands for the PM thread", () => {
    const command = buildPmUserInputRespondCommand({
      threadId: pmThreadId,
      requestId: ApprovalRequestId.make("req-user-input-1"),
      answers: {
        scope: "Small",
      },
      createdAt: "2026-06-14T10:02:00.000Z",
    });

    expect(command).toMatchObject({
      type: "thread.user-input.respond",
      threadId: pmThreadId,
      requestId: "req-user-input-1",
      answers: {
        scope: "Small",
      },
      createdAt: "2026-06-14T10:02:00.000Z",
    });
    expect(command.commandId).toBeTruthy();
  });
});
