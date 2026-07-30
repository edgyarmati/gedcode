import { describe, expect, it } from "vitest";

import { selectInboxEntries } from "./inboxSelectors";

describe("Inbox selectors", () => {
  it("emits flat Normal shelves and project-workspace Orchestrator entries", () => {
    const inbox = selectInboxEntries({
      environmentId: "environment-1",
      selectedThreadId: "normal-settled",
      threads: [
        { id: "normal-active", projectId: "project-a", title: "Active", inboxLifecycle: "active" },
        {
          id: "normal-snoozed",
          projectId: "project-b",
          title: "Snoozed",
          inboxLifecycle: "snoozed",
        },
        {
          id: "normal-settled",
          projectId: "project-a",
          title: "Settled but selected",
          inboxLifecycle: "settled",
        },
        {
          id: "stage-thread",
          projectId: "project-a",
          title: "Worker thread",
          inboxLifecycle: "active",
          orchestrationOwnership: { kind: "stage", taskId: "task-working" },
        },
      ],
      tasks: [
        { id: "task-working", projectId: "project-a", title: "Working", status: "working" },
        { id: "task-blocked", projectId: "project-b", title: "Needs input", status: "blocked" },
        { id: "task-landed", projectId: "project-a", title: "Landed", status: "landed" },
        { id: "task-abandoned", projectId: "project-b", title: "Abandoned", status: "abandoned" },
      ],
    });

    expect(inbox.normal.shelves).toEqual({
      active: [
        {
          id: "normal-active",
          title: "Active",
          route: {
            to: "/chat/$environmentId/$threadId",
            params: { environmentId: "environment-1", threadId: "normal-active" },
          },
        },
      ],
      snoozed: [
        {
          id: "normal-snoozed",
          title: "Snoozed",
          route: {
            to: "/chat/$environmentId/$threadId",
            params: { environmentId: "environment-1", threadId: "normal-snoozed" },
          },
        },
      ],
      settled: [
        {
          id: "normal-settled",
          title: "Settled but selected",
          route: {
            to: "/chat/$environmentId/$threadId",
            params: { environmentId: "environment-1", threadId: "normal-settled" },
          },
        },
      ],
    });
    expect(inbox.normal.selected).toMatchObject({ id: "normal-settled", shelf: "settled" });
    expect(inbox.orchestrator).toEqual([
      {
        id: "task-working",
        projectId: "project-a",
        status: "working",
        route: {
          to: "/orch/$environmentId/$projectId",
          params: { environmentId: "environment-1", projectId: "project-a" },
        },
      },
      {
        id: "task-blocked",
        projectId: "project-b",
        status: "blocked",
        route: {
          to: "/orch/$environmentId/$projectId",
          params: { environmentId: "environment-1", projectId: "project-b" },
        },
      },
    ]);
    expect(inbox).not.toHaveProperty("groups");
    expect(inbox.normal).not.toHaveProperty("groups");
    expect(JSON.stringify(inbox)).not.toContain("/tasks/");
  });
});
