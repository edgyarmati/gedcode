import { OrchestratorMcpFailure, type ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as GedSetup from "../../../ged/GedSetup.ts";
import * as ProjectMemory from "../../../ged/ProjectMemory.ts";
import { PLAYBOOKS } from "../../../ged/playbooks/index.ts";
import { sameVendor } from "../../../ged/verdictRecord.ts";
import * as Project from "../../../project/ProjectService.ts";
import { readThread, unavailable } from "../../threadAccess.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import * as OrchestratorMcpService from "../../OrchestratorMcpService.ts";
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

/**
 * Whether a provider of another vendor than the implementer's could run a child
 * task right now. Asked of the same live catalog delegation uses, so a verifier
 * cannot claim there was no alternative when there was one.
 */
const otherVendorAvailable = Effect.fn("ged.otherVendorAvailable")(function* (
  implementerKind: string,
) {
  const scope = yield* McpInvocationContext.McpInvocationContext;
  const orchestrator = yield* OrchestratorMcpService.OrchestratorMcpService;
  const { providers } = yield* orchestrator.capabilities(scope);
  return providers.some(
    (provider) => provider.canRunChildTask && !sameVendor(provider.driverKind, implementerKind),
  );
});

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
  ged_playbook: McpToolAccess.reads((input) =>
    Effect.succeed({ name: input.name, content: PLAYBOOKS[input.name] }),
  ),
  ged_verdict_write: McpToolAccess.writes((input) =>
    Effect.gen(function* () {
      const { threadId, branch, headSha, implementer, verifier, status, criteria } = input;
      const root = yield* resolveRoot(threadId);
      const memory = yield* ProjectMemory.ProjectMemory;
      const path = yield* memory
        .recordRuling(root, {
          branch,
          headSha,
          implementer,
          review: {
            verifier,
            status,
            criteria,
            otherVendorAvailable: yield* otherVendorAvailable(implementer.driverKind),
          },
        })
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
  ged_init: McpToolAccess.writes((input) =>
    Effect.gen(function* () {
      const root = yield* resolveRoot(input.threadId);
      const setup = yield* GedSetup.GedSetup;
      const failure = (error: GedSetup.GedSetupError) => notFound(error.message);
      if (input.apply !== true) {
        const plan = yield* setup.preview(root).pipe(Effect.mapError(failure));
        return { applied: false, ...plan };
      }
      const result = yield* setup.apply(root).pipe(Effect.mapError(failure));
      return { applied: true, missing: result.written, present: result.skipped };
    }),
  ),
} satisfies McpToolAccess.Handlers<typeof MemoryToolkit.tools>;

export const layer = McpToolAccess.toLayer(MemoryToolkit, handlers);
