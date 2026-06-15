import type { SessionTreeEntry } from "@earendil-works/pi-agent-core";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { makeSqliteSessionStorage } from "./SqliteSessionStorage.ts";

const layer = it.layer(Layer.fresh(SqlitePersistenceMemory));

layer("SqliteSessionStorage", (it) => {
  it.effect("round-trips pi session tree semantics", () =>
    Effect.gen(function* () {
      const storage = yield* makeSqliteSessionStorage({ sessionId: "pm-session-1" });

      const root: SessionTreeEntry = {
        type: "message",
        id: "root",
        parentId: null,
        timestamp: "2026-06-14T00:00:00.000Z",
        message: { role: "user", content: "start", timestamp: 0 },
      };
      const child: SessionTreeEntry = {
        type: "message",
        id: "child",
        parentId: "root",
        timestamp: "2026-06-14T00:00:01.000Z",
        message: { role: "user", content: "continue", timestamp: 1 },
      };

      yield* Effect.promise(() => storage.appendEntry(root));
      yield* Effect.promise(() => storage.appendEntry(child));
      yield* Effect.promise(() =>
        storage.appendEntry({
          type: "label",
          id: "label-1",
          parentId: "child",
          timestamp: "2026-06-14T00:00:02.000Z",
          targetId: "root",
          label: "Root label",
        }),
      );

      assert.strictEqual(yield* Effect.promise(() => storage.getLeafId()), "label-1");
      assert.strictEqual(yield* Effect.promise(() => storage.getLabel("root")), "Root label");

      yield* Effect.promise(() => storage.setLeafId("child"));

      assert.strictEqual(yield* Effect.promise(() => storage.getLeafId()), "child");
      const path = yield* Effect.promise(() => storage.getPathToRoot("child"));
      assert.deepStrictEqual(
        path.map((entry) => entry.id),
        ["root", "child"],
      );

      const entries = yield* Effect.promise(() => storage.getEntries());
      const leafEntries = entries.filter((entry) => entry.type === "leaf");
      assert.strictEqual(leafEntries.length, 1);
      assert.strictEqual(leafEntries[0]?.targetId, "child");
      assert.deepStrictEqual(
        entries.map((entry) => entry.id).filter((id) => id !== leafEntries[0]?.id),
        ["root", "child", "label-1"],
      );
    }),
  );

  it.effect("reopens an existing session", () =>
    Effect.gen(function* () {
      const first = yield* makeSqliteSessionStorage({ sessionId: "pm-session-2" });
      yield* Effect.promise(() =>
        first.appendEntry({
          type: "message",
          id: "entry-1",
          parentId: null,
          timestamp: "2026-06-14T00:00:00.000Z",
          message: { role: "user", content: "persist me", timestamp: 0 },
        }),
      );

      const reopened = yield* makeSqliteSessionStorage({ sessionId: "pm-session-2" });
      const metadata = yield* Effect.promise(() => reopened.getMetadata());
      const entry = yield* Effect.promise(() => reopened.getEntry("entry-1"));

      assert.strictEqual(metadata.id, "pm-session-2");
      assert.strictEqual(reopened.getLeafId.length, 0);
      assert.strictEqual(entry?.type, "message");
      assert.strictEqual(yield* Effect.promise(() => reopened.getLeafId()), "entry-1");
    }),
  );
});
