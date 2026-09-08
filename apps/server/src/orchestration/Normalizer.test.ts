import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CommandId,
  MessageId,
  ProviderInstanceId,
  QueuedMessageId,
  ThreadId,
  type ClientOrchestrationCommand,
} from "@t3tools/contracts";
import { it, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import { resolveAttachmentPath } from "../attachmentStore.ts";
import { ServerConfig } from "../config.ts";
import { WorkspacePathsLive } from "../workspace/Layers/WorkspacePaths.ts";
import { normalizeDispatchCommand } from "./Normalizer.ts";

const TestLayer = Layer.empty.pipe(
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "gedcode-normalizer-test-" })),
  Layer.provideMerge(WorkspacePathsLive),
  Layer.provideMerge(NodeServices.layer),
);

it.layer(TestLayer)("normalizeDispatchCommand", (it) => {
  it.effect("sanitizes uploaded SVG bytes before persisting them", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const config = yield* ServerConfig;
      const rawSvg = Buffer.from(`
        <svg xmlns="http://www.w3.org/2000/svg" onload="alert('event')">
          <script>alert("script")</script>
          <rect width="24" height="24" fill="#fff" />
        </svg>
      `);
      const command: ClientOrchestrationCommand = {
        type: "thread.turn.start",
        commandId: CommandId.make("command-svg-upload"),
        threadId: ThreadId.make("thread-svg-upload"),
        message: {
          messageId: MessageId.make("message-svg-upload"),
          role: "user",
          text: "inspect this image",
          attachments: [
            {
              type: "image",
              name: "unsafe.svg",
              mimeType: "image/svg+xml",
              sizeBytes: rawSvg.byteLength,
              dataUrl: `data:image/svg+xml;base64,${rawSvg.toString("base64")}`,
            },
          ],
        },
        runtimeMode: "approval-required",
        interactionMode: "default",
        createdAt: "2026-08-30T12:00:00.000Z",
      };

      const normalized = yield* normalizeDispatchCommand(command);
      if (normalized.type !== "thread.turn.start") {
        throw new Error("Expected a normalized turn-start command.");
      }
      const attachment = normalized.message.attachments[0];
      if (!attachment) {
        throw new Error("Expected a persisted SVG attachment.");
      }
      const attachmentPath = resolveAttachmentPath({
        attachmentsDir: config.attachmentsDir,
        attachment,
      });
      if (!attachmentPath) {
        throw new Error("Expected a safe persisted attachment path.");
      }

      const persisted = yield* fileSystem.readFileString(attachmentPath);
      expect(persisted).toContain("<rect");
      expect(persisted).not.toContain("<script");
      expect(persisted).not.toContain("onload");
      expect(attachment.sizeBytes).toBe(Buffer.byteLength(persisted));
    }),
  );

  it.effect("normalizes an exact attachment retry to the same id and path", () =>
    Effect.gen(function* () {
      const bytes = Buffer.from("stable-image-content");
      const command: ClientOrchestrationCommand = {
        type: "thread.turn.start",
        commandId: CommandId.make("command-exact-retry"),
        threadId: ThreadId.make("thread-exact-retry"),
        message: {
          messageId: MessageId.make("message-exact-retry"),
          role: "user",
          text: "inspect",
          attachments: [
            {
              type: "image",
              name: "image.png",
              mimeType: "image/png",
              sizeBytes: bytes.byteLength,
              dataUrl: `data:image/png;base64,${bytes.toString("base64")}`,
            },
          ],
        },
        runtimeMode: "approval-required",
        interactionMode: "default",
        createdAt: "2026-08-30T12:00:00.000Z",
      };
      const first = yield* normalizeDispatchCommand(command);
      const retry = yield* normalizeDispatchCommand(command);
      if (first.type !== "thread.turn.start" || retry.type !== "thread.turn.start") {
        throw new Error("Expected normalized turn-start commands.");
      }
      expect(first.message.attachments).toEqual(retry.message.attachments);
    }),
  );

  it.effect("normalizes queue-enqueue attachments deterministically before dispatch", () =>
    Effect.gen(function* () {
      const bytes = Buffer.from("queued-image-content");
      const command: ClientOrchestrationCommand = {
        type: "thread.queue.enqueue",
        commandId: CommandId.make("command-queue-image"),
        threadId: ThreadId.make("thread-queue-image"),
        queueItemId: QueuedMessageId.make("queue-image"),
        message: {
          messageId: MessageId.make("message-queue-image"),
          text: "later",
          attachments: [
            {
              type: "image",
              name: "queued.png",
              mimeType: "image/png",
              sizeBytes: bytes.byteLength,
              dataUrl: `data:image/png;base64,${bytes.toString("base64")}`,
            },
          ],
        },
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6" },
        gedWorkflowEnabled: true,
        runtimeMode: "full-access",
        interactionMode: "default",
        createdAt: "2026-08-30T12:00:00.000Z",
      };
      const first = yield* normalizeDispatchCommand(command);
      const retry = yield* normalizeDispatchCommand(command);
      if (first.type !== "thread.queue.enqueue" || retry.type !== "thread.queue.enqueue") {
        throw new Error("Expected normalized queue-enqueue commands.");
      }
      expect(first.message.attachments).toEqual(retry.message.attachments);
      expect(first.message.attachments[0]).not.toHaveProperty("dataUrl");
    }),
  );

  it.effect("uses a new path for changed content without overwriting the first upload", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const config = yield* ServerConfig;
      const makeCommand = (bytes: Buffer): ClientOrchestrationCommand => ({
        type: "thread.turn.start",
        commandId: CommandId.make("command-changed-retry"),
        threadId: ThreadId.make("thread-changed-retry"),
        message: {
          messageId: MessageId.make("message-changed-retry"),
          role: "user",
          text: "inspect",
          attachments: [
            {
              type: "image",
              name: "image.png",
              mimeType: "image/png",
              sizeBytes: bytes.byteLength,
              dataUrl: `data:image/png;base64,${bytes.toString("base64")}`,
            },
          ],
        },
        runtimeMode: "approval-required",
        interactionMode: "default",
        createdAt: "2026-08-30T12:00:00.000Z",
      });
      const firstBytes = Buffer.from("first-content");
      const changedBytes = Buffer.from("changed-content");
      const first = yield* normalizeDispatchCommand(makeCommand(firstBytes));
      const changed = yield* normalizeDispatchCommand(makeCommand(changedBytes));
      if (first.type !== "thread.turn.start" || changed.type !== "thread.turn.start") {
        throw new Error("Expected normalized turn-start commands.");
      }
      const firstAttachment = first.message.attachments[0]!;
      const changedAttachment = changed.message.attachments[0]!;
      expect(changedAttachment.id).not.toBe(firstAttachment.id);
      const firstPath = resolveAttachmentPath({
        attachmentsDir: config.attachmentsDir,
        attachment: firstAttachment,
      })!;
      const changedPath = resolveAttachmentPath({
        attachmentsDir: config.attachmentsDir,
        attachment: changedAttachment,
      })!;
      expect(Buffer.from(yield* fileSystem.readFile(firstPath))).toEqual(firstBytes);
      expect(Buffer.from(yield* fileSystem.readFile(changedPath))).toEqual(changedBytes);
    }),
  );

  it.effect("keeps colliding sanitized thread segments isolated", () =>
    Effect.gen(function* () {
      const bytes = Buffer.from("same-content");
      const makeCommand = (threadId: string): ClientOrchestrationCommand => ({
        type: "thread.turn.start",
        commandId: CommandId.make("command-colliding-segment"),
        threadId: ThreadId.make(threadId),
        message: {
          messageId: MessageId.make("message-colliding-segment"),
          role: "user",
          text: "inspect",
          attachments: [
            {
              type: "image",
              name: "same.png",
              mimeType: "image/png",
              sizeBytes: bytes.byteLength,
              dataUrl: `data:image/png;base64,${bytes.toString("base64")}`,
            },
          ],
        },
        runtimeMode: "approval-required",
        interactionMode: "default",
        createdAt: "2026-08-30T12:00:00.000Z",
      });
      const sharedPrefix = "thread-" + "x".repeat(90);
      const first = yield* normalizeDispatchCommand(makeCommand(`${sharedPrefix}-one`));
      const second = yield* normalizeDispatchCommand(makeCommand(`${sharedPrefix}-two`));
      if (first.type !== "thread.turn.start" || second.type !== "thread.turn.start") {
        throw new Error("Expected normalized turn-start commands.");
      }
      expect(first.message.attachments[0]?.id).not.toBe(second.message.attachments[0]?.id);
    }),
  );
});
