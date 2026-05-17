import type { ProviderSession, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ProviderValidationError } from "../../provider/Errors.ts";
import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { GedWorkflowService } from "../Services/GedWorkflowService.ts";
import { injectWorkflowContext, validateTurnGuards } from "./GedWorkflowTurnInterceptor.ts";

const resolveSessionCwd = (
  threadId: ThreadId,
  sessions: ReadonlyArray<ProviderSession>,
): string | undefined => sessions.find((s) => s.threadId === threadId)?.cwd;

export const GedWorkflowGuardLive = Layer.effect(
  ProviderService,
  Effect.gen(function* () {
    const inner = yield* ProviderService;
    const workflow = yield* GedWorkflowService;

    const guardedSendTurn: (typeof inner)["sendTurn"] = (input) =>
      Effect.gen(function* () {
        const sessions = yield* inner.listSessions();
        const cwd = resolveSessionCwd(input.threadId, sessions);

        if (cwd) {
          yield* workflow.bootstrap(cwd);
          if (input.input) {
            yield* workflow.classifyTurn(cwd, input.input);
          }

          const guardResult = yield* validateTurnGuards(cwd).pipe(
            Effect.provideService(GedWorkflowService, workflow),
          );
          if (!guardResult.allowed) {
            return yield* new ProviderValidationError({
              operation: "GedWorkflowGuard.sendTurn",
              issue: guardResult.reason ?? "Ged workflow guard blocked this turn.",
            });
          }
        }

        const enriched = yield* injectWorkflowContext(input).pipe(
          Effect.provideService(GedWorkflowService, workflow),
        );

        return yield* inner.sendTurn(enriched);
      });

    return {
      ...inner,
      sendTurn: guardedSendTurn,
    };
  }),
);
