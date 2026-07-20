import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  OrchestratorLaunchCapabilities,
  OrchestratorLaunchInput,
  OrchestratorLaunchResult,
} from "./editor.ts";

const decodeInput = Schema.decodeUnknownEffect(OrchestratorLaunchInput);
const decodeResult = Schema.decodeUnknownEffect(OrchestratorLaunchResult);
const decodeCapabilities = Schema.decodeUnknownEffect(OrchestratorLaunchCapabilities);

it.effect("decodes logical project and task launch targets without accepting a path", () =>
  Effect.gen(function* () {
    const project = yield* decodeInput({
      target: { kind: "project-root", projectId: "project-1" },
      operation: { kind: "editor", editor: "cursor" },
    });
    const task = yield* decodeInput({
      target: { kind: "task-worktree", projectId: "project-1", taskId: "task-1" },
      operation: { kind: "terminal" },
    });

    assert.strictEqual(project.target.kind, "project-root");
    assert.strictEqual(task.target.kind, "task-worktree");
    assert.isTrue(yield* Effect.isFailure(decodeInput({ cwd: "/tmp/forged", operation: {} })));
  }),
);

it.effect("decodes capabilities and path-free launch acknowledgements", () =>
  Effect.gen(function* () {
    const capabilities = yield* decodeCapabilities({
      editors: ["cursor", "zed"],
      reveal: true,
      terminal: false,
    });
    const result = yield* decodeResult({
      launched: true,
      target: { kind: "project-root", projectId: "project-1" },
      operation: { kind: "reveal" },
    });

    assert.deepEqual(capabilities.editors, ["cursor", "zed"]);
    assert.strictEqual(result.operation.kind, "reveal");
  }),
);
