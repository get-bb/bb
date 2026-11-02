import {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScheduleTimeFields } from "@/components/ui/schedule-time-fields";
import {
  definePluginApp,
  useComposer,
  type ComposerSendMenuItem,
  type PluginComposerApi,
} from "@get-bb/plugin-sdk/app";
import {
  DEFAULT_SCHEDULE_PRESET_ID,
  defaultCustomSchedule,
  formatScheduleTime,
  isScheduleOptionId,
  resolveScheduleOption,
  type CustomScheduleFields,
  type ScheduleOptionId,
} from "@/lib/schedule-time";

const listeners = new Set<() => void>();
let openScopeKey: string | null = null;

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function openSendLater(composer: PluginComposerApi): boolean {
  if (composer.isEmpty) return false;
  openScopeKey = composer.key;
  notify();
  return true;
}

function closeSendLater(): void {
  openScopeKey = null;
  notify();
}

export function resetSendLaterState(): void {
  openScopeKey = null;
  notify();
}

function useSendLaterOpen(scopeKey: string): boolean {
  const snapshot = useCallback(() => openScopeKey === scopeKey, [scopeKey]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const SCHEDULE_SELECTION_STORAGE_KEY = "bb:scheduled-send:selection:v1";

function readScheduleSelection(now: number): {
  optionId: ScheduleOptionId;
  custom: CustomScheduleFields;
} {
  const fallback = {
    optionId: DEFAULT_SCHEDULE_PRESET_ID,
    custom: defaultCustomSchedule(now),
  };
  try {
    const stored = localStorage.getItem(SCHEDULE_SELECTION_STORAGE_KEY);
    if (stored === null) return fallback;
    const value: unknown = JSON.parse(stored);
    if (
      typeof value !== "object" ||
      value === null ||
      !("optionId" in value) ||
      typeof value.optionId !== "string" ||
      !isScheduleOptionId(value.optionId) ||
      !("date" in value) ||
      typeof value.date !== "string" ||
      !("time" in value) ||
      typeof value.time !== "string"
    )
      return fallback;
    const custom = { date: value.date, time: value.time };
    return resolveScheduleOption(value.optionId, custom, now).ok
      ? { optionId: value.optionId, custom }
      : fallback;
  } catch {
    return fallback;
  }
}

function rememberScheduleSelection(
  optionId: ScheduleOptionId,
  custom: CustomScheduleFields,
): void {
  try {
    localStorage.setItem(
      SCHEDULE_SELECTION_STORAGE_KEY,
      JSON.stringify({ optionId, ...custom }),
    );
  } catch {}
}

function SendLaterPicker() {
  const composer = useComposer();
  const isEmpty = composer.isEmpty;
  const isOpen = useSendLaterOpen(composer.key);
  const [selectedOption, setSelectedOption] = useState<ScheduleOptionId>(
    DEFAULT_SCHEDULE_PRESET_ID,
  );
  const [custom, setCustom] = useState<CustomScheduleFields>(() =>
    defaultCustomSchedule(Date.now()),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!isOpen) return;
    const openedAt = Date.now();
    setNow(openedAt);
    const selection = readScheduleSelection(openedAt);
    setSelectedOption(selection.optionId);
    setCustom(selection.custom);
    setError(null);
    const interval = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && isEmpty) closeSendLater();
  }, [isEmpty, isOpen]);

  async function schedule(at: number): Promise<void> {
    if (at <= Date.now()) {
      setError("That time has just passed. Pick another.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await composer.submit({
        experimental_mode: "queue-if-active",
        sendAt: at,
      });
      closeSendLater();
      toast.success(`Sending ${formatScheduleTime(at, Date.now())}`);
    } catch (scheduleError: unknown) {
      setError(errorMessage(scheduleError));
    } finally {
      setBusy(false);
    }
  }

  function submitSelection(): void {
    const resolved = resolveScheduleOption(selectedOption, custom, Date.now());
    if (!resolved.ok) {
      setError(resolved.message);
      return;
    }
    void schedule(resolved.at);
  }

  const preview = resolveScheduleOption(selectedOption, custom, now);

  return (
    <Dialog
      onOpenChange={(next) => {
        if (!next && !busy) closeSendLater();
      }}
      open={isOpen}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send later</DialogTitle>
          <DialogDescription>
            {composer.scope.kind === "new-thread"
              ? "Choose when this thread should start. It will use the model and environment selected in the composer."
              : "Choose when this message should send."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4 text-sm"
          onSubmit={(event) => {
            event.preventDefault();
            submitSelection();
          }}
        >
          <ScheduleTimeFields
            custom={custom}
            disabled={busy}
            error={error}
            now={now}
            onCustomChange={(next) => {
              setCustom(next);
              rememberScheduleSelection(selectedOption, next);
              setError(null);
            }}
            onOptionChange={(next) => {
              setSelectedOption(next);
              rememberScheduleSelection(next, custom);
              setError(null);
            }}
            optionId={selectedOption}
          />

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              disabled={busy}
              onClick={() => closeSendLater()}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button disabled={busy || !preview.ok} type="submit">
              {busy ? "Scheduling…" : "Schedule send"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const sendLater: ComposerSendMenuItem = {
  id: "send-later",
  label: "Send later…",
  icon: "Calendar",
  description: "Schedule the current draft to send at a time you pick.",
  disabled: (composer) => composer.isSubmittingBlocked,
  run: ({ composer }) => {
    if (!openSendLater(composer)) {
      toast.error("Nothing to schedule", {
        description: "Type a message first, then choose Send later.",
      });
    }
  },
};

export default definePluginApp((app) => {
  app.composer.customize({
    id: "send-later",
    scopes: ["thread", "new-thread"],
    sendMenu: [sendLater],
    banners: [{ id: "send-later", chrome: "bare", component: SendLaterPicker }],
  });
});
