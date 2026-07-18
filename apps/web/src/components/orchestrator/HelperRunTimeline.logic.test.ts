import {
  HelperRunId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationHelperRun,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { buildHelperRunTimelineRows } from "./HelperRunTimeline";

const makeRun = (overrides: Partial<OrchestrationHelperRun> = {}): OrchestrationHelperRun => ({
  id: HelperRunId.make("helper-ui"),
  projectId: ProjectId.make("project-ui"),
  attachment: { kind: "pm", threadId: ThreadId.make("pm:project-ui") },
  accessMode: "read-only",
  tier: "cheap",
  providerInstanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5.6-sol",
  modelOptions: null,
  prompt: "Find the relevant implementation paths.",
  status: "completed",
  providerThreadId: ThreadId.make("helper:helper-ui"),
  result: "The implementation is in src/example.ts.",
  failureMessage: null,
  createdAt: "2026-07-18T12:00:00.000Z",
  startedAt: "2026-07-18T12:00:01.000Z",
  completedAt: "2026-07-18T12:00:02.000Z",
  updatedAt: "2026-07-18T12:00:02.000Z",
  ...overrides,
});

describe("buildHelperRunTimelineRows", () => {
  it("shows the stamped tier/backend and bounded terminal result", () => {
    expect(buildHelperRunTimelineRows([makeRun()])).toEqual([
      {
        id: "helper-ui",
        prompt: "Find the relevant implementation paths.",
        tierLabel: "Cheap",
        backendLabel: "codex · gpt-5.6-sol",
        statusLabel: "Completed",
        statusVariant: "success",
        result: "The implementation is in src/example.ts.",
        failureMessage: null,
      },
    ]);
  });

  it("uses a destructive status for failed and interrupted helpers", () => {
    expect(
      buildHelperRunTimelineRows([
        makeRun({ status: "failed", result: null, failureMessage: "Provider failed." }),
        makeRun({ id: HelperRunId.make("helper-interrupted"), status: "interrupted" }),
      ]).map((row) => [row.statusLabel, row.statusVariant]),
    ).toEqual([
      ["Failed", "destructive"],
      ["Interrupted", "destructive"],
    ]);
  });
});
