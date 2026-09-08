import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import type { ServerConfigShape } from "../../config.ts";
import { ServerConfig } from "../../config.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { SessionCredentialService } from "../Services/SessionCredentialService.ts";
import { ServerSecretStoreLive } from "./ServerSecretStore.ts";
import { SessionCredentialServiceLive } from "./SessionCredentialService.ts";

const makeServerConfigLayer = (
  overrides?: Partial<Pick<ServerConfigShape, "desktopBootstrapToken">>,
) =>
  Layer.effect(
    ServerConfig,
    Effect.gen(function* () {
      const config = yield* ServerConfig;
      return {
        ...config,
        ...overrides,
      } satisfies ServerConfigShape;
    }),
  ).pipe(Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-auth-session-test-" })));

const makeSessionCredentialLayer = (
  overrides?: Partial<Pick<ServerConfigShape, "desktopBootstrapToken">>,
) =>
  SessionCredentialServiceLive.pipe(
    Layer.provide(SqlitePersistenceMemory),
    Layer.provide(ServerSecretStoreLive),
    Layer.provide(makeServerConfigLayer(overrides)),
  );

it.layer(NodeServices.layer)("SessionCredentialServiceLive", (it) => {
  it.effect("issues and verifies signed browser session tokens", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionCredentialService;
      const issued = yield* sessions.issue({
        subject: "desktop-bootstrap",
        role: "owner",
        client: {
          label: "Desktop app",
          deviceType: "desktop",
          os: "macOS",
          browser: "Electron",
          ipAddress: "127.0.0.1",
        },
      });
      const verified = yield* sessions.verify(issued.token);

      expect(verified.method).toBe("browser-session-cookie");
      expect(verified.subject).toBe("desktop-bootstrap");
      expect(verified.role).toBe("owner");
      expect(verified.client.label).toBe("Desktop app");
      expect(verified.client.browser).toBe("Electron");
      expect(verified.expiresAt?.toString()).toBe(issued.expiresAt.toString());
    }).pipe(Effect.provide(makeSessionCredentialLayer())),
  );
  it.effect("rejects malformed session tokens", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionCredentialService;
      const error = yield* Effect.flip(sessions.verify("not-a-session-token"));

      expect(error._tag).toBe("SessionCredentialError");
      expect(error.message).toContain("Malformed session token");
    }).pipe(Effect.provide(makeSessionCredentialLayer())),
  );
  it.effect("verifies session tokens against the Effect clock", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionCredentialService;
      const issued = yield* sessions.issue({
        method: "bearer-session-token",
        subject: "test-clock",
      });
      const verified = yield* sessions.verify(issued.token);

      expect(verified.method).toBe("bearer-session-token");
      expect(verified.subject).toBe("test-clock");
      expect(verified.role).toBe("client");
    }).pipe(Effect.provide(Layer.merge(makeSessionCredentialLayer(), TestClock.layer()))),
  );

  it.effect("rejects websocket tokens once the parent session has expired", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionCredentialService;
      const issued = yield* sessions.issue({
        method: "bearer-session-token",
        subject: "short-lived",
        ttl: Duration.seconds(1),
      });
      const websocket = yield* sessions.issueWebSocketToken(issued.sessionId);

      yield* TestClock.adjust(Duration.seconds(2));

      const error = yield* Effect.flip(sessions.verifyWebSocketToken(websocket.token));
      expect(error.message).toContain("expired");
    }).pipe(Effect.provide(Layer.merge(makeSessionCredentialLayer(), TestClock.layer()))),
  );

  it.effect("notifies active connection waiters when the parent session expires", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionCredentialService;
      const issued = yield* sessions.issue({
        method: "bearer-session-token",
        subject: "short-lived-connection",
        ttl: Duration.seconds(1),
      });
      const invalidation = yield* sessions
        .awaitInvalidation(issued.sessionId)
        .pipe(Effect.forkChild({ startImmediately: true }));

      yield* TestClock.adjust(Duration.millis(999));
      expect(invalidation.pollUnsafe()).toBeUndefined();

      yield* TestClock.adjust(Duration.millis(1));
      yield* Fiber.join(invalidation);
      expect(invalidation.pollUnsafe()).toBeDefined();
    }).pipe(Effect.provide(Layer.merge(makeSessionCredentialLayer(), TestClock.layer()))),
  );

  it.effect("lists active sessions, tracks connectivity, and revokes other sessions", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionCredentialService;
      const owner = yield* sessions.issue({
        subject: "desktop-bootstrap",
        role: "owner",
        client: {
          label: "Desktop app",
          deviceType: "desktop",
          os: "macOS",
          browser: "Electron",
        },
      });
      const client = yield* sessions.issue({
        subject: "one-time-token",
        role: "client",
        client: {
          label: "Julius iPhone",
          deviceType: "mobile",
          os: "iOS",
          browser: "Safari",
          ipAddress: "192.168.1.88",
        },
      });

      yield* sessions.markConnected(client.sessionId);
      const beforeRevoke = yield* sessions.listActive();
      const revokedCount = yield* sessions.revokeAllExcept(owner.sessionId);
      const afterRevoke = yield* sessions.listActive();
      const revokedClient = yield* Effect.flip(sessions.verify(client.token));

      expect(beforeRevoke).toHaveLength(2);
      expect(beforeRevoke.find((entry) => entry.sessionId === client.sessionId)?.connected).toBe(
        true,
      );
      expect(beforeRevoke.find((entry) => entry.sessionId === client.sessionId)?.client.label).toBe(
        "Julius iPhone",
      );
      expect(
        beforeRevoke.find((entry) => entry.sessionId === owner.sessionId)?.client.deviceType,
      ).toBe("desktop");
      expect(revokedCount).toBe(1);
      expect(afterRevoke).toHaveLength(1);
      expect(afterRevoke[0]?.sessionId).toBe(owner.sessionId);
      expect(revokedClient.message).toContain("revoked");
    }).pipe(Effect.provide(makeSessionCredentialLayer())),
  );

  it.effect("persists lastConnectedAt on first connect and updates it after reconnect", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionCredentialService;
      const issued = yield* sessions.issue({
        subject: "reconnect-test",
        method: "bearer-session-token",
      });

      const beforeConnect = yield* sessions.listActive();
      expect(beforeConnect[0]?.lastConnectedAt).toBeNull();

      yield* TestClock.adjust(Duration.seconds(1));
      yield* sessions.markConnected(issued.sessionId);
      const firstConnect = yield* sessions.listActive();
      const firstConnectedAt = firstConnect[0]?.lastConnectedAt;

      expect(firstConnect[0]?.connected).toBe(true);
      expect(firstConnectedAt).not.toBeNull();

      yield* TestClock.adjust(Duration.seconds(1));
      yield* sessions.markConnected(issued.sessionId);
      const stillConnected = yield* sessions.listActive();

      expect(stillConnected[0]?.lastConnectedAt?.toString()).toBe(firstConnectedAt?.toString());

      yield* sessions.markDisconnected(issued.sessionId);
      yield* sessions.markDisconnected(issued.sessionId);
      const afterDisconnect = yield* sessions.listActive();

      expect(afterDisconnect[0]?.connected).toBe(false);
      expect(afterDisconnect[0]?.lastConnectedAt?.toString()).toBe(firstConnectedAt?.toString());

      yield* TestClock.adjust(Duration.seconds(1));
      yield* sessions.markConnected(issued.sessionId);
      const afterReconnect = yield* sessions.listActive();

      expect(afterReconnect[0]?.connected).toBe(true);
      expect(afterReconnect[0]?.lastConnectedAt).not.toBeNull();
      expect(afterReconnect[0]?.lastConnectedAt?.toString()).not.toBe(firstConnectedAt?.toString());
    }).pipe(Effect.provide(Layer.merge(makeSessionCredentialLayer(), TestClock.layer()))),
  );

  it.effect("backpressures ordered session changes while auth snapshot delivery is blocked", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionCredentialService;
      const subscription = yield* sessions.subscribeChanges;
      const releaseSnapshot = yield* Deferred.make<void>();
      const changeCount = 257;

      const changesFiber = yield* Deferred.await(releaseSnapshot).pipe(
        Effect.andThen(
          Stream.fromSubscription(subscription).pipe(Stream.take(changeCount), Stream.runCollect),
        ),
        Effect.forkScoped({ startImmediately: true }),
      );
      const producerFiber = yield* Effect.forEach(
        Array.from({ length: changeCount }, (_, index) => index),
        (index) =>
          sessions.issue({
            subject: `snapshot-blocked-${index}`,
            client: {
              label: `Client ${index}`,
              deviceType: "unknown",
            },
          }),
        { discard: true },
      ).pipe(Effect.forkScoped({ startImmediately: true }));

      while ((yield* sessions.listActive()).length < changeCount) {
        yield* Effect.yieldNow;
      }
      yield* Effect.yieldNow;

      expect(producerFiber.pollUnsafe()).toBeUndefined();

      yield* Deferred.succeed(releaseSnapshot, undefined);
      yield* Fiber.join(producerFiber);
      const changes = Array.from(yield* Fiber.join(changesFiber));

      expect(changes).toHaveLength(changeCount);
      expect(
        changes.map((change) =>
          change.type === "clientUpserted" ? change.clientSession.client.label : null,
        ),
      ).toEqual(Array.from({ length: changeCount }, (_, index) => `Client ${index}`));
    }).pipe(Effect.provide(makeSessionCredentialLayer())),
  );
});
