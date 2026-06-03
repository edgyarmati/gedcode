import type { ProviderSession, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { GedWorkflowService } from "../Services/GedWorkflowService.ts";
import { injectWorkflowContext } from "./GedWorkflowTurnInterceptor.ts";

const resolveSession = (
  threadId: ThreadId,
  sessions: ReadonlyArray<ProviderSession>,
): ProviderSession | undefined => sessions.find((s) => s.threadId === threadId);

export const GedWorkflowGuardLive = Layer.effect(
  ProviderService,
  Effect.gen(function* () {
    const inner = yield* ProviderService;
    const workflow = yield* GedWorkflowService;

    const guardedSendTurn: (typeof inner)["sendTurn"] = (input) =>
      Effect.gen(function* () {
        const defaultEnabled = yield* workflow.isEnabled;
        const enabled = input.gedWorkflowEnabled ?? defaultEnabled;
        if (!enabled) {
          return yield* inner.sendTurn(input);
        }

        const sessions = yield* inner.listSessions();
        const session = resolveSession(input.threadId, sessions);
        const cwd = session?.cwd;

        if (cwd) {
          yield* workflow.recordThreadCwd(input.threadId, cwd);
          yield* workflow.bootstrap(cwd);
          if (input.input) {
            yield* workflow.classifyTurn(cwd, input.input);
          }
        }

        const enriched = yield* injectWorkflowContext(
          input,
          session
            ? { provider: session.provider, providerInstanceId: session.providerInstanceId }
            : undefined,
        ).pipe(Effect.provideService(GedWorkflowService, workflow));

        return yield* inner.sendTurn(enriched);
      });

    return {
      ...inner,
      sendTurn: guardedSendTurn,
    };
  }),
);
