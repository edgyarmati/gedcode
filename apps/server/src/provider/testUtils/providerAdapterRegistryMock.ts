/**
 * Test helpers for constructing a `ProviderAdapterRegistryShape` mock from a
 * kind-keyed adapter map.
 *
 * Tests historically assembled a `registry` object with only `getByProvider`
 * + `listProviders` populated. Slice D grew the shape with `getByInstance`
 * and `listInstances`; this helper fills both in from a single kind-keyed
 * input so individual fixtures can stay concise.
 *
 * Non-default instance ids (e.g. `codex_personal`) can be supplied as aliases
 * for tests that need to exercise instance routing without booting separate
 * provider adapters.
 *
 * @module provider/testUtils/providerAdapterRegistryMock
 */
import {
  defaultInstanceIdForDriver,
  ProviderDriverKind,
  type ProviderInstanceId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";
import * as Record from "effect/Record";
import * as Result from "effect/Result";
import * as Stream from "effect/Stream";

import { ProviderUnsupportedError, type ProviderAdapterError } from "../Errors.ts";
import type { ProviderAdapterShape } from "../Services/ProviderAdapter.ts";
import type { ProviderAdapterRegistryShape } from "../Services/ProviderAdapterRegistry.ts";

export type KindAdapterMap = Partial<
  Record<ProviderDriverKind, ProviderAdapterShape<ProviderAdapterError>>
>;

export interface AdapterRegistryMockInstanceAlias {
  readonly instanceId: ProviderInstanceId;
  readonly driverKind: ProviderDriverKind;
}

export interface AdapterRegistryMockOptions {
  readonly additionalInstances?: ReadonlyArray<AdapterRegistryMockInstanceAlias>;
}

const sessionBelongsToInstance =
  (instanceId: ProviderInstanceId) =>
  (session: {
    readonly provider: ProviderDriverKind;
    readonly providerInstanceId?: ProviderInstanceId | undefined;
  }) =>
    (session.providerInstanceId ?? defaultInstanceIdForDriver(session.provider)) === instanceId;

const eventBelongsToInstance =
  (instanceId: ProviderInstanceId) =>
  (event: {
    readonly provider: ProviderDriverKind;
    readonly providerInstanceId?: ProviderInstanceId | undefined;
  }) =>
    (event.providerInstanceId ?? defaultInstanceIdForDriver(event.provider)) === instanceId;

/**
 * Build a `ProviderAdapterRegistryShape` from a kind-keyed adapter map.
 * Every adapter present in the map is addressable via both the legacy
 * `getByProvider(kind)` path and the new `getByInstance(id)` path (where
 * `id = defaultInstanceIdForDriver(kind)`).
 */
export const makeAdapterRegistryMock = (
  adapters: KindAdapterMap,
  options?: AdapterRegistryMockOptions,
): ProviderAdapterRegistryShape => {
  const byInstanceId = new Map<ProviderInstanceId, ProviderAdapterShape<ProviderAdapterError>>();
  const bindAdapterToInstance = (
    instanceId: ProviderInstanceId,
    adapter: ProviderAdapterShape<ProviderAdapterError>,
  ): ProviderAdapterShape<ProviderAdapterError> => ({
    ...adapter,
    streamEvents: adapter.streamEvents.pipe(Stream.filter(eventBelongsToInstance(instanceId))),
    listSessions: () =>
      adapter
        .listSessions()
        .pipe(Effect.map((sessions) => sessions.filter(sessionBelongsToInstance(instanceId)))),
    hasSession: (threadId) =>
      adapter
        .listSessions()
        .pipe(
          Effect.map((sessions) =>
            sessions.some(
              (session) =>
                session.threadId === threadId && sessionBelongsToInstance(instanceId)(session),
            ),
          ),
        ),
  });

  for (const [kind, adapter] of Object.entries(adapters)) {
    if (!adapter) continue;
    const driverKind = ProviderDriverKind.make(kind);
    const instanceId = defaultInstanceIdForDriver(driverKind);
    byInstanceId.set(instanceId, bindAdapterToInstance(instanceId, adapter));
  }
  for (const alias of options?.additionalInstances ?? []) {
    const adapter = adapters[alias.driverKind];
    if (adapter) {
      byInstanceId.set(alias.instanceId, bindAdapterToInstance(alias.instanceId, adapter));
    }
  }

  const getByInstance: ProviderAdapterRegistryShape["getByInstance"] = (instanceId) => {
    const adapter = byInstanceId.get(instanceId);
    return adapter
      ? Effect.succeed(adapter)
      : Effect.fail(
          new ProviderUnsupportedError({
            provider: ProviderDriverKind.make(instanceId),
          }),
        );
  };

  return {
    getByInstance,
    getInstanceInfo: (instanceId) => {
      const adapter = byInstanceId.get(instanceId);
      if (!adapter) {
        return Effect.fail(
          new ProviderUnsupportedError({
            provider: ProviderDriverKind.make(instanceId),
          }),
        );
      }
      return Effect.succeed({
        instanceId,
        driverKind: ProviderDriverKind.make(adapter.provider),
        displayName: undefined,
        enabled: true,
        continuationIdentity: {
          driverKind: ProviderDriverKind.make(adapter.provider),
          continuationKey: `${adapter.provider}:instance:${instanceId}`,
        },
      });
    },
    listInstances: () => Effect.succeed(Array.from(byInstanceId.keys())),
    listProviders: () =>
      Effect.succeed(
        Record.keys(
          Record.filterMap(adapters, (adapter, kind) =>
            adapter !== undefined ? Result.succeed(kind) : Result.failVoid,
          ),
        ),
      ),
    // Static test fixtures don't reload; an empty stream is enough to
    // satisfy the shape. Tests exercising hot-reload build their own
    // stream via the real `ProviderInstanceRegistry`.
    streamChanges: Stream.empty,
    subscribeChanges: Effect.flatMap(PubSub.unbounded<void>(), (pubsub) =>
      PubSub.subscribe(pubsub),
    ),
  };
};
