import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ProjectId } from "@t3tools/contracts";

import { confirmAndClearPmChat } from "./OrchestratorRoutes.logic";
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
