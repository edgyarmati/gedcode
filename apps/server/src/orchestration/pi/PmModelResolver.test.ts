import { DEFAULT_SERVER_SETTINGS, PiProviderId, type ServerSettings } from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import type { PiOAuthCredentialStoreShape } from "./PiOAuthCredentialStore.ts";
import {
  PiCredentialResolutionError,
  resolvePiCredential,
  resolvePiProvider,
} from "./PmModelResolver.ts";

const oauthStore = (token: string): PiOAuthCredentialStoreShape => ({
  save: () => Effect.void,
  clear: () => Effect.void,
  getAccessToken: () => Effect.succeed(token),
});

const settingsWithPiProviders = (piProviders: ServerSettings["piProviders"]): ServerSettings => ({
  ...DEFAULT_SERVER_SETTINGS,
  piProviders,
});

const withEnv = <A, E, R>(
  updates: Readonly<Record<string, string | undefined>>,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = new Map<string, string | undefined>();
      for (const [key, value] of Object.entries(updates)) {
        previous.set(key, process.env[key]);
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
      return previous;
    }),
    () => effect,
    (previous) =>
      Effect.sync(() => {
        for (const [key, value] of previous) {
          if (value === undefined) {
            delete process.env[key];
          } else {
            process.env[key] = value;
          }
        }
      }),
  );

describe("PmModelResolver", () => {
  it("uses the pi provider id directly", () => {
    assert.strictEqual(resolvePiProvider("openai"), "openai");
    assert.strictEqual(resolvePiProvider("claudeAgent"), "claudeAgent");
  });

  it.effect("resolves apiKey credentials from pi provider settings before env", () =>
    withEnv(
      { OPENAI_API_KEY: "env-openai-key" },
      Effect.gen(function* () {
        const credential = yield* resolvePiCredential({
          provider: "openai",
          settings: settingsWithPiProviders({
            [PiProviderId.make("openai")]: {
              enabled: true,
              apiKey: { value: "configured-openai-key" },
            },
          }),
          oauthStore: oauthStore("unused"),
        });

        assert.deepStrictEqual(credential, { apiKey: "configured-openai-key" });
      }),
    ),
  );

  it.effect("resolves oauth credentials through the OAuth credential store", () =>
    Effect.gen(function* () {
      const credential = yield* resolvePiCredential({
        provider: "anthropic",
        settings: settingsWithPiProviders({
          [PiProviderId.make("anthropic")]: {
            enabled: true,
            oauth: { connected: true },
          },
        }),
        oauthStore: oauthStore("oauth-access-token"),
      });

      assert.deepStrictEqual(credential, { apiKey: "oauth-access-token" });
    }),
  );

  it.effect("allows ambient providers without a configured credential", () =>
    Effect.gen(function* () {
      const credential = yield* resolvePiCredential({
        provider: "amazon-bedrock",
        settings: settingsWithPiProviders({
          [PiProviderId.make("amazon-bedrock")]: { enabled: true },
        }),
        oauthStore: oauthStore("unused"),
      });

      assert.deepStrictEqual(credential, {});
    }),
  );

  it.effect("falls back to env when no pi provider credential is configured", () =>
    withEnv(
      { OPENAI_API_KEY: "env-openai-key" },
      Effect.gen(function* () {
        const credential = yield* resolvePiCredential({
          provider: "openai",
          settings: settingsWithPiProviders({
            [PiProviderId.make("openai")]: { enabled: true },
          }),
          oauthStore: oauthStore("unused"),
        });

        assert.deepStrictEqual(credential, { apiKey: "env-openai-key" });
      }),
    ),
  );

  it.effect("fails with a typed error when no credential can be resolved", () =>
    withEnv(
      { OPENAI_API_KEY: undefined },
      Effect.gen(function* () {
        const error = yield* resolvePiCredential({
          provider: "openai",
          settings: settingsWithPiProviders({
            [PiProviderId.make("openai")]: { enabled: true },
          }),
          oauthStore: oauthStore("unused"),
        }).pipe(Effect.flip);

        assert.instanceOf(error, PiCredentialResolutionError);
        assert.strictEqual(error.provider, "openai");
      }),
    ),
  );
});
