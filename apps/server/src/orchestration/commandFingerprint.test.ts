import {
  CommandId,
  ProjectId,
  ProviderInstanceId,
  TaskId,
  TaskTypeId,
  type OrchestrationCommand,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { fingerprintOrchestrationCommand } from "./commandFingerprint.ts";

describe("fingerprintOrchestrationCommand", () => {
  it("is deterministic across object property insertion order", () => {
    const defaultModelSelection = {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5-codex",
    };
    const first: OrchestrationCommand = {
      type: "project.create",
      commandId: CommandId.make("cmd-fingerprint-project"),
      projectId: ProjectId.make("project-fingerprint"),
      title: "Fingerprint project",
      workspaceRoot: "/tmp/project-fingerprint",
      defaultModelSelection,
      createdAt: "2026-08-30T00:00:00.000Z",
    };
    const reordered: OrchestrationCommand = {
      createdAt: first.createdAt,
      defaultModelSelection: {
        model: defaultModelSelection.model,
        instanceId: defaultModelSelection.instanceId,
      },
      workspaceRoot: first.workspaceRoot,
      title: first.title,
      projectId: first.projectId,
      commandId: first.commandId,
      type: first.type,
    };

    expect(fingerprintOrchestrationCommand(first)).toBe(
      "sha256:b89955ab11f2f2d6be71867bfa0ebd561e81c69c3d56a54e6370ecdce49dd431",
    );
    expect(fingerprintOrchestrationCommand(reordered)).toBe(fingerprintOrchestrationCommand(first));
  });

  it("binds semantic command content without treating dispatch metadata as request content", () => {
    const first: OrchestrationCommand = {
      type: "task.create",
      commandId: CommandId.make("pm:create-task:stable-request"),
      taskId: TaskId.make("task-stable-request"),
      projectId: ProjectId.make("project-fingerprint"),
      taskType: TaskTypeId.make("feature"),
      title: "Fingerprint task",
      pmMessageId: null,
      branch: "feature/fingerprint-task",
      createdAt: "2026-08-30T00:00:00.000Z",
    };
    const retried: OrchestrationCommand = {
      ...first,
      commandId: CommandId.make("a-different-receipt-key"),
      createdAt: "2026-08-30T00:05:00.000Z",
    };
    const changed: OrchestrationCommand = {
      ...retried,
      title: "Materially changed task",
    };

    expect(fingerprintOrchestrationCommand(first)).toBe(
      "sha256:ae55381067067b715c24502f52bf67f6f1a7c0bbf09ecf109d302d06b784e900",
    );
    expect(fingerprintOrchestrationCommand(retried)).toBe(fingerprintOrchestrationCommand(first));
    expect(fingerprintOrchestrationCommand(changed)).not.toBe(
      fingerprintOrchestrationCommand(first),
    );
  });
});
