import { getOAuthProvider, type OAuthProviderInterface } from "@earendil-works/pi-ai/oauth";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export interface PiOAuthProviderClientShape {
  readonly getProvider: (provider: string) => Effect.Effect<OAuthProviderInterface | undefined>;
}

export class PiOAuthProviderClient extends Context.Service<
  PiOAuthProviderClient,
  PiOAuthProviderClientShape
>()("gedcode/orchestration/pi/PiOAuthProviders/PiOAuthProviderClient") {}

export const PiOAuthProviderClientLive = Layer.succeed(PiOAuthProviderClient, {
  getProvider: (provider) => Effect.sync(() => getOAuthProvider(provider)),
} satisfies PiOAuthProviderClientShape);
