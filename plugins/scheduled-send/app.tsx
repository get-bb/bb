// bb-plugin-scheduled-send frontend — "Send later…" in the composer's + menu.
//
// The plugin owns the *time*, and nothing else. `useComposer()`'s
// `experimental_submit({ holdUntil })` runs the composer's own submit pipeline
// with the draft that is on screen, so the request is byte-for-byte the one
// Enter would have produced — attachments, @-mentions, and in the new-thread
// composer the provider, model, reasoning level, service tier, permission mode
// and environment the user picked. That is why this plugin has no backend: a
// plugin-side `threads.send`/`threads.spawn` cannot see those selections and
// would silently schedule a different message than the one being composed.
//
// Everything after the schedule — the held card above the composer, the
// countdown, Release now, Cancel — is core's hold UI, which this plugin never
// duplicates.
//
// The + menu row cannot render a form (rows are host-rendered), so the row
// opens the host's `experimental_Dialog`: a centred dialog on wide viewports
// and bb's shared persistent responsive drawer on compact ones. A module-level
// store connects the two — they are separate components mounted by the host,
// and both identify the composer they belong to by scope.
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { Button } from "@bb/shared-ui/button";
import { Input } from "@bb/shared-ui/input";
import {
  definePluginApp,
  experimental_Dialog as Dialog,
  useComposer,
  useComposerView,
  type ComposerView,
  type PluginComposerScope,
} from "@get-bb/plugin-sdk/app";
import {
  formatScheduleTime,
  listSchedulePresets,
  parseScheduleTime,
} from "./schedule-time.js";

/** Identifies one composer instance, so the picker opens where it was asked for. */
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

/** Test seam: the store outlives a single render, so suites reset it. */
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

const PLACEHOLDER = "30m, 2h, 9am, tomorrow 09:30, 2026-08-26T09:00";

function SendLaterPicker() {
  const composer = useComposer();
  const view = useComposerView();
  const scopeKey = composerScopeKey(view.scope);
  const isOpen = useSendLaterOpen(scopeKey);
  const [customValue, setCustomValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Presets and the preview are relative to a clock that has to keep moving: a
  // picker left open for ten minutes must not schedule "in 1 hour" from when it
  // was opened.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!isOpen) return;
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, [isOpen]);

  // The draft can leave from under the picker — the user sends it normally in
  // another pane, or clears it. There is nothing left to schedule, so stop
  // offering to.
  useEffect(() => {
    if (isOpen && view.draft.isEmpty) closeSendLater();
  }, [isOpen, view.draft.isEmpty]);

  async function schedule(at: number): Promise<void> {
    // The picker's clock ticks every 30s and a preset can be that stale, so
    // re-check against the real one rather than submitting a time that has
    // just passed (which the server would release on its next sweep — an
    // instant send nobody asked for).
    if (at <= Date.now()) {
      setError("That time has just passed. Pick another.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await composer.experimental_submit({ holdUntil: at });
      closeSendLater();
      setCustomValue("");
      toast.success(`Sending ${formatScheduleTime(at, Date.now())}`);
    } catch (scheduleError: unknown) {
      // The host restores the draft on failure, so the message is never lost;
      // the reason belongs here, where the user is looking.
      setError(errorMessage(scheduleError));
    } finally {
      setBusy(false);
    }
  }

  function submitCustom(): void {
    const parsed = parseScheduleTime(customValue, Date.now());
    if (!parsed.ok) {
      setError(parsed.message);
      return;
    }
    void schedule(parsed.at);
  }

  const preview =
    customValue.trim() === "" ? null : parseScheduleTime(customValue, now);

  return (
    <Dialog
      description={
        view.scope.kind === "new-thread"
          ? "The thread is created now and starts working at the time you pick, with the model and environment selected here."
          : "The message is held and sends at the time you pick."
      }
      onOpenChange={(next) => {
        if (!next && !busy) closeSendLater();
      }}
      open={isOpen}
      title="Send later"
    >
      <div className="flex flex-col gap-3 text-sm">
        <div className="flex flex-wrap gap-2">
          {listSchedulePresets(now).map((preset) => (
            <Button
              disabled={busy}
              key={preset.id}
              onClick={() => void schedule(preset.at)}
              type="button"
              variant="secondary"
            >
              {preset.label}
              <span className="ml-1 text-muted-foreground">
                {new Date(preset.at).toLocaleTimeString([], {
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </span>
            </Button>
          ))}
        </div>

        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            submitCustom();
          }}
        >
          <Input
            aria-label="Schedule for"
            disabled={busy}
            onChange={(event) => {
              setCustomValue(event.target.value);
              setError(null);
            }}
            placeholder={PLACEHOLDER}
            value={customValue}
          />
          <Button disabled={busy || customValue.trim() === ""} type="submit">
            Schedule
          </Button>
        </form>

        {preview?.ok === true ? (
          <p className="text-muted-foreground">
            Sends {formatScheduleTime(preview.at, now)}.
          </p>
        ) : null}
        {error === null ? null : (
          <p className="text-destructive" role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}

export default definePluginApp((app) => {
  app.composer.customize({
    id: "send-later",
    // Both composers that own a dispatchable submission. A queued-message
    // editor saves an edit rather than dispatching anything, and a side chat's
    // send belongs to its child thread, so neither can be scheduled — the host
    // reports that through `experimental_submit`, but there is no point
    // offering the row there.
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
    // A mount point, not a visible banner: the picker itself is the host's
    // portalled dialog, so `bare` chrome keeps an empty card out of the
    // composer stack.
    banners: [{ id: "send-later", chrome: "bare", component: SendLaterPicker }],
  });
});
