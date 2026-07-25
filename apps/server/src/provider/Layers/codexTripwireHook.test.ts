import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import * as CodexErrors from "effect-codex-app-server/errors";
import type * as EffectCodexSchema from "effect-codex-app-server/schema";

import {
  buildCodexAppServerArgs,
  buildTripwireHookCommand,
  buildTripwireHookDefinitionOverride,
  buildTripwireHookTrustOverride,
  findTripwireHookTrust,
  resolveTripwireHookOverrides,
} from "./codexTripwireHook.ts";

// `hooks/list` reports every hook visible to the session; these fixtures mirror a
// real response, with only the fields the lookup reads varied per case.
const hookMetadata = (input: {
  readonly key: string;
  readonly currentHash: string;
  readonly eventName: "preToolUse" | "postToolUse";
  readonly source: "sessionFlags" | "user";
}) => ({
  command: 'ELECTRON_RUN_AS_NODE=1 "/opt/node" "/srv/tripwire.mjs"',
  currentHash: input.currentHash,
  displayOrder: 0,
  enabled: true,
  eventName: input.eventName,
  handlerType: "command" as const,
  isManaged: false,
  key: input.key,
  matcher: "*",
  pluginId: null,
  source: input.source,
  sourcePath: "/<session-flags>/config.toml",
  statusMessage: null,
  timeoutSec: 600,
  trustStatus: "untrusted" as const,
});

describe("buildCodexAppServerArgs", () => {
  it("passes config overrides before the subcommand", () => {
    const args = buildCodexAppServerArgs(["hooks.PreToolUse=[]", "hooks.state={}"]);

    expect(args).toEqual(["-c", "hooks.PreToolUse=[]", "-c", "hooks.state={}", "app-server"]);
  });
});

describe("buildTripwireHookCommand", () => {
  // Codex runs hook commands through a shell, and the desktop build's own
  // executable is Electron rather than node.
  it("runs the script under node with paths quoted, even from an Electron host", () => {
    const command = buildTripwireHookCommand({
      nodePath: "/Applications/GedCode.app/Contents/MacOS/Ged Code",
      scriptPath: "/Users/dev/Library/Application Support/ged code/tripwire.mjs",
    });

    expect(command).toBe(
      'ELECTRON_RUN_AS_NODE=1 "/Applications/GedCode.app/Contents/MacOS/Ged Code" "/Users/dev/Library/Application Support/ged code/tripwire.mjs"',
    );
  });
});

describe("buildTripwireHookDefinitionOverride", () => {
  // The hook has to see every tool call, and the command itself contains quotes,
  // so it is embedded as an escaped TOML string.
  it("declares a PreToolUse command hook matching every tool", () => {
    const override = buildTripwireHookDefinitionOverride('node "/srv/ged code/tripwire.mjs"');

    expect(override).toBe(
      'hooks.PreToolUse=[{ matcher = "*", hooks = [{ type = "command", command = "node \\"/srv/ged code/tripwire.mjs\\"" }] }]',
    );
  });
});

describe("buildTripwireHookTrustOverride", () => {
  // Trust is granted per invocation to one hook identity and one hash, so no
  // other hook on the machine becomes trusted as a side effect.
  it("trusts exactly the probed hook", () => {
    const override = buildTripwireHookTrustOverride({
      key: "/<session-flags>/config.toml:pre_tool_use:0:0",
      trustedHash: "sha256:6a35caff",
    });

    expect(override).toBe(
      'hooks.state={ "/<session-flags>/config.toml:pre_tool_use:0:0" = { trusted_hash = "sha256:6a35caff", enabled = true } }',
    );
  });
});

describe("findTripwireHookTrust", () => {
  it("reads the identity and hash of the hook the server passed in", () => {
    const trust = findTripwireHookTrust({
      data: [
        {
          cwd: "/srv/worktree",
          errors: [],
          warnings: [],
          hooks: [
            hookMetadata({
              currentHash: "sha256:user-hook",
              eventName: "preToolUse",
              key: "/Users/dev/.codex/hooks.json:pre_tool_use:0:0",
              source: "user",
            }),
            hookMetadata({
              currentHash: "sha256:ours",
              eventName: "preToolUse",
              key: "/<session-flags>/config.toml:pre_tool_use:0:0",
              source: "sessionFlags",
            }),
          ],
        },
      ],
    });

    expect(trust).toEqual({
      key: "/<session-flags>/config.toml:pre_tool_use:0:0",
      trustedHash: "sha256:ours",
    });
  });

  // Without a hash the hook cannot be trusted, and an untrusted hook does not
  // run: the caller has to start the worker without it rather than guess.
  it("reports nothing when the probe does not list the hook", () => {
    const trust = findTripwireHookTrust({
      data: [
        {
          cwd: "/srv/worktree",
          errors: [],
          warnings: [],
          hooks: [
            hookMetadata({
              currentHash: "sha256:user-hook",
              eventName: "postToolUse",
              key: "/Users/dev/.codex/hooks.json:post_tool_use:0:0",
              source: "user",
            }),
          ],
        },
      ],
    });

    expect(trust).toBeUndefined();
  });
});

describe("resolveTripwireHookOverrides", () => {
  const listing = (hash: string): EffectCodexSchema.V2HooksListResponse => ({
    data: [
      {
        cwd: "/srv/worktree",
        errors: [],
        warnings: [],
        hooks: [
          hookMetadata({
            currentHash: hash,
            eventName: "preToolUse",
            key: "/<session-flags>/config.toml:pre_tool_use:0:0",
            source: "sessionFlags",
          }),
        ],
      },
    ],
  });

  it("probes with the hook definition and trusts the hash it reports back", async () => {
    const probed: Array<string> = [];

    const overrides = await Effect.runPromise(
      resolveTripwireHookOverrides({
        hookCommand: 'node "/srv/tripwire.mjs"',
        probe: (definitionOverride) =>
          Effect.sync(() => {
            probed.push(definitionOverride);
            return listing("sha256:probed");
          }),
      }),
    );

    const definition = buildTripwireHookDefinitionOverride('node "/srv/tripwire.mjs"');
    expect(probed).toEqual([definition]);
    expect(overrides).toEqual([
      definition,
      buildTripwireHookTrustOverride({
        key: "/<session-flags>/config.toml:pre_tool_use:0:0",
        trustedHash: "sha256:probed",
      }),
    ]);
  });

  // A tripwire that cannot be trusted cannot run, and workers are unattended: the
  // session starts without it and the lost coverage is logged.
  it("yields no overrides when the probe fails", async () => {
    const overrides = await Effect.runPromise(
      resolveTripwireHookOverrides({
        hookCommand: 'node "/srv/tripwire.mjs"',
        probe: () =>
          Effect.fail(
            new CodexErrors.CodexAppServerTransportError({
              detail: "codex app-server exited before listing hooks",
              cause: undefined,
            }),
          ),
      }),
    );

    expect(overrides).toEqual([]);
  });

  // A Codex build that ignores session-flag hooks would answer without ours.
  it("yields no overrides when the probe does not list the hook", async () => {
    const overrides = await Effect.runPromise(
      resolveTripwireHookOverrides({
        hookCommand: 'node "/srv/tripwire.mjs"',
        probe: () => Effect.succeed({ data: [] }),
      }),
    );

    expect(overrides).toEqual([]);
  });
});
