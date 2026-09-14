import { expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import { beforeEach, vi } from "vitest";

import { ServerConfig } from "../../config.ts";
import { SecretStoreError, ServerSecretStore } from "../Services/ServerSecretStore.ts";
import { ServerSecretStoreLive } from "./ServerSecretStore.ts";

// No real secret paths or entropy access. Mock at the original native boundary, not a new API.
const { randomBytes } = vi.hoisted(() => ({
  randomBytes: vi.fn((bytes: number) => Buffer.alloc(bytes, 0x5a)),
}));
vi.mock("node:crypto", () => ({ randomBytes, randomUUID: () => "test-only-uuid" }));
beforeEach(() => {
  randomBytes.mockReset();
});

const platformError = (reason: "NotFound" | "AlreadyExists" | "PermissionDenied", method: string) =>
  PlatformError.systemError({
    _tag: reason,
    module: "FileSystem",
    method,
    description: "in-memory injected failure",
  });
const missing = platformError("NotFound", "readFile");
const denied = platformError("PermissionDenied", "readFile");
const unexpected = () => Effect.die("Unexpected filesystem operation in secret test");

type Read = Uint8Array | PlatformError.PlatformError;
const memoryFileSystem = (
  options: {
    reads?: Read[];
    persisted?: Uint8Array | null;
    openError?: PlatformError.PlatformError;
    failure?: "write" | "sync" | "chmod";
    pause?: {
      opened: Deferred.Deferred<void>;
      resume: Deferred.Deferred<void>;
      partial: Uint8Array;
    };
  } = {},
) => {
  let persisted = options.persisted ?? null;
  const reads = [...(options.reads ?? [])];
  const calls = { read: 0, open: 0, write: 0, sync: 0, close: 0, chmod: [] as number[] };
  const fs = FileSystem.makeNoop({
    makeDirectory: () => Effect.void,
    chmod: (_path, mode) =>
      Effect.suspend(() => {
        calls.chmod.push(mode);
        return mode === 0o600 && options.failure === "chmod" ? Effect.fail(denied) : Effect.void;
      }),
    readFile: () =>
      Effect.suspend(() => {
        calls.read++;
        const read = reads.shift() ?? persisted ?? missing;
        return read instanceof Uint8Array
          ? Effect.succeed(Uint8Array.from(read))
          : Effect.fail(read);
      }),
    open: (_path, openOptions) =>
      Effect.gen(function* () {
        calls.open++;
        expect(openOptions).toEqual({ flag: "wx", mode: 0o600 });
        if (options.openError) return yield* Effect.fail(options.openError);
        if (persisted !== null) return yield* Effect.fail(platformError("AlreadyExists", "open"));
        persisted = new Uint8Array();
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            calls.close++;
          }),
        );
        return {
          [FileSystem.FileTypeId]: FileSystem.FileTypeId,
          fd: 1 as FileSystem.File.Descriptor,
          stat: unexpected(),
          seek: unexpected,
          read: unexpected,
          readAlloc: unexpected,
          truncate: unexpected,
          write: unexpected,
          writeAll: (value) =>
            Effect.gen(function* () {
              calls.write++;
              if (options.failure === "write") return yield* Effect.fail(denied);
              if (options.pause) {
                persisted = Uint8Array.from(options.pause.partial);
                yield* Deferred.succeed(options.pause.opened, undefined);
                yield* Deferred.await(options.pause.resume);
              }
              persisted = Uint8Array.from(value);
            }),
          sync: Effect.suspend(() => {
            calls.sync++;
            return options.failure === "sync" ? Effect.fail(denied) : Effect.void;
          }),
        } satisfies FileSystem.File;
      }),
    // Accidental overwrite/remove/rename falls through makeNoop's failing methods.
  });
  return { fs, calls, persisted: () => persisted };
};

const makeStore = (fs: FileSystem.FileSystem) =>
  Effect.service(ServerSecretStore).pipe(
    Effect.provide(
      ServerSecretStoreLive.pipe(
        Layer.provide(ServerConfig.layerTest("/in-memory", "/in-memory")),
        Layer.provide(Layer.succeed(FileSystem.FileSystem, fs)),
        Layer.provide(Path.layer),
      ),
    ),
  );

for (const length of [0, 1, 31, 33, 64]) {
  it.effect(`rejects existing ${length}-byte key without generating or overwriting`, () =>
    Effect.gen(function* () {
      const value = new Uint8Array(length).fill(0xa7);
      const memory = memoryFileSystem({ persisted: value });
      const store = yield* makeStore(memory.fs);
      const error = yield* Effect.flip(store.getOrCreateRandom("signing-key", 32));
      expect(error).toBeInstanceOf(SecretStoreError);
      expect(error.message).toBe(
        `Invalid length for secret signing-key: expected 32 bytes, received ${length}.`,
      );
      expect(memory.persisted()).toEqual(value);
      expect(randomBytes).not.toHaveBeenCalled();
      expect(memory.calls).toMatchObject({ read: 1, open: 0, write: 0 });
    }),
  );
  for (const path of ["initial-read", "AlreadyExists"] as const) {
    it.effect(`fails closed on ${length} bytes from paused writer via ${path}`, () =>
      Effect.gen(function* () {
        const opened = yield* Deferred.make<void>();
        const resume = yield* Deferred.make<void>();
        const partial = new Uint8Array(length).fill(0xa7);
        const memory = memoryFileSystem({
          reads: path === "AlreadyExists" ? [missing, missing] : [missing],
          pause: { opened, resume, partial },
        });
        const store = yield* makeStore(memory.fs);
        const winner = yield* Effect.forkChild(store.getOrCreateRandom("signing-key", 32));
        yield* Deferred.await(opened);
        const error = yield* Effect.flip(store.getOrCreateRandom("signing-key", 32));
        expect(error).toBeInstanceOf(SecretStoreError);
        expect(error.message).toContain(`received ${length}`);
        expect(memory.persisted()).toEqual(partial);
        expect(memory.calls).toMatchObject({
          read: path === "AlreadyExists" ? 3 : 2,
          open: path === "AlreadyExists" ? 2 : 1,
          write: 1,
          sync: 0,
        });
        expect(randomBytes).toHaveBeenCalledTimes(path === "AlreadyExists" ? 2 : 1);
        yield* Deferred.succeed(resume, undefined);
        const result = yield* Fiber.join(winner);
        expect(result).toEqual(new Uint8Array(32).fill(0x5a));
        expect(memory.persisted()).toEqual(result);
        // A separately initiated later read works; the failed caller did not retry/rotate anything.
        expect(yield* store.getOrCreateRandom("signing-key", 32)).toEqual(result);
        expect(memory.calls.close).toBe(1);
      }),
    );
  }
}

for (const length of [16, 32, 64]) {
  it.effect(`reuses exactly requested ${length} bytes across store instances without RNG`, () =>
    Effect.gen(function* () {
      const value = Uint8Array.from({ length }, (_, i) => i);
      const memory = memoryFileSystem({ persisted: value });
      const first = yield* makeStore(memory.fs);
      const second = yield* makeStore(memory.fs);
      expect(yield* first.getOrCreateRandom("key", length)).toEqual(value);
      expect(yield* second.getOrCreateRandom("key", length)).toEqual(value);
      expect(randomBytes).not.toHaveBeenCalled();
      expect(memory.calls.open).toBe(0);
    }),
  );
}

it.effect("returns valid concurrent winner bytes, not locally generated bytes", () =>
  Effect.gen(function* () {
    const value = Uint8Array.from({ length: 32 }, (_, i) => i);
    const memory = memoryFileSystem({ reads: [missing], persisted: value });
    const store = yield* makeStore(memory.fs);
    expect(yield* store.getOrCreateRandom("key", 32)).toEqual(value);
    expect(memory.calls).toMatchObject({ read: 2, open: 1, write: 0 });
    expect(randomBytes).toHaveBeenCalledTimes(1);
    expect(memory.persisted()).toEqual(value);
  }),
);

for (const reread of [missing, denied]) {
  it.effect(`propagates ${reread.reason._tag} on AlreadyExists reread without fallback`, () =>
    Effect.gen(function* () {
      const memory = memoryFileSystem({
        reads: [missing, reread],
        openError: platformError("AlreadyExists", "open"),
      });
      const store = yield* makeStore(memory.fs);
      const error = yield* Effect.flip(store.getOrCreateRandom("key", 32));
      expect(error).toBeInstanceOf(SecretStoreError);
      if (reread === denied) expect(error.cause).toBe(denied);
      else expect(error.message).toBe("Failed to read secret key after concurrent creation.");
      expect(memory.calls).toMatchObject({ read: 2, open: 1, write: 0 });
      expect(randomBytes).toHaveBeenCalledTimes(1);
    }),
  );
}

for (const failure of ["read", "open", "write", "sync", "chmod"] as const) {
  it.effect(`propagates ${failure} failure without retry/overwrite`, () =>
    Effect.gen(function* () {
      const memory = memoryFileSystem({
        ...(failure === "read" ? { reads: [denied] } : {}),
        ...(failure === "open" ? { openError: denied } : {}),
        ...(failure === "write" || failure === "sync" || failure === "chmod" ? { failure } : {}),
      });
      const store = yield* makeStore(memory.fs);
      const error = yield* Effect.flip(store.getOrCreateRandom("key", 32));
      expect(error).toBeInstanceOf(SecretStoreError);
      expect(error.cause).toBe(denied);
      expect(memory.calls.read).toBe(1);
      expect(memory.calls.open).toBe(failure === "read" ? 0 : 1);
      expect(memory.calls.close).toBe(["read", "open"].includes(failure) ? 0 : 1);
    }),
  );
}

it.effect("creates with exclusive open, restrictive permissions and sync", () =>
  Effect.gen(function* () {
    const memory = memoryFileSystem();
    const store = yield* makeStore(memory.fs);
    const result = yield* store.getOrCreateRandom("key", 32);
    expect(result).toEqual(new Uint8Array(32).fill(0x5a));
    expect(memory.persisted()).toEqual(result);
    expect(memory.calls).toEqual({
      read: 1,
      open: 1,
      write: 1,
      sync: 1,
      close: 1,
      chmod: [0o700, 0o600],
    });
  }),
);

it.effect("preserves entropy-source failure with no persistence fallback", () =>
  Effect.gen(function* () {
    const entropyFailure = new Error("injected entropy failure");
    randomBytes.mockImplementationOnce(() => {
      throw entropyFailure;
    });
    const memory = memoryFileSystem();
    const store = yield* makeStore(memory.fs);
    const exit = yield* Effect.exit(store.getOrCreateRandom("key", 32));
    expect(exit).toEqual(Exit.die(entropyFailure));
    expect(memory.calls.open).toBe(0);
    expect(randomBytes).toHaveBeenCalledTimes(1);
  }),
);
