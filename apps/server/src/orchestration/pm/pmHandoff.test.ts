import { MessageId, ProjectId, ProviderInstanceId, ThreadId, EventId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";
import type { OrchestrationThread } from "@t3tools/contracts";

import { buildPmHandoffTranscript } from "./pmHandoff.ts";

const makeThread = (overrides: Partial<OrchestrationThread> = {}): OrchestrationThread => ({
  id: ThreadId.make("pm:project-handoff"),
  projectId: ProjectId.make("project-handoff"),
  title: "Project PM",
  modelSelection: {
    instanceId: ProviderInstanceId.make("claude"),
    model: "claude-opus-4-6",
  },
  runtimeMode: "approval-required",
  interactionMode: "default",
  branch: null,
  worktreePath: "/tmp/project-handoff",
  latestTurn: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  archivedAt: null,
  deletedAt: null,
  pendingPmHandoff: null,
  messages: [],
  proposedPlans: [],
  activities: [],
  checkpoints: [],
  session: null,
  ...overrides,
});

describe("buildPmHandoffTranscript", () => {
  it("renders an empty thread gracefully", () => {
    const transcript = buildPmHandoffTranscript(makeThread(), 1_000);

    expect(transcript).toContain("--- BEGIN PM HANDOFF CONTEXT ---");
    expect(transcript).toContain("[no prior PM messages or activities]");
    expect(transcript).toContain("--- END PM HANDOFF CONTEXT ---");
  });

  it("interleaves role-labelled messages and one-line activities by createdAt", () => {
    const transcript = buildPmHandoffTranscript(
      makeThread({
        messages: [
          {
            id: MessageId.make("msg-user"),
            role: "user",
            text: "What is the state?",
            turnId: null,
            streaming: false,
            createdAt: "2026-01-01T00:00:01.000Z",
            updatedAt: "2026-01-01T00:00:01.000Z",
          },
          {
            id: MessageId.make("msg-assistant"),
            role: "assistant",
            text: "The plan is active.",
            turnId: null,
            streaming: false,
            createdAt: "2026-01-01T00:00:03.000Z",
            updatedAt: "2026-01-01T00:00:03.000Z",
          },
        ],
        activities: [
          {
            id: EventId.make("evt-activity"),
            tone: "tool",
            kind: "pm.tool",
            summary: "Inspected   active tasks\nand gates.",
            payload: {},
            turnId: null,
            createdAt: "2026-01-01T00:00:02.000Z",
          },
        ],
      }),
      2_000,
    );

    expect(transcript.indexOf("user: What is the state?")).toBeLessThan(
      transcript.indexOf("activity:pm.tool"),
    );
    expect(transcript.indexOf("activity:pm.tool")).toBeLessThan(
      transcript.indexOf("assistant: The plan is active."),
    );
    expect(transcript).toContain("Inspected active tasks and gates.");
  });

  it("drops oldest entries first and marks earlier history as truncated", () => {
    const transcript = buildPmHandoffTranscript(
      makeThread({
        messages: [
          {
            id: MessageId.make("msg-old"),
            role: "user",
            text: "old ".repeat(80),
            turnId: null,
            streaming: false,
            createdAt: "2026-01-01T00:00:01.000Z",
            updatedAt: "2026-01-01T00:00:01.000Z",
          },
          {
            id: MessageId.make("msg-new"),
            role: "assistant",
            text: "new state",
            turnId: null,
            streaming: false,
            createdAt: "2026-01-01T00:00:02.000Z",
            updatedAt: "2026-01-01T00:00:02.000Z",
          },
        ],
      }),
      240,
    );

    expect(transcript).toContain("[earlier history truncated]");
    expect(transcript).not.toContain("old old old");
    expect(transcript).toContain("assistant: new state");
    expect(transcript.length).toBeLessThanOrEqual(240);
  });
});
