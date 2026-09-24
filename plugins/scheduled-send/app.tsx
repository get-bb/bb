import {
  useCallback,
  useEffect,
  useId,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  definePluginApp,
  useComposer,
  useComposerView,
  type ComposerView,
  type PluginComposerScope,
} from "@get-bb/plugin-sdk/app";
import {
  DEFAULT_SCHEDULE_PRESET_ID,
  MAX_SCHEDULE_AHEAD_MS,
  defaultCustomSchedule,
  formatDateInputValue,
  formatScheduleTime,
  formatScheduleTimeZone,
  isSchedulePresetId,
  listSchedulePresets,
  parseCustomScheduleTime,
  type CustomScheduleFields,
  type SchedulePresetId,
  type ScheduleTimeParse,
} from "./schedule-time.js";

export function composerScopeKey(scope: PluginComposerScope): string {
  switch (scope.kind) {
    case "thread":
      return `thread:${scope.threadId}`;
    case "queued-message":
      return `queued-message:${scope.queuedMessageId}`;
    case "side-chat":
      return `side-chat:${scope.tabId}`;
    case "new-thread":
      return `new-thread:${scope.projectId ?? ""}`;
  }
}

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

export function openSendLater(view: ComposerView): boolean {
  if (view.draft.isEmpty) return false;
  openScopeKey = composerScopeKey(view.scope);
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

const CUSTOM_SCHEDULE_OPTION_ID = "custom";
type ScheduleOptionId = SchedulePresetId | typeof CUSTOM_SCHEDULE_OPTION_ID;

function isScheduleOptionId(value: string): value is ScheduleOptionId {
  return value === CUSTOM_SCHEDULE_OPTION_ID || isSchedulePresetId(value);
}

function resolveScheduleOption(
  optionId: ScheduleOptionId,
  custom: CustomScheduleFields,
  now: number,
): ScheduleTimeParse {
  if (optionId === CUSTOM_SCHEDULE_OPTION_ID) {
    return parseCustomScheduleTime(custom, now);
  }
  const preset = listSchedulePresets(now).find(
    (candidate) => candidate.id === optionId,
  );
  return preset === undefined
    ? { ok: false, message: "That option has passed. Choose another time." }
    : { ok: true, at: preset.at };
}

function SendLaterPicker() {
  const composer = useComposer();
  const view = useComposerView();
  const scopeKey = composerScopeKey(view.scope);
  const isOpen = useSendLaterOpen(scopeKey);
  const whenId = useId();
  const customDateId = useId();
  const customTimeId = useId();
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
    setSelectedOption(DEFAULT_SCHEDULE_PRESET_ID);
    setCustom(defaultCustomSchedule(openedAt));
    setError(null);
    const interval = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && view.draft.isEmpty) closeSendLater();
  }, [isOpen, view.draft.isEmpty]);

  async function schedule(at: number): Promise<void> {
    if (at <= Date.now()) {
      setError("That time has just passed. Pick another.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await composer.experimental_submit({ sendAt: at });
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

  const presets = listSchedulePresets(now);
  const preview = resolveScheduleOption(selectedOption, custom, now);
  const visibleError = error ?? (preview.ok ? null : preview.message);

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
            {view.scope.kind === "new-thread"
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
          <div className="flex flex-col gap-2">
            <Label htmlFor={whenId}>When</Label>
            <Select
              disabled={busy}
              onValueChange={(value) => {
                if (!isScheduleOptionId(value)) return;
                setSelectedOption(value);
                setError(null);
              }}
              value={selectedOption}
            >
              <SelectTrigger aria-label="When to send" id={whenId}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {presets.map((preset) => (
                  <SelectItem key={preset.id} value={preset.id}>
                    {preset.label}
                  </SelectItem>
                ))}
                <SelectItem value={CUSTOM_SCHEDULE_OPTION_ID}>
                  Custom date and time
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {selectedOption === CUSTOM_SCHEDULE_OPTION_ID ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor={customDateId}>Date</Label>
                <Input
                  disabled={busy}
                  id={customDateId}
                  max={formatDateInputValue(now + MAX_SCHEDULE_AHEAD_MS)}
                  min={formatDateInputValue(now)}
                  onChange={(event) => {
                    setCustom((current) => ({
                      ...current,
                      date: event.target.value,
                    }));
                    setError(null);
                  }}
                  type="date"
                  value={custom.date}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor={customTimeId}>Time</Label>
                <Input
                  disabled={busy}
                  id={customTimeId}
                  onChange={(event) => {
                    setCustom((current) => ({
                      ...current,
                      time: event.target.value,
                    }));
                    setError(null);
                  }}
                  type="time"
                  value={custom.time}
                />
              </div>
            </div>
          ) : null}

          {preview.ok ? (
            <div
              aria-live="polite"
              className="rounded-md bg-muted/50 px-3 py-2"
            >
              <p className="font-medium">
                Sends {formatScheduleTime(preview.at, now)}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {formatScheduleTimeZone(preview.at)}
              </p>
            </div>
          ) : null}

          {visibleError === null ? null : (
            <p className="text-destructive" role="alert">
              {visibleError}
            </p>
          )}

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

export default definePluginApp((app) => {
  app.composer.customize({
    id: "send-later",
    scopes: ["thread", "new-thread"],
    plusMenu: [
      {
        id: "send-later",
        label: "Send later…",
        icon: "Calendar",
        description: "Schedule the current draft to send at a time you pick.",
        disabled: (view) => view.draft.isEmpty || view.run.isSubmitting,
        run: ({ view }) => {
          if (!openSendLater(view)) {
            toast.error("Nothing to schedule", {
              description: "Type a message first, then choose Send later.",
            });
          }
        },
      },
    ],
    banners: [{ id: "send-later", chrome: "bare", component: SendLaterPicker }],
  });
});
