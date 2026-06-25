import { type OAuthCredentials } from "@earendil-works/pi-ai/oauth";
import { type PiProviderConfig } from "@t3tools/contracts";
import { fromJsonStringPretty } from "@t3tools/shared/schemaJson";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";

import { ServerSecretStoreLive } from "../../auth/Layers/ServerSecretStore.ts";
import { ServerSecretStore } from "../../auth/Services/ServerSecretStore.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { PiOAuthProviderClient, PiOAuthProviderClientLive } from "./PiOAuthProviders.ts";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const OAuthCredentialsRecord = Schema.Record(Schema.String, Schema.Unknown);
const OAuthCredentialsJson = fromJsonStringPretty(OAuthCredentialsRecord);
const encodeOAuthCredentialsJson = Schema.encodeUnknownEffect(OAuthCredentialsJson);
const decodeOAuthCredentialsJson = Schema.decodeUnknownEffect(OAuthCredentialsJson);

export class PiOAuthCredentialError extends Data.TaggedError("PiOAuthCredentialError")<{
  readonly provider: string;
  readonly reason: string;
  readonly cause?: unknown;
}> {
  override get message(): string {
    return `Pi OAuth credential error for ${this.provider}: ${this.reason}`;
  }
}

export interface PiOAuthCredentialStoreShape {
  readonly save: (
    provider: string,
    credentials: OAuthCredentials,
  ) => Effect.Effect<void, PiOAuthCredentialError>;
  readonly clear: (provider: string) => Effect.Effect<void, PiOAuthCredentialError>;
  readonly getAccessToken: (provider: string) => Effect.Effect<string, PiOAuthCredentialError>;
}

export class PiOAuthCredentialStore extends Context.Service<
  PiOAuthCredentialStore,
  PiOAuthCredentialStoreShape
>()("gedcode/orchestration/pi/PiOAuthCredentialStore") {}

export function piOAuthCredentialSecretName(provider: string): string {
  return `pi-cred-${Buffer.from(provider, "utf8").toString("base64url")}-oauth`;
}

function normalizeExpiresAt(credentials: OAuthCredentials): number | undefined {
  return Number.isFinite(credentials.expires) ? credentials.expires : undefined;
}

function validateOAuthCredentials(provider: string, raw: unknown): OAuthCredentials {
  if (
    raw === null ||
    typeof raw !== "object" ||
    typeof (raw as { refresh?: unknown }).refresh !== "string" ||
    typeof (raw as { access?: unknown }).access !== "string" ||
    typeof (raw as { expires?: unknown }).expires !== "number"
  ) {
    throw new PiOAuthCredentialError({
      provider,
      reason: "stored OAuth credentials are invalid",
      cause: raw,
    });
  }
  return raw as OAuthCredentials;
}

export const makePiOAuthCredentialStore = Effect.gen(function* () {
  const secretStore = yield* ServerSecretStore;
  const serverSettings = yield* ServerSettingsService;
  const providers = yield* PiOAuthProviderClient;
  const inFlightAccessTokens = yield* Ref.make(
    new Map<string, Deferred.Deferred<string, PiOAuthCredentialError>>(),
  );

  const toCredentialError = (provider: string, reason: string, cause: unknown) =>
    new PiOAuthCredentialError({ provider, reason, cause });

  const updateProviderOAuth = (provider: string, config: PiProviderConfig | null) =>
    Effect.gen(function* () {
      const settings = yield* serverSettings.getSettings.pipe(
        Effect.mapError((cause) =>
          toCredentialError(provider, "failed to read server settings", cause),
        ),
      );
      const piProviders: Record<string, PiProviderConfig> = { ...settings.piProviders };
      if (config === null) {
        delete piProviders[provider];
      } else {
        piProviders[provider] = config;
      }
      yield* serverSettings
        .updateSettings({
          piProviders: piProviders as typeof settings.piProviders,
        })
        .pipe(
          Effect.mapError((cause) =>
            toCredentialError(provider, "failed to update OAuth provider settings", cause),
          ),
        );
    });

  const save: PiOAuthCredentialStoreShape["save"] = (provider, credentials) =>
    Effect.gen(function* () {
      const encoded = yield* encodeOAuthCredentialsJson(
        credentials as Record<string, unknown>,
      ).pipe(
        Effect.mapError((cause) =>
          toCredentialError(provider, "failed to encode OAuth credentials", cause),
        ),
      );
      yield* secretStore
        .set(piOAuthCredentialSecretName(provider), textEncoder.encode(encoded))
        .pipe(
          Effect.mapError((cause) =>
            toCredentialError(provider, "failed to persist OAuth credentials", cause),
          ),
        );

      const settings = yield* serverSettings.getSettings.pipe(
        Effect.mapError((cause) =>
          toCredentialError(provider, "failed to read server settings", cause),
        ),
      );
      const current = (settings.piProviders as Record<string, PiProviderConfig | undefined>)[
        provider
      ];
      const expiresAt = normalizeExpiresAt(credentials);
      yield* updateProviderOAuth(provider, {
        enabled: current?.enabled ?? false,
        ...(current?.apiKey ? { apiKey: current.apiKey } : {}),
        oauth: {
          connected: true,
          ...(expiresAt !== undefined ? { expiresAt } : {}),
        },
      });
    });

  const clear: PiOAuthCredentialStoreShape["clear"] = (provider) =>
    Effect.gen(function* () {
      yield* secretStore
        .remove(piOAuthCredentialSecretName(provider))
        .pipe(
          Effect.mapError((cause) =>
            toCredentialError(provider, "failed to remove OAuth credentials", cause),
          ),
        );

      const settings = yield* serverSettings.getSettings.pipe(
        Effect.mapError((cause) =>
          toCredentialError(provider, "failed to read server settings", cause),
        ),
      );
      const current = (settings.piProviders as Record<string, PiProviderConfig | undefined>)[
        provider
      ];
      if (!current) {
        return;
      }
      const next: PiProviderConfig = {
        enabled: current.enabled,
        ...(current.apiKey ? { apiKey: current.apiKey } : {}),
      };
      const hasRemainingConfig = next.enabled || next.apiKey !== undefined;
      yield* updateProviderOAuth(provider, hasRemainingConfig ? next : null);
    });

  const loadCredentials = (provider: string) =>
    secretStore.get(piOAuthCredentialSecretName(provider)).pipe(
      Effect.mapError((cause) =>
        toCredentialError(provider, "failed to read OAuth credentials", cause),
      ),
      Effect.flatMap((bytes) => {
        if (!bytes) {
          return Effect.fail(
            new PiOAuthCredentialError({
              provider,
              reason: "OAuth provider is not connected",
            }),
          );
        }
        return decodeOAuthCredentialsJson(textDecoder.decode(bytes)).pipe(
          Effect.map((raw) => validateOAuthCredentials(provider, raw)),
          Effect.mapError((cause) =>
            cause instanceof PiOAuthCredentialError
              ? cause
              : toCredentialError(provider, "failed to parse OAuth credentials", cause),
          ),
        );
      }),
    );

  const computeAccessToken = (provider: string) =>
    Effect.gen(function* () {
      const oauthProvider = yield* providers.getProvider(provider);
      if (!oauthProvider) {
        return yield* new PiOAuthCredentialError({
          provider,
          reason: "unknown OAuth provider",
        });
      }

      const credentials = yield* loadCredentials(provider);
      const now = yield* Clock.currentTimeMillis;
      if (now < credentials.expires) {
        return oauthProvider.getApiKey(credentials);
      }

      const refreshed = yield* Effect.tryPromise({
        try: () => oauthProvider.refreshToken(credentials),
        catch: (cause) =>
          new PiOAuthCredentialError({
            provider,
            reason: "failed to refresh OAuth access token",
            cause,
          }),
      }).pipe(Effect.tapError(() => clear(provider).pipe(Effect.ignore)));
      yield* save(provider, refreshed);
      return oauthProvider.getApiKey(refreshed);
    });

  const completeDeferred = (
    deferred: Deferred.Deferred<string, PiOAuthCredentialError>,
    exit: Exit.Exit<string, PiOAuthCredentialError>,
  ) =>
    Exit.isSuccess(exit)
      ? Deferred.succeed(deferred, exit.value)
      : Deferred.failCause(deferred, exit.cause);

  const getAccessToken: PiOAuthCredentialStoreShape["getAccessToken"] = (provider) =>
    Effect.gen(function* () {
      const deferred = yield* Deferred.make<string, PiOAuthCredentialError>();
      type InFlightState = {
        readonly deferred: Deferred.Deferred<string, PiOAuthCredentialError>;
        readonly owner: boolean;
      };
      const state = yield* Ref.modify(
        inFlightAccessTokens,
        (
          current,
        ): readonly [
          InFlightState,
          Map<string, Deferred.Deferred<string, PiOAuthCredentialError>>,
        ] => {
          const existing = current.get(provider);
          if (existing) {
            return [{ deferred: existing, owner: false }, current];
          }
          const next = new Map(current);
          next.set(provider, deferred);
          return [{ deferred, owner: true }, next];
        },
      );

      if (!state.owner) {
        return yield* Deferred.await(state.deferred);
      }

      const exit = yield* Effect.exit(computeAccessToken(provider));
      yield* completeDeferred(deferred, exit).pipe(Effect.ignore);
      yield* Ref.update(inFlightAccessTokens, (current) => {
        const next = new Map(current);
        next.delete(provider);
        return next;
      });
      if (Exit.isSuccess(exit)) {
        return exit.value;
      }
      return yield* Effect.failCause(exit.cause);
    });

  return {
    save,
    clear,
    getAccessToken,
  } satisfies PiOAuthCredentialStoreShape;
});

export const PiOAuthCredentialStoreLayer = Layer.effect(
  PiOAuthCredentialStore,
  makePiOAuthCredentialStore,
);

export const PiOAuthCredentialStoreLive = PiOAuthCredentialStoreLayer.pipe(
  Layer.provideMerge(PiOAuthProviderClientLive),
  Layer.provide(ServerSecretStoreLive),
);
