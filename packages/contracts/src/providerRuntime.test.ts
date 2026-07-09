import { describe, expect, it } from "vitest";
import * as Schema from "effect/Schema";

import { ProviderRuntimeEvent } from "./providerRuntime.ts";

const decodeRuntimeEvent = Schema.decodeUnknownSync(ProviderRuntimeEvent);

describe("ProviderRuntimeEvent", () => {
  it("accepts fork-provided driver kinds as branded slugs", () => {
    const parsed = decodeRuntimeEvent({
      type: "session.started",
      eventId: "event-ollama-session",
      provider: "ollama",
      providerInstanceId: "ollama_local",
      createdAt: "2026-02-28T00:00:00.000Z",
      threadId: "thread-1",
      payload: {
        message: "started",
      },
    });

    expect(parsed.provider).toBe("ollama");
    expect(parsed.providerInstanceId).toBe("ollama_local");
  });

  it("decodes turn.plan.updated for plan rendering", () => {
    const parsed = decodeRuntimeEvent({
      type: "turn.plan.updated",
      eventId: "event-1",
      provider: "claudeAgent",
      sessionId: "runtime-session-1",
      createdAt: "2026-02-28T00:00:00.000Z",
      threadId: "thread-1",
      turnId: "turn-1",
      payload: {
        explanation: "Implement schema updates",
        plan: [
          { step: "Define event union", status: "completed" },
          { step: "Wire adapter mapping", status: "inProgress" },
        ],
      },
    });

    expect(parsed.type).toBe("turn.plan.updated");
    if (parsed.type !== "turn.plan.updated") {
      throw new Error("expected turn.plan.updated");
    }
    expect(parsed.payload.plan).toHaveLength(2);
    expect(parsed.payload.plan[1]?.status).toBe("inProgress");
  });

  it("decodes proposed-plan completion events", () => {
    const parsed = decodeRuntimeEvent({
      type: "turn.proposed.completed",
      eventId: "event-proposed-plan-1",
      provider: "codex",
      createdAt: "2026-02-28T00:00:00.000Z",
      threadId: "thread-1",
      turnId: "turn-1",
      payload: {
        planMarkdown: "# Ship it",
      },
    });

    expect(parsed.type).toBe("turn.proposed.completed");
    if (parsed.type !== "turn.proposed.completed") {
      throw new Error("expected turn.proposed.completed");
    }
    expect(parsed.payload.planMarkdown).toBe("# Ship it");
  });

  it("decodes user-input.requested with structured questions", () => {
    const parsed = decodeRuntimeEvent({
      type: "user-input.requested",
      eventId: "event-2",
      provider: "claudeAgent",
      sessionId: "runtime-session-2",
      createdAt: "2026-02-28T00:00:01.000Z",
      threadId: "thread-2",
      requestId: "request-1",
      payload: {
        questions: [
          {
            id: "sandbox_mode",
            header: "Sandbox",
            question: "Which mode should be used?",
            options: [
              {
                label: "workspace-write",
                description: "Allow edits in workspace only",
              },
              {
                label: "danger-full-access",
                description: "Allow unrestricted access",
              },
            ],
          },
        ],
      },
    });

    expect(parsed.type).toBe("user-input.requested");
    if (parsed.type !== "user-input.requested") {
      throw new Error("expected user-input.requested");
    }
    expect(parsed.payload.questions[0]?.id).toBe("sandbox_mode");
    expect(parsed.payload.questions[0]?.options).toHaveLength(2);
  });

  it("decodes user-input.resolved with answer map", () => {
    const parsed = decodeRuntimeEvent({
      type: "user-input.resolved",
      eventId: "event-3",
      provider: "claudeAgent",
      sessionId: "runtime-session-2",
      createdAt: "2026-02-28T00:00:02.000Z",
      threadId: "thread-2",
      requestId: "request-1",
      payload: {
        answers: {
          sandbox_mode: "workspace-write",
        },
      },
    });

    expect(parsed.type).toBe("user-input.resolved");
    if (parsed.type !== "user-input.resolved") {
      throw new Error("expected user-input.resolved");
    }
    expect(parsed.payload.answers.sandbox_mode).toBe("workspace-write");
  });

  it("rejects legacy message.delta type", () => {
    expect(() =>
      decodeRuntimeEvent({
        type: "message.delta",
        eventId: "event-4",
        provider: "codex",
        sessionId: "runtime-session-3",
        createdAt: "2026-02-28T00:00:03.000Z",
        payload: { delta: "legacy" },
      }),
    ).toThrow();
  });

  it("rejects empty branded canonical ids", () => {
    expect(() =>
      decodeRuntimeEvent({
        type: "runtime.error",
        eventId: "event-5",
        provider: "codex",
        sessionId: "runtime-session-3",
        createdAt: "2026-02-28T00:00:03.000Z",
        threadId: "   ",
        payload: { message: "boom" },
      }),
    ).toThrow();
  });

  it("decodes normalized thread token usage snapshots", () => {
    const parsed = decodeRuntimeEvent({
      type: "thread.token-usage.updated",
      eventId: "event-token-usage-1",
      provider: "claudeAgent",
      createdAt: "2026-02-28T00:00:04.000Z",
      threadId: "thread-1",
      payload: {
        usage: {
          usedTokens: 31251,
          maxTokens: 200000,
          toolUses: 25,
          durationMs: 43567,
        },
      },
    });

    expect(parsed.type).toBe("thread.token-usage.updated");
    if (parsed.type !== "thread.token-usage.updated") {
      throw new Error("expected thread.token-usage.updated");
    }
    expect(parsed.payload.usage.maxTokens).toBe(200000);
    expect(parsed.payload.usage.usedTokens).toBe(31251);
  });

  it("decodes tool.denied events with optional provider metadata", () => {
    const parsed = decodeRuntimeEvent({
      type: "tool.denied",
      eventId: "event-tool-denied-1",
      provider: "claudeAgent",
      createdAt: "2026-02-28T00:00:05.000Z",
      threadId: "thread-1",
      turnId: "turn-1",
      payload: {
        toolName: "Edit",
        toolUseId: "toolu_123",
        reason: "Policy denied this edit",
        agentId: "agent-1",
      },
    });

    expect(parsed.type).toBe("tool.denied");
    if (parsed.type !== "tool.denied") {
      throw new Error("expected tool.denied");
    }
    expect(parsed.payload.toolName).toBe("Edit");
    expect(parsed.payload.toolUseId).toBe("toolu_123");
    expect(parsed.payload.reason).toBe("Policy denied this edit");
    expect(parsed.payload.agentId).toBe("agent-1");
  });

  it("decodes account.rate-limits.updated with a structured quota payload", () => {
    const parsed = decodeRuntimeEvent({
      type: "account.rate-limits.updated",
      eventId: "event-rate-limits-1",
      provider: "codex",
      providerInstanceId: "codex_pro",
      createdAt: "2026-02-28T00:00:05.000Z",
      threadId: "thread-1",
      payload: {
        status: "exhausted",
        resetAtEpochMs: 1_781_308_800_000,
        windows: [{ label: "primary", usedPercent: 100, resetAtEpochMs: 1_781_308_800_000 }],
        raw: { rateLimitReachedType: "rate_limit_reached" },
      },
    });

    expect(parsed.type).toBe("account.rate-limits.updated");
    if (parsed.type !== "account.rate-limits.updated") {
      throw new Error("expected account.rate-limits.updated");
    }
    expect(parsed.payload.status).toBe("exhausted");
    expect(parsed.payload.resetAtEpochMs).toBe(1_781_308_800_000);
    expect(parsed.payload.windows?.[0]?.usedPercent).toBe(100);
    expect(parsed.providerInstanceId).toBe("codex_pro");
  });

  it("decodes a minimal account.rate-limits.updated payload", () => {
    const parsed = decodeRuntimeEvent({
      type: "account.rate-limits.updated",
      eventId: "event-rate-limits-2",
      provider: "claudeAgent",
      createdAt: "2026-02-28T00:00:06.000Z",
      threadId: "thread-1",
      payload: {
        status: "ok",
      },
    });

    if (parsed.type !== "account.rate-limits.updated") {
      throw new Error("expected account.rate-limits.updated");
    }
    expect(parsed.payload.status).toBe("ok");
    expect(parsed.payload.resetAtEpochMs).toBeUndefined();
    expect(parsed.payload.windows).toBeUndefined();
  });

  it("decodes runtime.error events carrying the rate_limit class", () => {
    const parsed = decodeRuntimeEvent({
      type: "runtime.error",
      eventId: "event-runtime-error-rate-limit",
      provider: "claudeAgent",
      createdAt: "2026-02-28T00:00:07.000Z",
      threadId: "thread-1",
      payload: {
        message: "Usage limit reached",
        class: "rate_limit",
      },
    });

    if (parsed.type !== "runtime.error") {
      throw new Error("expected runtime.error");
    }
    expect(parsed.payload.class).toBe("rate_limit");
  });
});
