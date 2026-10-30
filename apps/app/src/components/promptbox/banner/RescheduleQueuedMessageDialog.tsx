import { useId, useState } from "react";
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
import { useSecondTick } from "@/hooks/useSecondTick";
import {
  parseQueuedMessageScheduleFields,
  queuedMessageScheduleFields,
  type QueuedMessageScheduleFields,
} from "@/lib/queued-message-reschedule";
import { formatScheduledTime } from "@/lib/relative-time";

export interface RescheduleQueuedMessageTarget {
  expectedUpdatedAt: number;
  queuedMessageId: string;
  sendAt: number;
}

interface RescheduleQueuedMessageDialogProps {
  target: RescheduleQueuedMessageTarget | null;
  onClose: () => void;
  onReschedule: (sendAt: number) => Promise<void>;
}

export function RescheduleQueuedMessageDialog({
  target,
  onClose,
  onReschedule,
}: RescheduleQueuedMessageDialogProps) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent>
        {target === null ? null : (
          <RescheduleQueuedMessageForm
            key={`${target.queuedMessageId}:${target.expectedUpdatedAt}`}
            busy={busy}
            initialSendAt={target.sendAt}
            onBusyChange={setBusy}
            onClose={onClose}
            onReschedule={onReschedule}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function RescheduleQueuedMessageForm({
  busy,
  initialSendAt,
  onBusyChange,
  onClose,
  onReschedule,
}: {
  busy: boolean;
  initialSendAt: number;
  onBusyChange: (busy: boolean) => void;
  onClose: () => void;
  onReschedule: (sendAt: number) => Promise<void>;
}) {
  const dateId = useId();
  const timeId = useId();
  const now = useSecondTick();
  const [fields, setFields] = useState<QueuedMessageScheduleFields>(() =>
    queuedMessageScheduleFields(initialSendAt),
  );
  const [error, setError] = useState<string | null>(null);
  const preview = parseQueuedMessageScheduleFields(fields, now);
  const visibleError = error ?? (preview.ok ? null : preview.message);

  async function submit(): Promise<void> {
    const resolved = parseQueuedMessageScheduleFields(fields, Date.now());
    if (!resolved.ok) {
      setError(resolved.message);
      return;
    }
    onBusyChange(true);
    setError(null);
    try {
      await onReschedule(resolved.at);
      onClose();
    } catch (rescheduleError: unknown) {
      setError(
        rescheduleError instanceof Error
          ? rescheduleError.message
          : String(rescheduleError),
      );
    } finally {
      onBusyChange(false);
    }
  }

  function updateFields(next: QueuedMessageScheduleFields): void {
    setFields(next);
    setError(null);
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Reschedule message</DialogTitle>
        <DialogDescription>
          Choose a new time. The message, its attachments and its settings stay
          as they are.
        </DialogDescription>
      </DialogHeader>
      <form
        className="flex flex-col gap-4 text-sm"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor={dateId}>Date</Label>
            <Input
              disabled={busy}
              id={dateId}
              min={queuedMessageScheduleFields(now).date}
              onChange={(event) =>
                updateFields({ ...fields, date: event.target.value })
              }
              type="date"
              value={fields.date}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={timeId}>Time</Label>
            <Input
              disabled={busy}
              id={timeId}
              onChange={(event) =>
                updateFields({ ...fields, time: event.target.value })
              }
              type="time"
              value={fields.time}
            />
          </div>
        </div>
        {preview.ok ? (
          <p aria-live="polite" className="rounded-md bg-muted/50 px-3 py-2">
            Sends {formatScheduledTime({ now, timestamp: preview.at })}
          </p>
        ) : null}
        {visibleError === null ? null : (
          <p className="text-destructive" role="alert">
            {visibleError}
          </p>
        )}
        <DialogFooter>
          <Button
            disabled={busy}
            onClick={onClose}
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
          <Button disabled={busy || !preview.ok} type="submit">
            {busy ? "Rescheduling…" : "Reschedule"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
