import { useId, useState, type FormEvent } from "react";
import type { ThreadQueuedMessage } from "@bb/domain";
import { Button } from "@bb/shared-ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import { Input } from "@bb/shared-ui/input";
import { Label } from "@bb/shared-ui/label";
import { formatScheduledTime } from "@/lib/relative-time";
import type { QueuedMessageSendTimeRequest } from "@/components/promptbox/banner/LazyQueuedMessagesList";

interface QueuedMessageSendTimeDialogProps {
  queuedMessage: ThreadQueuedMessage | null;
  onOpenChange: (open: boolean) => void;
  onChangeSendTime: (request: QueuedMessageSendTimeRequest) => void;
}

function padded(value: number, length = 2): string {
  return String(value).padStart(length, "0");
}

export function formatSendTimeInputValue(at: number): string {
  const date = new Date(at);
  return `${padded(date.getFullYear(), 4)}-${padded(date.getMonth() + 1)}-${padded(date.getDate())}T${padded(date.getHours())}:${padded(date.getMinutes())}`;
}

const SEND_TIME_INPUT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

export function parseSendTimeInputValue(
  value: string,
  now: number,
): { ok: true; at: number } | { ok: false; message: string } {
  if (!SEND_TIME_INPUT_PATTERN.test(value)) {
    return { ok: false, message: "Choose a date and time." };
  }
  const at = new Date(value).getTime();
  if (!Number.isFinite(at)) {
    return { ok: false, message: "Choose a real date and time." };
  }
  if (at <= now) return { ok: false, message: "Choose a future time." };
  return { ok: true, at };
}

export function QueuedMessageSendTimeDialog({
  queuedMessage,
  onOpenChange,
  onChangeSendTime,
}: QueuedMessageSendTimeDialogProps) {
  return (
    <Dialog open={queuedMessage !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        {queuedMessage ? (
          <QueuedMessageSendTimeForm
            key={queuedMessage.id}
            queuedMessage={queuedMessage}
            onDone={() => onOpenChange(false)}
            onChangeSendTime={onChangeSendTime}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function QueuedMessageSendTimeForm({
  queuedMessage,
  onDone,
  onChangeSendTime,
}: {
  queuedMessage: ThreadQueuedMessage;
  onDone: () => void;
  onChangeSendTime: (request: QueuedMessageSendTimeRequest) => void;
}) {
  const inputId = useId();
  const [openedAt] = useState(() => Date.now());
  const [value, setValue] = useState(() =>
    formatSendTimeInputValue(
      queuedMessage.sendAt !== null && queuedMessage.sendAt > openedAt
        ? queuedMessage.sendAt
        : openedAt + 60 * 60 * 1000,
    ),
  );
  const [error, setError] = useState<string | null>(null);
  const preview = parseSendTimeInputValue(value, openedAt);

  const submit = (sendAt: number | null) => {
    onChangeSendTime({
      expectedUpdatedAt: queuedMessage.updatedAt,
      queuedMessageId: queuedMessage.id,
      sendAt,
    });
    onDone();
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = parseSendTimeInputValue(value, Date.now());
    if (!parsed.ok) {
      setError(parsed.message);
      return;
    }
    submit(parsed.at);
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Change send time</DialogTitle>
        <DialogDescription>
          Choose when this queued message should send.
        </DialogDescription>
      </DialogHeader>
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <Label htmlFor={inputId}>Send at</Label>
          <Input
            id={inputId}
            type="datetime-local"
            value={value}
            min={formatSendTimeInputValue(openedAt)}
            onChange={(event) => {
              setValue(event.target.value);
              setError(null);
            }}
          />
          {error !== null || !preview.ok ? (
            <p className="text-sm text-destructive" role="alert">
              {error ?? (preview.ok ? null : preview.message)}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground" aria-live="polite">
              Sends {formatScheduledTime({ now: openedAt, timestamp: preview.at })}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => submit(null)}>
            Send when ready
          </Button>
          <Button type="submit" disabled={!preview.ok}>
            Save
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
