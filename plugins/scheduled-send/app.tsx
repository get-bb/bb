// bb-plugin-scheduled-send frontend — "Send later…" in the composer's + menu.
//
// The composer surface has no way to submit a draft, so this plugin does not
// try to intercept the send. It reads the draft, sends it itself through the
// backend with `holdUntil`, and clears the composer. Everything after that —
// the held card above the composer, the countdown, Release now, Cancel — is
// core's hold UI, which this plugin never duplicates.
//
// The + menu row cannot render a form (rows are host-rendered, and the app
// contract has no dialog API), so the row opens a plugin-owned composer
// banner. A module-level store connects the two: they are separate components
// mounted by the host, and both identify the composer they belong to by scope.
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { Button } from "@bb/shared-ui/button";
import { Input } from "@bb/shared-ui/input";
import {
  definePluginApp,
  useComposer,
  useComposerView,
  useRpc,
  type ComposerStructuredDraft,
  type ComposerView,
  type PluginComposerScope,
} from "@get-bb/plugin-sdk/app";
import type { scheduledSendRpcContract } from "./server.js";
import {
  formatScheduleTime,
  listSchedulePresets,
  parseScheduleTime,
} from "./schedule-time.js";

/** Identifies one composer instance, so a banner only opens where it was asked for. */
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
/**
 * Mention pills are only observable through `richText.onDraftChange`, and only
 * as offsets and labels — not as the resolved resources a send needs. The
 * count is kept so the banner can say so before the user schedules.
 */
const draftMentionCounts = new Map<string, number>();

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
  draftMentionCounts.clear();
  notify();
}

function recordDraftMentions(
  draft: ComposerStructuredDraft,
  view: ComposerView,
): void {
  const key = composerScopeKey(view.scope);
  if (draftMentionCounts.get(key) === draft.mentions.length) return;
  draftMentionCounts.set(key, draft.mentions.length);
  notify();
}

function useSendLaterOpen(scopeKey: string): boolean {
  const snapshot = useCallback(() => openScopeKey === scopeKey, [scopeKey]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

function useDraftMentionCount(scopeKey: string): number {
  const snapshot = useCallback(
    () => draftMentionCounts.get(scopeKey) ?? 0,
    [scopeKey],
  );
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const PLACEHOLDER = "30m, 2h, 9am, tomorrow 09:30, 2026-08-26T09:00";

function SendLaterBanner() {
  const composer = useComposer();
  const view = useComposerView();
  const rpc = useRpc<typeof scheduledSendRpcContract>();
  const scopeKey = composerScopeKey(view.scope);
  const isOpen = useSendLaterOpen(scopeKey);
  const mentionCount = useDraftMentionCount(scopeKey);
  const [customValue, setCustomValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Presets and the preview are relative to a clock that has to keep moving:
  // a banner left open for ten minutes must not schedule "in 1 hour" from
  // when it was opened.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!isOpen) return;
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, [isOpen]);

  // The draft can leave from under the banner — the user sends it normally, or
  // clears it. There is nothing left to schedule, so stop offering to.
  useEffect(() => {
    if (isOpen && view.draft.isEmpty) closeSendLater();
  }, [isOpen, view.draft.isEmpty]);

  if (!isOpen) return null;

  async function schedule(at: number): Promise<void> {
    if (view.scope.kind !== "thread") return;
    const text = composer.text.trim();
    if (text === "") {
      setError("Type a message before scheduling it.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await rpc.call("scheduleSend", {
        threadId: view.scope.threadId,
        text,
        holdUntil: at,
      });
      composer.clear();
      closeSendLater();
      setCustomValue("");
      toast.success(`Sending ${formatScheduleTime(at, Date.now())}`);
    } catch (scheduleError: unknown) {
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
    <div
      aria-label="Send later"
      className="flex flex-col gap-2 text-xs"
      role="group"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-foreground">Send later</span>
        <Button
          disabled={busy}
          onClick={closeSendLater}
          size="sm"
          type="button"
          variant="ghost"
        >
          Cancel
        </Button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {listSchedulePresets(now).map((preset) => (
          <Button
            disabled={busy}
            key={preset.id}
            onClick={() => void schedule(preset.at)}
            size="sm"
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
        className="flex items-center gap-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          submitCustom();
        }}
      >
        <Input
          aria-label="Schedule for"
          className="h-7 text-xs"
          disabled={busy}
          onChange={(event) => {
            setCustomValue(event.target.value);
            setError(null);
          }}
          placeholder={PLACEHOLDER}
          value={customValue}
        />
        <Button
          disabled={busy || customValue.trim() === ""}
          size="sm"
          type="submit"
        >
          Schedule
        </Button>
      </form>

      {preview?.ok === true ? (
        <p className="text-muted-foreground">
          Sends {formatScheduleTime(preview.at, now)}.
        </p>
      ) : null}
      {mentionCount > 0 ? (
        <p className="text-muted-foreground">
          Mentions are scheduled as plain text.
        </p>
      ) : null}
      {view.draft.attachmentCount > 0 ? (
        <p className="text-muted-foreground">
          Attachments are not included in a scheduled send.
        </p>
      ) : null}
      {error === null ? null : (
        <p className="text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export default definePluginApp((app) => {
  app.composer.customize({
    id: "send-later",
    // Thread composers only. A new-thread send-later would have to create the
    // thread itself, and the composer surface exposes none of the execution
    // selections (provider, model, environment) that composer owns — the
    // scheduled thread would silently run with different settings than the
    // one the user was looking at.
    scopes: ["thread"],
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
    banners: [{ id: "send-later", chrome: "card", component: SendLaterBanner }],
    richText: { onDraftChange: recordDraftMentions },
  });
});
