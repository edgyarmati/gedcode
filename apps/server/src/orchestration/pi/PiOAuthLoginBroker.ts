import { randomUUID } from "node:crypto";

import {
  PiOAuthLoginError,
  PiOAuthLoginSessionId,
  PiProviderId,
  type PiOAuthDeviceCodeInfo,
  type PiOAuthLoginCancelResult,
  type PiOAuthLoginStartResult,
  type PiOAuthLoginStatus,
} from "@t3tools/contracts";
import type {
  OAuthAuthInfo,
  OAuthCredentials,
  OAuthDeviceCodeInfo,
  OAuthLoginCallbacks,
  OAuthPrompt,
  OAuthProviderInterface,
  OAuthSelectPrompt,
} from "@earendil-works/pi-ai/oauth";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import { PiOAuthCredentialStore, PiOAuthCredentialStoreLive } from "./PiOAuthCredentialStore.ts";
import { PiOAuthProviderClient, PiOAuthProviderClientLive } from "./PiOAuthProviders.ts";

const DEFAULT_LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

interface PendingOAuthLoginSession {
  readonly sessionId: PiOAuthLoginSessionId;
  readonly provider: PiProviderId;
  readonly code: Deferred.Deferred<string, PiOAuthLoginError>;
  readonly initialInfo: Deferred.Deferred<PiOAuthLoginStartResult, PiOAuthLoginError>;
  readonly result: Deferred.Deferred<PiOAuthLoginStatus, PiOAuthLoginError>;
  readonly abortController: AbortController;
  readonly loginFiber: Fiber.Fiber<void, never>;
  readonly timeoutFiber: Fiber.Fiber<void, never>;
}

export interface PiOAuthLoginBrokerShape {
  readonly start: (
    provider: PiProviderId,
  ) => Effect.Effect<PiOAuthLoginStartResult, PiOAuthLoginError>;
  readonly complete: (input: {
    readonly sessionId: PiOAuthLoginSessionId;
    readonly code: string;
  }) => Effect.Effect<PiOAuthLoginStatus, PiOAuthLoginError>;
  readonly cancel: (
    sessionId: PiOAuthLoginSessionId,
  ) => Effect.Effect<PiOAuthLoginCancelResult, PiOAuthLoginError>;
}

export class PiOAuthLoginBroker extends Context.Service<
  PiOAuthLoginBroker,
  PiOAuthLoginBrokerShape
>()("gedcode/orchestration/pi/PiOAuthLoginBroker") {}

function makeLoginError(input: {
  readonly reason: string;
  readonly provider?: PiProviderId;
  readonly sessionId?: PiOAuthLoginSessionId;
  readonly cause?: unknown;
}): PiOAuthLoginError {
  return new PiOAuthLoginError({
    reason: input.reason,
    ...(input.provider ? { provider: input.provider } : {}),
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.cause !== undefined ? { cause: input.cause } : {}),
  });
}

function optionalTrimmed(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function toStartResult(input: {
  readonly sessionId: PiOAuthLoginSessionId;
  readonly provider: PiProviderId;
  readonly auth?: OAuthAuthInfo;
  readonly deviceCode?: OAuthDeviceCodeInfo;
}): PiOAuthLoginStartResult {
  const authUrl = optionalTrimmed(input.auth?.url);
  const instructions = optionalTrimmed(input.auth?.instructions);
  return {
    sessionId: input.sessionId,
    provider: input.provider,
    ...(authUrl ? { authUrl } : {}),
    ...(instructions ? { instructions } : {}),
    ...(input.deviceCode
      ? {
          deviceCode: {
            userCode: input.deviceCode.userCode,
            verificationUri: input.deviceCode.verificationUri,
            ...(input.deviceCode.intervalSeconds !== undefined
              ? { intervalSeconds: input.deviceCode.intervalSeconds }
              : {}),
            ...(input.deviceCode.expiresInSeconds !== undefined
              ? { expiresInSeconds: input.deviceCode.expiresInSeconds }
              : {}),
          } satisfies PiOAuthDeviceCodeInfo,
        }
      : {}),
  };
}

function shouldAutoAnswerPrompt(prompt: OAuthPrompt): boolean {
  return prompt.allowEmpty === true;
}

function selectLoginOption(prompt: OAuthSelectPrompt): string | undefined {
  return (
    prompt.options.find((option) => option.id === "browser")?.id ??
    prompt.options.find((option) => option.id === "device_code")?.id ??
    prompt.options[0]?.id
  );
}

export const makePiOAuthLoginBroker = (options?: { readonly loginTimeoutMs?: number }) =>
  Effect.gen(function* () {
    const providers = yield* PiOAuthProviderClient;
    const credentials = yield* PiOAuthCredentialStore;
    const sessions = yield* Ref.make(new Map<string, PendingOAuthLoginSession>());
    const loginTimeoutMs = options?.loginTimeoutMs ?? DEFAULT_LOGIN_TIMEOUT_MS;

    const findSession = (sessionId: PiOAuthLoginSessionId) =>
      Ref.get(sessions).pipe(Effect.map((current) => current.get(sessionId)));

    const removeSession = (sessionId: PiOAuthLoginSessionId) =>
      Ref.update(sessions, (current) => {
        const next = new Map(current);
        next.delete(sessionId);
        return next;
      });

    const stopSession = (
      session: PendingOAuthLoginSession,
      error: PiOAuthLoginError,
      options?: { readonly interruptTimeout?: boolean },
    ) =>
      Effect.gen(function* () {
        session.abortController.abort();
        yield* Deferred.fail(session.code, error).pipe(Effect.ignore);
        yield* Deferred.fail(session.initialInfo, error).pipe(Effect.ignore);
        yield* Deferred.fail(session.result, error).pipe(Effect.ignore);
        yield* removeSession(session.sessionId);
        yield* Fiber.interrupt(session.loginFiber).pipe(Effect.ignore);
        if (options?.interruptTimeout !== false) {
          yield* Fiber.interrupt(session.timeoutFiber).pipe(Effect.ignore);
        }
      });

    const completeWithCredentials = (
      session: Pick<PendingOAuthLoginSession, "provider">,
      oauthCredentials: OAuthCredentials,
    ) =>
      credentials.save(session.provider, oauthCredentials).pipe(
        Effect.as({
          connected: true,
          provider: session.provider,
          ...(Number.isFinite(oauthCredentials.expires)
            ? { expiresAt: oauthCredentials.expires }
            : {}),
        } satisfies PiOAuthLoginStatus),
        Effect.mapError((cause) =>
          makeLoginError({
            provider: session.provider,
            reason: "failed to persist OAuth credentials",
            cause,
          }),
        ),
      );

    const start: PiOAuthLoginBrokerShape["start"] = (provider) =>
      Effect.gen(function* () {
        const oauthProvider = yield* providers.getProvider(provider).pipe(
          Effect.mapError((cause) =>
            makeLoginError({
              provider,
              reason: "failed to load OAuth provider",
              cause,
            }),
          ),
        );
        if (!oauthProvider) {
          return yield* makeLoginError({
            provider,
            reason: "provider is not an OAuth provider",
          });
        }

        const alreadyPending = yield* Ref.get(sessions).pipe(
          Effect.map((current) =>
            Array.from(current.values()).some((s) => s.provider === provider),
          ),
        );
        if (alreadyPending) {
          return yield* makeLoginError({
            provider,
            reason: "OAuth login is already pending for this provider",
          });
        }

        const sessionId = PiOAuthLoginSessionId.make(`pi-oauth:${randomUUID()}`);
        const code = yield* Deferred.make<string, PiOAuthLoginError>();
        const initialInfo = yield* Deferred.make<PiOAuthLoginStartResult, PiOAuthLoginError>();
        const result = yield* Deferred.make<PiOAuthLoginStatus, PiOAuthLoginError>();
        const abortController = new AbortController();

        const publishInitialInfo = (info: {
          readonly auth?: OAuthAuthInfo;
          readonly deviceCode?: OAuthDeviceCodeInfo;
        }) =>
          Deferred.succeed(
            initialInfo,
            toStartResult({
              sessionId,
              provider,
              ...info,
            }),
          ).pipe(Effect.ignore);

        const waitForUserCode = () => Effect.runPromise(Deferred.await(code));
        const callbacks: OAuthLoginCallbacks = {
          onAuth: (info) => {
            Effect.runFork(publishInitialInfo({ auth: info }));
          },
          onDeviceCode: (info) => {
            Effect.runFork(publishInitialInfo({ deviceCode: info }));
          },
          onPrompt: (prompt) => {
            if (shouldAutoAnswerPrompt(prompt)) {
              return Promise.resolve("");
            }
            return waitForUserCode();
          },
          onManualCodeInput: waitForUserCode,
          onSelect: async (prompt) => selectLoginOption(prompt),
          signal: abortController.signal,
        };

        const loginProgram = runProviderLogin({
          provider,
          sessionId,
          oauthProvider,
          callbacks,
        }).pipe(
          Effect.flatMap((oauthCredentials) =>
            completeWithCredentials({ provider }, oauthCredentials),
          ),
          Effect.matchEffect({
            onFailure: (error) =>
              Deferred.fail(initialInfo, error).pipe(
                Effect.ignore,
                Effect.andThen(Deferred.fail(result, error).pipe(Effect.ignore)),
              ),
            onSuccess: (status) => Deferred.succeed(result, status).pipe(Effect.ignore),
          }),
        );

        const loginFiber = yield* Effect.forkDetach(loginProgram);
        const timeoutFiber = yield* Effect.forkDetach(
          Effect.sleep(loginTimeoutMs).pipe(
            Effect.flatMap(() => findSession(sessionId)),
            Effect.flatMap((session) => {
              if (!session) return Effect.void;
              return stopSession(
                session,
                makeLoginError({
                  provider,
                  sessionId,
                  reason: "OAuth login timed out",
                }),
                { interruptTimeout: false },
              );
            }),
          ),
        );

        const session: PendingOAuthLoginSession = {
          sessionId,
          provider,
          code,
          initialInfo,
          result,
          abortController,
          loginFiber,
          timeoutFiber,
        };
        yield* Ref.update(sessions, (current) => {
          const next = new Map(current);
          next.set(sessionId, session);
          return next;
        });

        return yield* Deferred.await(initialInfo).pipe(
          Effect.onError(() =>
            removeSession(sessionId).pipe(
              Effect.andThen(Fiber.interrupt(timeoutFiber).pipe(Effect.ignore)),
            ),
          ),
        );
      });

    const complete: PiOAuthLoginBrokerShape["complete"] = (input) =>
      Effect.gen(function* () {
        const session = yield* findSession(input.sessionId);
        if (!session) {
          return yield* makeLoginError({
            sessionId: input.sessionId,
            reason: "OAuth login session was not found",
          });
        }
        yield* Deferred.succeed(session.code, input.code).pipe(Effect.ignore);
        const status = yield* Deferred.await(session.result);
        yield* removeSession(input.sessionId);
        yield* Fiber.interrupt(session.timeoutFiber).pipe(Effect.ignore);
        return status;
      });

    const cancel: PiOAuthLoginBrokerShape["cancel"] = (sessionId) =>
      Effect.gen(function* () {
        const session = yield* findSession(sessionId);
        if (!session) {
          return yield* makeLoginError({
            sessionId,
            reason: "OAuth login session was not found",
          });
        }
        yield* stopSession(
          session,
          makeLoginError({
            provider: session.provider,
            sessionId,
            reason: "OAuth login was cancelled",
          }),
        );
        return {
          sessionId,
          cancelled: true,
        } satisfies PiOAuthLoginCancelResult;
      });

    return {
      start,
      complete,
      cancel,
    } satisfies PiOAuthLoginBrokerShape;
  });

function runProviderLogin(input: {
  readonly provider: PiProviderId;
  readonly sessionId: PiOAuthLoginSessionId;
  readonly oauthProvider: OAuthProviderInterface;
  readonly callbacks: OAuthLoginCallbacks;
}): Effect.Effect<OAuthCredentials, PiOAuthLoginError> {
  return Effect.tryPromise({
    try: () => input.oauthProvider.login(input.callbacks),
    catch: (cause) =>
      makeLoginError({
        provider: input.provider,
        sessionId: input.sessionId,
        reason: cause instanceof Error ? cause.message : "OAuth login failed",
        cause,
      }),
  });
}

export const PiOAuthLoginBrokerLayer = (options?: { readonly loginTimeoutMs?: number }) =>
  Layer.effect(PiOAuthLoginBroker, makePiOAuthLoginBroker(options));

export const PiOAuthLoginBrokerLive = PiOAuthLoginBrokerLayer().pipe(
  Layer.provideMerge(PiOAuthProviderClientLive),
  Layer.provideMerge(PiOAuthCredentialStoreLive),
);
