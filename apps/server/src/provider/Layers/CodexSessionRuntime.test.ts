import assert from "node:assert/strict";

import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, it } from "vitest";
import { ThreadId, TurnId } from "@t3tools/contracts";
import * as CodexErrors from "effect-codex-app-server/errors";
import * as CodexRpc from "effect-codex-app-server/rpc";
import * as EffectCodexSchema from "effect-codex-app-server/schema";

import {
  CODEX_DEFAULT_MODE_DEVELOPER_INSTRUCTIONS,
  CODEX_PLAN_MODE_DEVELOPER_INSTRUCTIONS,
} from "../CodexDeveloperInstructions.ts";
import {
  buildTurnSteerParams,
  buildTurnStartParams,
  isRecoverableThreadResumeError,
  openCodexThread,
  requestCodexTurn,
} from "./CodexSessionRuntime.ts";
const isCodexAppServerRequestError = Schema.is(CodexErrors.CodexAppServerRequestError);

function makeThreadOpenResponse(
  threadId: string,
): CodexRpc.ClientRequestResponsesByMethod["thread/start"] {
  return {
    cwd: "/tmp/project",
    model: "gpt-5.3-codex",
    modelProvider: "openai",
    approvalPolicy: "never",
    approvalsReviewer: "user",
    sandbox: { type: "danger-full-access" },
    thread: {
      id: threadId,
      createdAt: "2026-04-18T00:00:00.000Z",
      source: { session: "cli" },
      turns: [],
      status: {
        state: "idle",
        activeFlags: [],
      },
    },
  } as unknown as CodexRpc.ClientRequestResponsesByMethod["thread/start"];
}

describe("buildTurnStartParams", () => {
  it("includes plan collaboration mode when requested", () => {
    const params = Effect.runSync(
      buildTurnStartParams({
        threadId: "provider-thread-1",
        runtimeMode: "full-access",
        prompt: "Make a plan",
        model: "gpt-5.3-codex",
        effort: "medium",
        interactionMode: "plan",
      }),
    );

    assert.deepStrictEqual(params, {
      threadId: "provider-thread-1",
      approvalPolicy: "never",
      sandboxPolicy: {
        type: "dangerFullAccess",
      },
      input: [
        {
          type: "text",
          text: "Make a plan",
        },
      ],
      model: "gpt-5.3-codex",
      effort: "medium",
      collaborationMode: {
        mode: "plan",
        settings: {
          model: "gpt-5.3-codex",
          reasoning_effort: "medium",
          developer_instructions: CODEX_PLAN_MODE_DEVELOPER_INSTRUCTIONS,
        },
      },
    });
  });

  it("includes default collaboration mode and image attachments", () => {
    const params = Effect.runSync(
      buildTurnStartParams({
        threadId: "provider-thread-1",
        runtimeMode: "auto-accept-edits",
        approvalReviewer: "auto-review",
        prompt: "Implement it",
        model: "gpt-5.3-codex",
        interactionMode: "default",
        attachments: [
          {
            type: "image",
            url: "data:image/png;base64,abc",
          },
        ],
      }),
    );

    assert.deepStrictEqual(params, {
      threadId: "provider-thread-1",
      approvalPolicy: "on-request",
      approvalsReviewer: "auto_review",
      sandboxPolicy: {
        type: "workspaceWrite",
      },
      input: [
        {
          type: "text",
          text: "Implement it",
        },
        {
          type: "image",
          url: "data:image/png;base64,abc",
        },
      ],
      model: "gpt-5.3-codex",
      collaborationMode: {
        mode: "default",
        settings: {
          model: "gpt-5.3-codex",
          reasoning_effort: "medium",
          developer_instructions: CODEX_DEFAULT_MODE_DEVELOPER_INSTRUCTIONS,
        },
      },
    });
  });

  it("omits collaboration mode when interaction mode is absent", () => {
    const params = Effect.runSync(
      buildTurnStartParams({
        threadId: "provider-thread-1",
        runtimeMode: "approval-required",
        prompt: "Review",
      }),
    );

    assert.deepStrictEqual(params, {
      threadId: "provider-thread-1",
      approvalPolicy: "untrusted",
      sandboxPolicy: {
        type: "readOnly",
      },
      input: [
        {
          type: "text",
          text: "Review",
        },
      ],
    });
  });
});

describe("Codex turn dispatch", () => {
  const startParams = Effect.runSync(
    buildTurnStartParams({
      threadId: "provider-thread-1",
      runtimeMode: "full-access",
      prompt: "Change direction",
    }),
  );
  const steerParams = Effect.runSync(
    buildTurnSteerParams({
      threadId: "provider-thread-1",
      turnId: TurnId.make("turn-active"),
      prompt: "Change direction",
      attachments: [{ type: "image", url: "data:image/png;base64,abc" }],
    }),
  );

  it("builds the exact generated turn/steer request payload", () => {
    assert.deepStrictEqual(steerParams, {
      threadId: "provider-thread-1",
      expectedTurnId: "turn-active",
      input: [
        { type: "text", text: "Change direction" },
        { type: "image", url: "data:image/png;base64,abc" },
      ],
    });
  });

  it("steers an active turn without starting or interrupting it", async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    const client = {
      raw: {
        request: (method: "turn/start", params: unknown) => {
          calls.push({ method, params });
          return Effect.succeed({ turn: { id: "turn-new", items: [], status: "inProgress" } });
        },
      },
      request: (method: "turn/steer", params: EffectCodexSchema.V2TurnSteerParams) => {
        calls.push({ method, params });
        return Effect.succeed({ turnId: "turn-active" });
      },
    };

    const result = await Effect.runPromise(
      requestCodexTurn({
        client,
        activeTurnId: TurnId.make("turn-active"),
        startParams,
        steerParams,
      }),
    );

    assert.deepStrictEqual(result, { turnId: "turn-active", delivery: "steered" });
    assert.deepStrictEqual(calls, [{ method: "turn/steer", params: steerParams }]);
  });

  it("starts a new turn when the session is idle", async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    const client = {
      raw: {
        request: (method: "turn/start", params: unknown) => {
          calls.push({ method, params });
          return Effect.succeed({ turn: { id: "turn-new", items: [], status: "inProgress" } });
        },
      },
      request: (method: "turn/steer", params: EffectCodexSchema.V2TurnSteerParams) => {
        calls.push({ method, params });
        return Effect.succeed({ turnId: "turn-active" });
      },
    };

    const result = await Effect.runPromise(requestCodexTurn({ client, startParams, steerParams }));

    assert.deepStrictEqual(result, { turnId: "turn-new", delivery: "started" });
    assert.deepStrictEqual(calls, [{ method: "turn/start", params: startParams }]);
  });

  it("propagates turn/steer rejection without falling back to turn/start", async () => {
    const rejection = new CodexErrors.CodexAppServerRequestError({
      code: -32602,
      errorMessage: "active turn does not match expectedTurnId",
    });
    let startCalls = 0;
    const client = {
      raw: {
        request: () => {
          startCalls += 1;
          return Effect.succeed({ turn: { id: "turn-new" } });
        },
      },
      request: () => Effect.fail(rejection),
    };

    const result = await Effect.runPromise(
      requestCodexTurn({
        client,
        activeTurnId: TurnId.make("turn-active"),
        startParams,
        steerParams,
      }).pipe(Effect.result),
    );

    assert.equal(result._tag, "Failure");
    assert.equal(result.failure, rejection);
    assert.equal(startCalls, 0);
  });
});

describe("isRecoverableThreadResumeError", () => {
  it("matches missing thread errors", () => {
    assert.equal(
      isRecoverableThreadResumeError(
        new CodexErrors.CodexAppServerRequestError({
          code: -32603,
          errorMessage: "Thread does not exist",
        }),
      ),
      true,
    );
  });

  it("ignores non-recoverable resume errors", () => {
    assert.equal(
      isRecoverableThreadResumeError(
        new CodexErrors.CodexAppServerRequestError({
          code: -32603,
          errorMessage: "Permission denied",
        }),
      ),
      false,
    );
  });

  it("ignores unrelated missing-resource errors that do not mention threads", () => {
    assert.equal(
      isRecoverableThreadResumeError(
        new CodexErrors.CodexAppServerRequestError({
          code: -32603,
          errorMessage: "Config file not found",
        }),
      ),
      false,
    );
    assert.equal(
      isRecoverableThreadResumeError(
        new CodexErrors.CodexAppServerRequestError({
          code: -32603,
          errorMessage: "Model does not exist",
        }),
      ),
      false,
    );
  });
});

describe("openCodexThread", () => {
  it("falls back to thread/start when resume fails recoverably", async () => {
    const calls: Array<{ method: "thread/start" | "thread/resume"; payload: unknown }> = [];
    const started = makeThreadOpenResponse("fresh-thread");
    const client = {
      request: <M extends "thread/start" | "thread/resume">(
        method: M,
        payload: CodexRpc.ClientRequestParamsByMethod[M],
      ) => {
        calls.push({ method, payload });
        if (method === "thread/resume") {
          return Effect.fail(
            new CodexErrors.CodexAppServerRequestError({
              code: -32603,
              errorMessage: "thread not found",
            }),
          );
        }
        return Effect.succeed(started as CodexRpc.ClientRequestResponsesByMethod[M]);
      },
    };

    const opened = await Effect.runPromise(
      openCodexThread({
        client,
        threadId: ThreadId.make("thread-1"),
        runtimeMode: "full-access",
        cwd: "/tmp/project",
        requestedModel: "gpt-5.3-codex",
        serviceTier: undefined,
        systemPromptAppend: undefined,
        config: undefined,
        resumeThreadId: "stale-thread",
      }),
    );

    assert.equal(opened.thread.id, "fresh-thread");
    assert.deepStrictEqual(
      calls.map((call) => call.method),
      ["thread/resume", "thread/start"],
    );
  });

  it("propagates non-recoverable resume failures", async () => {
    const client = {
      request: <M extends "thread/start" | "thread/resume">(
        method: M,
        _payload: CodexRpc.ClientRequestParamsByMethod[M],
      ) => {
        if (method === "thread/resume") {
          return Effect.fail(
            new CodexErrors.CodexAppServerRequestError({
              code: -32603,
              errorMessage: "timed out waiting for server",
            }),
          );
        }
        return Effect.succeed(
          makeThreadOpenResponse("fresh-thread") as CodexRpc.ClientRequestResponsesByMethod[M],
        );
      },
    };

    await assert.rejects(
      Effect.runPromise(
        openCodexThread({
          client,
          threadId: ThreadId.make("thread-1"),
          runtimeMode: "full-access",
          cwd: "/tmp/project",
          requestedModel: "gpt-5.3-codex",
          serviceTier: undefined,
          systemPromptAppend: undefined,
          config: undefined,
          resumeThreadId: "stale-thread",
        }),
      ),
      (error: unknown) =>
        isCodexAppServerRequestError(error) &&
        error.errorMessage === "timed out waiting for server",
    );
  });

  it("sends developerInstructions on thread/start when systemPromptAppend is set", async () => {
    const calls: Array<{ method: "thread/start" | "thread/resume"; payload: unknown }> = [];
    const client = {
      request: <M extends "thread/start" | "thread/resume">(
        method: M,
        payload: CodexRpc.ClientRequestParamsByMethod[M],
      ) => {
        calls.push({ method, payload });
        return Effect.succeed(
          makeThreadOpenResponse("fresh-thread") as CodexRpc.ClientRequestResponsesByMethod[M],
        );
      },
    };

    await Effect.runPromise(
      openCodexThread({
        client,
        threadId: ThreadId.make("thread-1"),
        runtimeMode: "full-access",
        cwd: "/tmp/project",
        requestedModel: "gpt-5.3-codex",
        serviceTier: undefined,
        systemPromptAppend: "Use the orchestration rules.",
        config: undefined,
        resumeThreadId: undefined,
      }),
    );

    assert.deepStrictEqual(calls, [
      {
        method: "thread/start",
        payload: {
          cwd: "/tmp/project",
          approvalPolicy: "never",
          sandbox: "danger-full-access",
          model: "gpt-5.3-codex",
          developerInstructions: "Use the orchestration rules.",
        },
      },
    ]);
  });

  it("re-sends developerInstructions on thread/resume when systemPromptAppend is set", async () => {
    const calls: Array<{ method: "thread/start" | "thread/resume"; payload: unknown }> = [];
    const client = {
      request: <M extends "thread/start" | "thread/resume">(
        method: M,
        payload: CodexRpc.ClientRequestParamsByMethod[M],
      ) => {
        calls.push({ method, payload });
        return Effect.succeed(
          makeThreadOpenResponse("resumed-thread") as CodexRpc.ClientRequestResponsesByMethod[M],
        );
      },
    };

    await Effect.runPromise(
      openCodexThread({
        client,
        threadId: ThreadId.make("thread-1"),
        runtimeMode: "approval-required",
        cwd: "/tmp/project",
        requestedModel: undefined,
        serviceTier: undefined,
        systemPromptAppend: "Use the orchestration rules.",
        config: undefined,
        resumeThreadId: "provider-thread-1",
      }),
    );

    assert.deepStrictEqual(calls, [
      {
        method: "thread/resume",
        payload: {
          threadId: "provider-thread-1",
          cwd: "/tmp/project",
          approvalPolicy: "untrusted",
          sandbox: "read-only",
          developerInstructions: "Use the orchestration rules.",
        },
      },
    ]);
  });

  it("applies auto-review when resuming a workspace-write thread", async () => {
    const calls: Array<{ method: "thread/start" | "thread/resume"; payload: unknown }> = [];
    const client = {
      request: <M extends "thread/start" | "thread/resume">(
        method: M,
        payload: CodexRpc.ClientRequestParamsByMethod[M],
      ) => {
        calls.push({ method, payload });
        return Effect.succeed(
          makeThreadOpenResponse(
            "auto-reviewed-thread",
          ) as CodexRpc.ClientRequestResponsesByMethod[M],
        );
      },
    };

    await Effect.runPromise(
      openCodexThread({
        client,
        threadId: ThreadId.make("thread-1"),
        runtimeMode: "auto-accept-edits",
        approvalReviewer: "auto-review",
        cwd: "/tmp/project",
        requestedModel: undefined,
        serviceTier: undefined,
        systemPromptAppend: undefined,
        config: undefined,
        resumeThreadId: "provider-thread-1",
      }),
    );

    assert.deepStrictEqual(calls, [
      {
        method: "thread/resume",
        payload: {
          threadId: "provider-thread-1",
          cwd: "/tmp/project",
          approvalPolicy: "on-request",
          approvalsReviewer: "auto_review",
          sandbox: "workspace-write",
        },
      },
    ]);
  });

  it("omits developerInstructions when systemPromptAppend is unset", async () => {
    const calls: Array<{
      method: "thread/start" | "thread/resume";
      payload: Record<string, unknown>;
    }> = [];
    const client = {
      request: <M extends "thread/start" | "thread/resume">(
        method: M,
        payload: CodexRpc.ClientRequestParamsByMethod[M],
      ) => {
        calls.push({ method, payload: payload as Record<string, unknown> });
        return Effect.succeed(
          makeThreadOpenResponse("fresh-thread") as CodexRpc.ClientRequestResponsesByMethod[M],
        );
      },
    };

    await Effect.runPromise(
      openCodexThread({
        client,
        threadId: ThreadId.make("thread-1"),
        runtimeMode: "full-access",
        cwd: "/tmp/project",
        requestedModel: undefined,
        serviceTier: undefined,
        systemPromptAppend: undefined,
        config: undefined,
        resumeThreadId: undefined,
      }),
    );

    assert.equal("developerInstructions" in calls[0]!.payload, false);
  });
});
