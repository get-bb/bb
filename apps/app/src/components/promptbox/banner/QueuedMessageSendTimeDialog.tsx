import { useEffect, useState, type FormEvent } from "react";
import type { ThreadQueuedMessage } from "@bb/domain";
import { Button } from "@bb/shared-ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import { ScheduleTimeFields } from "@bb/shared-ui/schedule-time-fields";
import {
  CUSTOM_SCHEDULE_OPTION_ID,
  DEFAULT_SCHEDULE_PRESET_ID,
  customScheduleAt,
  defaultCustomSchedule,
  formatScheduleTime,
  resolveScheduleOption,
  type CustomScheduleFields,
  type ScheduleOptionId,
} from "@bb/shared-ui/lib/schedule-time";
import { appToast } from "@/components/ui/app-toast";
import { getMutationErrorMessage } from "@/lib/mutation-errors";
import type { QueuedMessageSendTimeRequest } from "@/components/promptbox/banner/LazyQueuedMessagesList";

interface QueuedMessageSendTimeDialogProps {
  queuedMessage: ThreadQueuedMessage | null;
  onOpenChange: (open: boolean) => void;
  onChangeSendTime: (request: QueuedMessageSendTimeRequest) => Promise<void>;
}

export function QueuedMessageSendTimeDialog({
  queuedMessage,
  onOpenChange,
  onChangeSendTime,
}: QueuedMessageSendTimeDialogProps) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={queuedMessage !== null}
      onOpenChange={(open) => {
        if (open || !busy) onOpenChange(open);
      }}
    >
      <DialogContent>
        {queuedMessage ? (
          <QueuedMessageSendTimeForm
            key={queuedMessage.id}
            busy={busy}
            queuedMessage={queuedMessage}
            onBusyChange={setBusy}
            onDone={() => onOpenChange(false)}
            onChangeSendTime={onChangeSendTime}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function initialSelection(
  sendAt: number | null,
  now: number,
): { optionId: ScheduleOptionId; custom: CustomScheduleFields } {
  return sendAt !== null && sendAt > now
    ? { optionId: CUSTOM_SCHEDULE_OPTION_ID, custom: customScheduleAt(sendAt) }
    : {
        optionId: DEFAULT_SCHEDULE_PRESET_ID,
        custom: defaultCustomSchedule(now),
      };
}

function QueuedMessageSendTimeForm({
  busy,
  queuedMessage,
  onBusyChange,
  onDone,
  onChangeSendTime,
}: {
  busy: boolean;
  queuedMessage: ThreadQueuedMessage;
  onBusyChange: (busy: boolean) => void;
  onDone: () => void;
  onChangeSendTime: (request: QueuedMessageSendTimeRequest) => Promise<void>;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [selection, setSelection] = useState(() =>
    initialSelection(queuedMessage.sendAt, now),
  );
  const [error, setError] = useState<string | null>(null);
  const preview = resolveScheduleOption(
    selection.optionId,
    selection.custom,
    now,
  );

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);

  const save = async (sendAt: number | null) => {
    onBusyChange(true);
    setError(null);
    try {
      await onChangeSendTime({
        expectedUpdatedAt: queuedMessage.updatedAt,
        queuedMessageId: queuedMessage.id,
        sendAt,
      });
      onDone();
      appToast.success(
        sendAt === null
          ? "Send time removed"
          : `Sending ${formatScheduleTime(sendAt, Date.now())}`,
      );
    } catch (saveError: unknown) {
      setError(
        getMutationErrorMessage({
          error: saveError,
          fallbackMessage: "Failed to change when the queued message sends",
          lifecycleOperation: "update_queued_message",
        }),
      );
    } finally {
      onBusyChange(false);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const resolved = resolveScheduleOption(
      selection.optionId,
      selection.custom,
      Date.now(),
    );
    if (!resolved.ok) {
      setError(resolved.message);
      return;
    }
    void save(resolved.at);
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Change send time</DialogTitle>
        <DialogDescription>
          Choose when this message should send.
        </DialogDescription>
      </DialogHeader>
      <form className="flex flex-col gap-4 text-sm" onSubmit={handleSubmit}>
        <ScheduleTimeFields
          custom={selection.custom}
          disabled={busy}
          error={error}
          now={now}
          onCustomChange={(custom) => {
            setSelection((current) => ({ ...current, custom }));
            setError(null);
          }}
          onOptionChange={(optionId) => {
            setSelection((current) => ({ ...current, optionId }));
            setError(null);
          }}
          optionId={selection.optionId}
        />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            className="sm:mr-auto"
            disabled={busy}
            onClick={() => void save(null)}
            type="button"
            variant="ghost"
          >
            Remove send time
          </Button>
          <Button
            disabled={busy}
            onClick={onDone}
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
          <Button disabled={busy || !preview.ok} type="submit">
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </>
  );
}
