import * as NodeServices from "@effect/platform-node/NodeServices";
import { PiOAuthLoginError, PiProviderId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import type { OAuthCredentials, OAuthProviderInterface } from "@earendil-works/pi-ai/oauth";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";

import { ServerSecretStoreLive } from "../../auth/Layers/ServerSecretStore.ts";
import { ServerConfig } from "../../config.ts";
import {
  redactServerSettingsForClient,
  ServerSettingsLive,
  ServerSettingsService,
} from "../../serverSettings.ts";
import { PiOAuthCredentialStoreLayer } from "./PiOAuthCredentialStore.ts";
import { PiOAuthLoginBroker, PiOAuthLoginBrokerLayer } from "./PiOAuthLoginBroker.ts";
import { PiOAuthProviderClient, type PiOAuthProviderClientShape } from "./PiOAuthProviders.ts";

function makeProviderLayer(provider: OAuthProviderInterface | null) {
  return Layer.succeed(PiOAuthProviderClient, {
    getProvider: (providerId) =>
      Effect.succeed(provider && providerId === provider.id ? provider : undefined),
  } satisfies PiOAuthProviderClientShape);
}

function makeTestLayer(
  provider: OAuthProviderInterface | null,
  prefix: string,
  options?: { readonly loginTimeoutMs?: number },
) {
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
  const credentialStore = PiOAuthCredentialStoreLayer.pipe(Layer.provideMerge(dependencies));
  return PiOAuthLoginBrokerLayer(options).pipe(Layer.provideMerge(credentialStore));
}

function credentials(access: string): OAuthCredentials {
  return {
    refresh: `${access}-refresh`,
    access,
    expires: 987_654,
  };
}

it.layer(NodeServices.layer)("pi oauth login broker", (it) => {
  it.effect("starts without waiting for pasted code and complete persists credentials", () =>
    Effect.gen(function* () {
      const broker = yield* PiOAuthLoginBroker;
      const serverSettings = yield* ServerSettingsService;

      const started = yield* broker.start(PiProviderId.make("anthropic"));
      assert.deepInclude(started, {
        provider: PiProviderId.make("anthropic"),
        authUrl: "https://auth.example/anthropic",
        instructions: "Paste the redirect URL.",
      });

      const status = yield* broker.complete({
        sessionId: started.sessionId,
        code: "pasted-code",
      });

      assert.deepEqual(status, {
        connected: true,
        provider: PiProviderId.make("anthropic"),
        expiresAt: 987_654,
      });
      const settings = yield* serverSettings.getSettings;
      assert.deepEqual(settings.piProviders[PiProviderId.make("anthropic")]?.oauth, {
        connected: true,
        expiresAt: 987_654,
      });
      const redacted = redactServerSettingsForClient(settings);
      assert.deepEqual(redacted.piProviders[PiProviderId.make("anthropic")]?.oauth, {
        connected: true,
        expiresAt: 987_654,
      });
    }).pipe(
      Effect.provide(
        makeTestLayer(
          {
            id: "anthropic",
            name: "Anthropic",
            login: async (callbacks) => {
              callbacks.onAuth({
                url: "https://auth.example/anthropic",
                instructions: "Paste the redirect URL.",
              });
              const code = await callbacks.onManualCodeInput!();
              return credentials(`access-from-${code}`);
            },
            refreshToken: async (existing) => existing,
            getApiKey: (existing) => existing.access,
          },
          "pi-oauth-broker-complete-",
        ),
      ),
    ),
  );

  it.effect("surfaces device code details from the provider", () =>
    Effect.gen(function* () {
      const broker = yield* PiOAuthLoginBroker;

      const started = yield* broker.start(PiProviderId.make("github-copilot"));
      assert.deepEqual(started.deviceCode, {
        userCode: "ABCD-1234",
        verificationUri: "https://github.com/login/device",
        intervalSeconds: 5,
        expiresInSeconds: 900,
      });

      const status = yield* broker.complete({
        sessionId: started.sessionId,
        code: "",
      });
      assert.equal(status.connected, true);
    }).pipe(
      Effect.provide(
        makeTestLayer(
          {
            id: "github-copilot",
            name: "GitHub Copilot",
            login: async (callbacks) => {
              const domain = await callbacks.onPrompt({
                message: "GitHub Enterprise URL/domain (blank for github.com)",
                allowEmpty: true,
              });
              assert.equal(domain, "");
              callbacks.onDeviceCode({
                userCode: "ABCD-1234",
                verificationUri: "https://github.com/login/device",
                intervalSeconds: 5,
                expiresInSeconds: 900,
              });
              return credentials("copilot-access");
            },
            refreshToken: async (existing) => existing,
            getApiKey: (existing) => existing.access,
          },
          "pi-oauth-broker-device-",
        ),
      ),
    ),
  );

  it.effect("cancel interrupts and removes a pending session", () =>
    Effect.gen(function* () {
      const broker = yield* PiOAuthLoginBroker;

      const started = yield* broker.start(PiProviderId.make("anthropic"));
      const cancelled = yield* broker.cancel(started.sessionId);
      const completeError = yield* broker
        .complete({ sessionId: started.sessionId, code: "late-code" })
        .pipe(Effect.flip);

      assert.deepEqual(cancelled, {
        sessionId: started.sessionId,
        cancelled: true,
      });
      assert.instanceOf(completeError, PiOAuthLoginError);
      assert.include(completeError.reason, "not found");
    }).pipe(
      Effect.provide(
        makeTestLayer(
          {
            id: "anthropic",
            name: "Anthropic",
            login: async (callbacks) => {
              callbacks.onAuth({ url: "https://auth.example/anthropic" });
              await callbacks.onManualCodeInput!();
              return credentials("never");
            },
            refreshToken: async (existing) => existing,
            getApiKey: (existing) => existing.access,
          },
          "pi-oauth-broker-cancel-",
        ),
      ),
    ),
  );

  it.effect("timeout interrupts and removes a pending session", () =>
    Effect.gen(function* () {
      const broker = yield* PiOAuthLoginBroker;

      const started = yield* broker.start(PiProviderId.make("anthropic"));
      yield* TestClock.adjust(50);
      const completeError = yield* broker
        .complete({ sessionId: started.sessionId, code: "late-code" })
        .pipe(Effect.flip);

      assert.instanceOf(completeError, PiOAuthLoginError);
      assert.include(completeError.reason, "not found");
    }).pipe(
      Effect.provide(
        makeTestLayer(
          {
            id: "anthropic",
            name: "Anthropic",
            login: async (callbacks) => {
              callbacks.onAuth({ url: "https://auth.example/anthropic" });
              await callbacks.onManualCodeInput!();
              return credentials("never");
            },
            refreshToken: async (existing) => existing,
            getApiKey: (existing) => existing.access,
          },
          "pi-oauth-broker-timeout-",
          { loginTimeoutMs: 10 },
        ),
      ),
    ),
  );

  it.effect("rejects unknown or non-oauth providers", () =>
    Effect.gen(function* () {
      const broker = yield* PiOAuthLoginBroker;

      const error = yield* broker.start(PiProviderId.make("openrouter")).pipe(Effect.flip);

      assert.instanceOf(error, PiOAuthLoginError);
      assert.include(error.reason, "not an OAuth provider");
    }).pipe(Effect.provide(makeTestLayer(null, "pi-oauth-broker-unknown-"))),
  );
});
