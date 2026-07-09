import { ProviderInstanceId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { ProviderQuotaStatusRepository } from "../Services/ProviderQuotaStatus.ts";
import { SqlitePersistenceMemory } from "./Sqlite.ts";
import { ProviderQuotaStatusRepositoryLive } from "./ProviderQuotaStatus.ts";

const TestLayer = ProviderQuotaStatusRepositoryLive.pipe(Layer.provide(SqlitePersistenceMemory));
const layer = it.layer(Layer.fresh(TestLayer));

layer("ProviderQuotaStatusRepository", (it) => {
  it.effect("returns ok for instances with no quota row", () =>
    Effect.gen(function* () {
      const repository = yield* ProviderQuotaStatusRepository;

      const state = yield* repository.isInstanceQuotaBlocked({
        providerInstanceId: ProviderInstanceId.make("codex"),
      });

      assert.deepStrictEqual(state, {
        providerInstanceId: ProviderInstanceId.make("codex"),
        status: "ok",
        blocked: false,
        resetAt: null,
      });
    }),
  );

  it.effect("observes warning telemetry as ok because the instance is still usable", () =>
    Effect.gen(function* () {
      const repository = yield* ProviderQuotaStatusRepository;
      const providerInstanceId = ProviderInstanceId.make("claude_work");

      const change = yield* repository.observeRuntimeStatus({
        providerInstanceId,
        runtimeStatus: "warning",
        resetAt: "2026-06-21T12:00:00.000Z",
        updatedAt: "2026-06-21T10:00:00.000Z",
      });

      assert.ok(Option.isSome(change));
      assert.strictEqual(change.value.previousStatus, null);
      assert.strictEqual(change.value.nextStatus, "ok");

      const state = yield* repository.isInstanceQuotaBlocked({ providerInstanceId });
      assert.strictEqual(state.blocked, false);
      assert.strictEqual(state.status, "ok");
      assert.strictEqual(state.resetAt, null);
    }),
  );

  it.effect("observes exhausted telemetry as blocked-until when reset is known", () =>
    Effect.gen(function* () {
      const repository = yield* ProviderQuotaStatusRepository;
      const providerInstanceId = ProviderInstanceId.make("claude_work_exhausted");

      const change = yield* repository.observeRuntimeStatus({
        providerInstanceId,
        runtimeStatus: "exhausted",
        resetAt: "2026-06-21T12:00:00.000Z",
        updatedAt: "2026-06-21T10:00:00.000Z",
      });

      assert.ok(Option.isSome(change));
      assert.strictEqual(change.value.previousStatus, null);
      assert.strictEqual(change.value.nextStatus, "blocked-until");

      const state = yield* repository.isInstanceQuotaBlocked({ providerInstanceId });
      assert.strictEqual(state.blocked, true);
      assert.strictEqual(state.status, "blocked-until");
      assert.strictEqual(state.resetAt, "2026-06-21T12:00:00.000Z");
    }),
  );

  it.effect("marks classified exhaustion errors as blocked-unknown", () =>
    Effect.gen(function* () {
      const repository = yield* ProviderQuotaStatusRepository;
      const providerInstanceId = ProviderInstanceId.make("codex_pro");

      yield* repository.markBlocked({
        providerInstanceId,
        resetAt: null,
        updatedAt: "2026-06-21T10:00:00.000Z",
      });

      const state = yield* repository.isInstanceQuotaBlocked({ providerInstanceId });
      assert.strictEqual(state.blocked, true);
      assert.strictEqual(state.status, "blocked-unknown");
      assert.strictEqual(state.resetAt, null);
    }),
  );

  it.effect("clears blocked status when ok telemetry arrives", () =>
    Effect.gen(function* () {
      const repository = yield* ProviderQuotaStatusRepository;
      const providerInstanceId = ProviderInstanceId.make("claude_max");

      yield* repository.markBlocked({
        providerInstanceId,
        resetAt: "2026-06-21T12:00:00.000Z",
        updatedAt: "2026-06-21T10:00:00.000Z",
      });
      const change = yield* repository.observeRuntimeStatus({
        providerInstanceId,
        runtimeStatus: "ok",
        resetAt: null,
        updatedAt: "2026-06-21T12:01:00.000Z",
      });

      assert.ok(Option.isSome(change));
      assert.strictEqual(change.value.previousStatus, "blocked-until");
      assert.strictEqual(change.value.nextStatus, "ok");

      const state = yield* repository.isInstanceQuotaBlocked({ providerInstanceId });
      assert.strictEqual(state.blocked, false);
      assert.strictEqual(state.status, "ok");
      assert.strictEqual(state.resetAt, null);
    }),
  );
});
