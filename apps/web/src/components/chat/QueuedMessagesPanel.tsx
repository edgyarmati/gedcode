import { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  CornerDownRightIcon,
  EllipsisIcon,
  PencilIcon,
  SendIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";

import type { ComposerQueuedMessage } from "../../composerDraftStore";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";

function queuedMessageLabel(message: ComposerQueuedMessage): string {
  const text = message.text.trim();
  if (text.length > 0) return text;
  const count = message.attachments.length;
  return count === 1 ? "1 image" : `${count} images`;
}

const QueuedMessageRow = memo(function QueuedMessageRow(props: {
  message: ComposerQueuedMessage;
  queueingEnabled: boolean;
  onSteer: (message: ComposerQueuedMessage) => void;
  onDelete: (messageId: string) => void;
  onEdit: (messageId: string, text: string) => void;
  onQueueingEnabledChange: (enabled: boolean) => void;
}) {
  const { message } = props;
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(message.text);
  const editInputRef = useRef<HTMLInputElement | null>(null);
  const label = queuedMessageLabel(message);
  const isDispatching = message.status === "dispatching";

  useEffect(() => {
    if (!isEditing) setEditText(message.text);
  }, [isEditing, message.text]);

  useEffect(() => {
    if (isEditing) {
      editInputRef.current?.focus();
      editInputRef.current?.select();
    }
  }, [isEditing]);

  const cancelEdit = useCallback(() => {
    setEditText(message.text);
    setIsEditing(false);
  }, [message.text]);

  const saveEdit = useCallback(() => {
    const nextText = editText.trim();
    if (nextText.length === 0 && message.attachments.length === 0) return;
    props.onEdit(message.id, nextText);
    setIsEditing(false);
  }, [editText, message.attachments.length, message.id, props]);

  return (
    <li
      data-testid={`queued-message-${message.id}`}
      className="border-border/60 flex min-w-0 flex-col border-b px-2 py-1.5 last:border-b-0 sm:px-3"
    >
      <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
        <CornerDownRightIcon
          aria-hidden="true"
          className={cn(
            "size-4 shrink-0",
            message.status === "failed" ? "text-destructive" : "text-muted-foreground/70",
          )}
        />

        {isEditing ? (
          <input
            ref={editInputRef}
            aria-label="Edit queued message"
            className="border-input bg-background focus-visible:ring-ring min-w-0 flex-1 rounded-md border px-2 py-1 text-sm outline-none focus-visible:ring-2"
            value={editText}
            onChange={(event) => setEditText(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                saveEdit();
              } else if (event.key === "Escape") {
                event.preventDefault();
                cancelEdit();
              }
            }}
          />
        ) : (
          <span className="min-w-0 flex-1 truncate text-sm" title={label}>
            {label}
          </span>
        )}

        {isEditing ? (
          <>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              disabled={editText.trim().length === 0 && message.attachments.length === 0}
              aria-label="Save queued message"
              onClick={saveEdit}
            >
              <SendIcon aria-hidden="true" className="size-3.5" />
            </Button>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label="Cancel editing queued message"
              onClick={cancelEdit}
            >
              <XIcon aria-hidden="true" className="size-3.5" />
            </Button>
          </>
        ) : (
          <>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 shrink-0 gap-1 px-1.5 text-muted-foreground sm:px-2"
              disabled={isDispatching}
              aria-label={`${message.status === "failed" ? "Retry" : "Steer"} queued message: ${label}`}
              onClick={() => props.onSteer(message)}
            >
              <CornerDownRightIcon aria-hidden="true" className="size-3.5" />
              <span className="hidden sm:inline">
                {isDispatching ? "Sending" : message.status === "failed" ? "Retry" : "Steer"}
              </span>
            </Button>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              className="text-muted-foreground"
              disabled={isDispatching}
              aria-label={`Delete queued message: ${label}`}
              onClick={() => props.onDelete(message.id)}
            >
              <Trash2Icon aria-hidden="true" className="size-3.5" />
            </Button>
            <Menu>
              <MenuTrigger
                render={
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    className="text-muted-foreground"
                    disabled={isDispatching}
                    aria-label={`More options for queued message: ${label}`}
                  />
                }
              >
                <EllipsisIcon aria-hidden="true" className="size-3.5" />
              </MenuTrigger>
              <MenuPopup align="end" className="min-w-48">
                <MenuItem onClick={() => setIsEditing(true)}>
                  <PencilIcon aria-hidden="true" className="size-4" />
                  Edit message
                </MenuItem>
                <MenuItem onClick={() => props.onQueueingEnabledChange(!props.queueingEnabled)}>
                  <CornerDownRightIcon aria-hidden="true" className="size-4" />
                  {props.queueingEnabled ? "Turn off queueing" : "Turn on queueing"}
                </MenuItem>
              </MenuPopup>
            </Menu>
          </>
        )}
      </div>

      {message.status === "failed" && message.error ? (
        <p
          role="alert"
          className="text-destructive ml-5.5 mt-1 truncate text-xs"
          title={message.error}
        >
          {message.error}
        </p>
      ) : null}
    </li>
  );
});

export const QueuedMessagesPanel = memo(function QueuedMessagesPanel(props: {
  messages: ReadonlyArray<ComposerQueuedMessage>;
  queueingEnabled: boolean;
  onSteer: (message: ComposerQueuedMessage) => void;
  onDelete: (messageId: string) => void;
  onEdit: (messageId: string, text: string) => void;
  onQueueingEnabledChange: (enabled: boolean) => void;
}) {
  if (props.messages.length === 0) return null;

  return (
    <section
      aria-label="Queued messages"
      className="bg-card/95 border-border/70 mb-2 overflow-hidden rounded-2xl border shadow-sm"
    >
      <ul>
        {props.messages.map((message) => (
          <QueuedMessageRow
            key={message.id}
            message={message}
            queueingEnabled={props.queueingEnabled}
            onSteer={props.onSteer}
            onDelete={props.onDelete}
            onEdit={props.onEdit}
            onQueueingEnabledChange={props.onQueueingEnabledChange}
          />
        ))}
      </ul>
    </section>
  );
});
