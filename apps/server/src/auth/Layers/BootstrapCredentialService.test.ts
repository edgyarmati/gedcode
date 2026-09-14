import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
// @effect-diagnostics-next-line nodeBuiltinImport:off
import { createHash } from "node:crypto";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import type { ServerConfigShape } from "../../config.ts";
import { ServerConfig } from "../../config.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { BootstrapCredentialService } from "../Services/BootstrapCredentialService.ts";
import { BootstrapCredentialServiceLive } from "./BootstrapCredentialService.ts";

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
  ).pipe(
    Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-auth-bootstrap-test-" })),
  );

const makeBootstrapCredentialLayer = (
  overrides?: Partial<Pick<ServerConfigShape, "desktopBootstrapToken">>,
) =>
  BootstrapCredentialServiceLive.pipe(
    Layer.provide(SqlitePersistenceMemory),
    Layer.provide(makeServerConfigLayer(overrides)),
  );

it.layer(NodeServices.layer)("BootstrapCredentialServiceLive", (it) => {
  it.effect("issues pairing tokens in a short manual-entry format", () =>
    Effect.gen(function* () {
      const bootstrapCredentials = yield* BootstrapCredentialService;
      const issued = yield* bootstrapCredentials.issueOneTimeToken();

      expect(issued.credential).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{12}$/);
    }).pipe(Effect.provide(makeBootstrapCredentialLayer())),
  );

  it.effect("issues one-time bootstrap tokens that can only be consumed once", () =>
    Effect.gen(function* () {
      const bootstrapCredentials = yield* BootstrapCredentialService;
      const issued = yield* bootstrapCredentials.issueOneTimeToken({ label: "Julius iPhone" });
      const first = yield* bootstrapCredentials.consume(issued.credential);
      const second = yield* Effect.flip(bootstrapCredentials.consume(issued.credential));

      expect(first.method).toBe("one-time-token");
      expect(first.role).toBe("client");
      expect(first.subject).toBe("one-time-token");
      expect(first.label).toBe("Julius iPhone");
      expect(issued.label).toBe("Julius iPhone");
      expect(second._tag).toBe("BootstrapCredentialError");
      expect(second.message).toContain("Unknown bootstrap credential");
    }).pipe(Effect.provide(makeBootstrapCredentialLayer())),
  );

  it.effect("atomically consumes a one-time token when multiple requests race", () =>
    Effect.gen(function* () {
      const bootstrapCredentials = yield* BootstrapCredentialService;
      const token = yield* bootstrapCredentials.issueOneTimeToken();
      const results = yield* Effect.all(
        Array.from({ length: 8 }, () =>
          Effect.result(bootstrapCredentials.consume(token.credential)),
        ),
        {
          concurrency: "unbounded",
        },
      );

      const successes = results.filter((result) => result._tag === "Success");
      const failures = results.filter((result) => result._tag === "Failure");

      expect(successes).toHaveLength(1);
      expect(failures).toHaveLength(7);
      for (const failure of failures) {
        expect(failure.failure._tag).toBe("BootstrapCredentialError");
        expect(failure.failure.message).toContain("Unknown bootstrap credential");
      }
    }).pipe(Effect.provide(makeBootstrapCredentialLayer())),
  );

  it.effect("seeds the desktop bootstrap credential as a one-time grant", () =>
    Effect.gen(function* () {
      const bootstrapCredentials = yield* BootstrapCredentialService;
      const first = yield* bootstrapCredentials.consume("desktop-bootstrap-token");
      const second = yield* Effect.flip(bootstrapCredentials.consume("desktop-bootstrap-token"));

      expect(first.method).toBe("desktop-bootstrap");
      expect(first.role).toBe("owner");
      expect(first.subject).toBe("desktop-bootstrap");
      expect(second._tag).toBe("BootstrapCredentialError");
      expect(second.status).toBe(401);
    }).pipe(
      Effect.provide(
        makeBootstrapCredentialLayer({
          desktopBootstrapToken: "desktop-bootstrap-token",
        }),
      ),
    ),
  );

  it.effect("reports seeded desktop bootstrap credentials as expired after their ttl", () =>
    Effect.gen(function* () {
      const bootstrapCredentials = yield* BootstrapCredentialService;

      yield* TestClock.adjust(Duration.minutes(6));
      const expired = yield* Effect.flip(bootstrapCredentials.consume("desktop-bootstrap-token"));

      expect(expired._tag).toBe("BootstrapCredentialError");
      expect(expired.status).toBe(401);
      expect(expired.message).toContain("Bootstrap credential expired");
    }).pipe(
      Effect.provide(
        Layer.merge(
          makeBootstrapCredentialLayer({
            desktopBootstrapToken: "desktop-bootstrap-token",
          }),
          TestClock.layer(),
        ),
      ),
    ),
  );

  it.effect("lists and revokes active pairing links", () =>
    Effect.gen(function* () {
      const bootstrapCredentials = yield* BootstrapCredentialService;
      const first = yield* bootstrapCredentials.issueOneTimeToken();
      const second = yield* bootstrapCredentials.issueOneTimeToken({ role: "owner" });

      const activeBeforeRevoke = yield* bootstrapCredentials.listActive();
      expect(activeBeforeRevoke.map((entry) => entry.id)).toContain(first.id);
      expect(activeBeforeRevoke.map((entry) => entry.id)).toContain(second.id);
      expect("credential" in (activeBeforeRevoke[0] ?? {})).toBe(false);
      expect("credentialDigest" in (activeBeforeRevoke[0] ?? {})).toBe(false);

      const revoked = yield* bootstrapCredentials.revoke(first.id);
      const activeAfterRevoke = yield* bootstrapCredentials.listActive();
      const revokedConsume = yield* Effect.flip(bootstrapCredentials.consume(first.credential));

      expect(revoked).toBe(true);
      expect(activeAfterRevoke.map((entry) => entry.id)).not.toContain(first.id);
      expect(activeAfterRevoke.map((entry) => entry.id)).toContain(second.id);
      expect(revokedConsume.message).toContain("no longer available");
      expect(revokedConsume.status).toBe(401);
    }).pipe(Effect.provide(makeBootstrapCredentialLayer())),
  );

  it.effect("streams pairing link metadata without the issued credential", () =>
    Effect.gen(function* () {
      const bootstrapCredentials = yield* BootstrapCredentialService;
      const firstChange = yield* bootstrapCredentials.streamChanges.pipe(
        Stream.runHead,
        Effect.forkChild({ startImmediately: true }),
      );

      const issued = yield* bootstrapCredentials.issueOneTimeToken({ label: "Travel phone" });
      const change = yield* Fiber.join(firstChange);

      expect(change._tag).toBe("Some");
      if (change._tag === "Some" && change.value.type === "pairingLinkUpserted") {
        expect(change.value.pairingLink.id).toBe(issued.id);
        expect("credential" in change.value.pairingLink).toBe(false);
        expect("credentialDigest" in change.value.pairingLink).toBe(false);
      }
    }).pipe(Effect.provide(makeBootstrapCredentialLayer())),
  );

  it.effect("backpressures ordered pairing changes while auth snapshot delivery is blocked", () =>
    Effect.gen(function* () {
      const bootstrapCredentials = yield* BootstrapCredentialService;
      const subscription = yield* bootstrapCredentials.subscribeChanges;
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
          bootstrapCredentials.issueOneTimeToken({
            label: `Pairing client ${index}`,
          }),
        { discard: true },
      ).pipe(Effect.forkScoped({ startImmediately: true }));

      while ((yield* bootstrapCredentials.listActive()).length < changeCount) {
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
          change.type === "pairingLinkUpserted" ? change.pairingLink.label : null,
        ),
      ).toEqual(Array.from({ length: changeCount }, (_, index) => `Pairing client ${index}`));
    }).pipe(Effect.provide(makeBootstrapCredentialLayer())),
  );

  it.effect("stores issued pairing credentials only as SHA-256 digests", () =>
    Effect.gen(function* () {
      const bootstrapCredentials = yield* BootstrapCredentialService;
      const sql = yield* SqlClient.SqlClient;
      const issued = yield* bootstrapCredentials.issueOneTimeToken();

      const columns = yield* sql<{ readonly name: string }>`PRAGMA table_info(auth_pairing_links)`;
      const rows = yield* sql<{ readonly credentialDigest: string }>`
        SELECT credential_digest AS "credentialDigest"
        FROM auth_pairing_links
        WHERE id = ${issued.id}
      `;

      expect(columns.map((column) => column.name)).not.toContain("credential");
      expect(rows).toEqual([
        {
          credentialDigest: createHash("sha256").update(issued.credential, "utf8").digest("hex"),
        },
      ]);
    }).pipe(Effect.provide(Layer.merge(makeBootstrapCredentialLayer(), SqlitePersistenceMemory))),
  );
});
