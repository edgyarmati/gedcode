import { OrchestratorMcpFailure, type ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as ProjectMemory from "../../../ged/ProjectMemory.ts";
import * as Project from "../../../project/ProjectService.ts";
import { readThread, unavailable } from "../../threadAccess.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { MemoryToolkit } from "./tools.ts";

const notFound = (message: string) =>
  new OrchestratorMcpFailure({ code: "invalid_request", message });

const memoryFailure = (error: ProjectMemory.GedMemoryError) =>
  new OrchestratorMcpFailure({ code: "invalid_request", message: error.message });

/**
 * Where this thread's memory lives. A thread bound to a worktree reads the
 * memory in that worktree, not the project root's — a lead may be changing the
 * briefs on its own branch, and its children must see the branch's version.
 */
const resolveRoot = Effect.fn("ged.resolveRoot")(function* (threadId?: ThreadId) {
  const {
    projection: { thread },
  } = yield* readThread(threadId);
  const projects = yield* Project.ProjectService;
  const project = yield* projects.getById(thread.projectId).pipe(Effect.mapError(unavailable));
  if (Option.isNone(project)) return yield* notFound("The project was not found.");
  return thread.worktreePath ?? project.value.workspaceRoot;
});

const ROLE_BRIEFS = {
  planner: "roles/planner.md",
  implementer: "roles/implementer.md",
  verifier: "roles/verifier.md",
} as const;

const MODEL_POLICY_KEY = "roles/model-policy.md";

const handlers = {
  ged_memory_list: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      const root = yield* resolveRoot(input.threadId);
      const memory = yield* ProjectMemory.ProjectMemory;
      const documents = yield* memory.list(root).pipe(Effect.mapError(memoryFailure));
      return { documents };
    }),
  ),
  ged_memory_read: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      const root = yield* resolveRoot(input.threadId);
      const memory = yield* ProjectMemory.ProjectMemory;
      const content = yield* memory.read(root, input.key).pipe(Effect.mapError(memoryFailure));
      return { key: input.key, content };
    }),
  ),
  ged_role_brief: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      const root = yield* resolveRoot(input.threadId);
      const memory = yield* ProjectMemory.ProjectMemory;
      const brief = yield* memory
        .read(root, ROLE_BRIEFS[input.role])
        .pipe(Effect.mapError(memoryFailure));
      // The policy is advisory: a project without one still gets its briefs,
      // rather than failing the call the lead needs to delegate at all.
      const modelPolicy = yield* memory
        .read(root, MODEL_POLICY_KEY)
        .pipe(Effect.orElseSucceed(() => null));
      return { role: input.role, brief, modelPolicy };
    }),
  ),
  ged_verdict_write: McpToolAccess.writes((input) =>
    Effect.gen(function* () {
      const { threadId, branch, ...rest } = input;
      const root = yield* resolveRoot(threadId);
      const memory = yield* ProjectMemory.ProjectMemory;
      if (
        rest.implementer.driverKind.trim().toLowerCase() ===
        rest.verifier.driverKind.trim().toLowerCase()
      )
        return yield* notFound(
          "The verifier and the implementer are the same vendor, so the verdict carries no independence. Delegate verification to a different driverKind.",
        );
      const path = yield* memory
        .writeVerdict(root, branch, { schemaVersion: 1, branch, ...rest })
        .pipe(Effect.mapError(memoryFailure));
      // Report what the gate makes of the record just written, so a verifier
      // that recorded something the gate rejects finds out now rather than at push.
      const ruling = yield* memory.landCheck(root).pipe(
        Effect.map((result) => `${result.outcome}: ${result.detail}`),
        Effect.orElseSucceed(() => "not evaluated: this project has no land gate."),
      );
      return { path, ruling };
    }),
  ),
  ged_land_check: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      const root = yield* resolveRoot(input.threadId);
      const memory = yield* ProjectMemory.ProjectMemory;
      return yield* memory.landCheck(root).pipe(Effect.mapError(memoryFailure));
    }),
  ),
} satisfies McpToolAccess.Handlers<typeof MemoryToolkit.tools>;

export const layer = McpToolAccess.toLayer(MemoryToolkit, handlers);
