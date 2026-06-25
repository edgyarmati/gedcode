import * as NodeServices from "@effect/platform-node/NodeServices";
import { PiProviderId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import type { OAuthCredentials, OAuthProviderInterface } from "@earendil-works/pi-ai/oauth";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";

import { ServerSecretStoreLive } from "../../auth/Layers/ServerSecretStore.ts";
import { ServerSecretStore } from "../../auth/Services/ServerSecretStore.ts";
import { ServerConfig } from "../../config.ts";
import {
  redactServerSettingsForClient,
  ServerSettingsLive,
  ServerSettingsService,
} from "../../serverSettings.ts";
import {
  PiOAuthCredentialError,
  PiOAuthCredentialStore,
  PiOAuthCredentialStoreLayer,
  piOAuthCredentialSecretName,
} from "./PiOAuthCredentialStore.ts";
import { PiOAuthProviderClient, type PiOAuthProviderClientShape } from "./PiOAuthProviders.ts";

const FUTURE_EXPIRES = 4_102_444_800_000;
const EXPIRED = 0;

function makeProviderLayer(provider: OAuthProviderInterface) {
  return Layer.succeed(PiOAuthProviderClient, {
    getProvider: (providerId) => Effect.succeed(providerId === provider.id ? provider : undefined),
  } satisfies PiOAuthProviderClientShape);
}

function makeTestLayer(provider: OAuthProviderInterface, prefix: string) {
  const dependencies = Layer.mergeAll(
    ServerSecretStoreLive,
    ServerSettingsLive,
    makeProviderLayer(provider),
  ).pipe(
    Layer.provide(
      Layer.fresh(
        ServerConfig.layerTest(process.cwd(), {
          prefix,
        }),
      ),
    ),
  );
  return PiOAuthCredentialStoreLayer.pipe(Layer.provideMerge(dependencies));
}

function makeProvider(input?: {
  readonly refreshToken?: (credentials: OAuthCredentials) => Promise<OAuthCredentials>;
}): OAuthProviderInterface {
  return {
    id: "anthropic",
    name: "Anthropic",
    login: async () => {
      throw new Error("not used");
    },
    refreshToken:
      input?.refreshToken ??
      (async (credentials) => ({
        ...credentials,
        access: "fresh-access",
        expires: FUTURE_EXPIRES,
      })),
    getApiKey: (credentials) => credentials.access,
  };
}

it.layer(NodeServices.layer)("pi oauth credential store", (it) => {
  it.effect("returns a stored access token when credentials are fresh", () =>
    Effect.gen(function* () {
      const store = yield* PiOAuthCredentialStore;
      const credentials: OAuthCredentials = {
        refresh: "refresh-token",
        access: "stored-access",
        expires: FUTURE_EXPIRES,
      };

      yield* store.save("anthropic", credentials);

      assert.equal(yield* store.getAccessToken("anthropic"), "stored-access");
    }).pipe(Effect.provide(makeTestLayer(makeProvider(), "pi-oauth-store-fresh-"))),
  );

  it.effect(
    "persists credentials in the secret store and only exposes connection status in settings",
    () =>
      Effect.gen(function* () {
        const store = yield* PiOAuthCredentialStore;
        const secretStore = yield* ServerSecretStore;
        const serverSettings = yield* ServerSettingsService;
        const credentials: OAuthCredentials = {
          refresh: "refresh-token",
          access: "stored-access",
          expires: 123_456,
        };

        yield* store.save("anthropic", credentials);

        const secret = yield* secretStore.get(piOAuthCredentialSecretName("anthropic"));
        assert.isNotNull(secret);
        assert.include(new TextDecoder().decode(secret!), "stored-access");

        const settings = yield* serverSettings.getSettings;
        assert.deepEqual(settings.piProviders[PiProviderId.make("anthropic")]?.oauth, {
          connected: true,
          expiresAt: 123_456,
        });
        const redacted = redactServerSettingsForClient(settings);
        assert.deepEqual(redacted.piProviders[PiProviderId.make("anthropic")]?.oauth, {
          connected: true,
          expiresAt: 123_456,
        });
      }).pipe(Effect.provide(makeTestLayer(makeProvider(), "pi-oauth-store-secret-"))),
  );

  it.effect("refreshes and persists expired credentials", () => {
    const refreshed: OAuthCredentials = {
      refresh: "new-refresh",
      access: "new-access",
      expires: FUTURE_EXPIRES,
    };

    return Effect.gen(function* () {
      const store = yield* PiOAuthCredentialStore;
      const secretStore = yield* ServerSecretStore;

      yield* store.save("anthropic", {
        refresh: "old-refresh",
        access: "old-access",
        expires: EXPIRED,
      });

      const token = yield* store.getAccessToken("anthropic");

      assert.equal(token, "new-access");
      const secret = yield* secretStore.get(piOAuthCredentialSecretName("anthropic"));
      assert.include(new TextDecoder().decode(secret!), "new-refresh");
    }).pipe(
      Effect.provide(
        makeTestLayer(
          makeProvider({
            refreshToken: async () => refreshed,
          }),
          "pi-oauth-store-refresh-",
        ),
      ),
    );
  });

  it.effect("single-flights concurrent refreshes for a provider", () => {
    let refreshCount = 0;
    let resolveStarted: () => void = () => {};
    let resolveRelease: () => void = () => {};
    const refreshStarted = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });
    const releaseRefresh = new Promise<void>((resolve) => {
      resolveRelease = resolve;
    });

    return Effect.gen(function* () {
      const store = yield* PiOAuthCredentialStore;

      yield* store.save("anthropic", {
        refresh: "old-refresh",
        access: "old-access",
        expires: EXPIRED,
      });

      const program = Effect.all(
        [store.getAccessToken("anthropic"), store.getAccessToken("anthropic")],
        { concurrency: "unbounded" },
      );
      const fiber = yield* Effect.forkChild(program);
      yield* Effect.callback<void>((resume) => {
        refreshStarted.then(() => resume(Effect.void));
      });
      resolveRelease();
      const tokens = yield* Fiber.join(fiber);

      assert.deepEqual(tokens, ["single-flight-access", "single-flight-access"]);
      assert.equal(refreshCount, 1);
    }).pipe(
      Effect.provide(
        makeTestLayer(
          makeProvider({
            refreshToken: async (credentials) => {
              refreshCount += 1;
              resolveStarted();
              await releaseRefresh;
              return {
                ...credentials,
                access: "single-flight-access",
                expires: FUTURE_EXPIRES,
              };
            },
          }),
          "pi-oauth-store-single-flight-",
        ),
      ),
    );
  });

  it.effect("clears connection status when refresh fails", () =>
    Effect.gen(function* () {
      const store = yield* PiOAuthCredentialStore;
      const serverSettings = yield* ServerSettingsService;

      yield* store.save("anthropic", {
        refresh: "old-refresh",
        access: "old-access",
        expires: EXPIRED,
      });

      const error = yield* store.getAccessToken("anthropic").pipe(Effect.flip);
      const settings = yield* serverSettings.getSettings;

      assert.instanceOf(error, PiOAuthCredentialError);
      assert.equal(settings.piProviders[PiProviderId.make("anthropic")]?.oauth, undefined);
    }).pipe(
      Effect.provide(
        makeTestLayer(
          makeProvider({
            refreshToken: async () => {
              throw new Error("refresh revoked");
            },
          }),
          "pi-oauth-store-refresh-failure-",
        ),
      ),
    ),
  );
});
