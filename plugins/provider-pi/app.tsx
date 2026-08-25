import { useEffect, useRef } from "react";
import { toast } from "sonner";
import {
  definePluginApp,
  useComposer,
  type ExperimentalProviderExtensionStateProps,
} from "@get-bb/plugin-sdk/app";
import {
  PI_EXTENSION_UI_STATE_NAME,
  piExtensionUIStateSchema,
  type PiExtensionUIState,
} from "./src/extension-state.js";
import { PiModelSettingsEditor } from "./src/model-settings-editor.js";
import "./app.css";

type PiNotification = PiExtensionUIState["notifications"][number];

/** How long a notification stays up: errors linger, the rest pass. */
function notificationDurationMs(level: PiNotification["level"]): number {
  return level === "error" ? 10_000 : 5_000;
}

function showNotification(notification: PiNotification): void {
  const show =
    notification.level === "error"
      ? toast.error
      : notification.level === "warning"
        ? toast.warning
        : toast.info;
  show(notification.message, {
    id: `pi-extension-notification-${notification.id}`,
    closeButton: true,
    duration: notificationDurationMs(notification.level),
  });
}

function parseState(payload: unknown): PiExtensionUIState | null {
  const parsed = piExtensionUIStateSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

/**
 * What each thread's renderer has already acted on, kept outside the
 * component: a remount (navigating away and back, a second pane, a kind
 * entry flickering) must not re-apply an editor request or re-toast a
 * notification, and one thread's marks must not bleed into another's. A null
 * snapshot is the session ending; the next session's counters restart, so
 * the marks restart with them.
 */
interface ThreadMarks {
  editorRevision: number | null;
  notificationId: number;
}
const threadMarks = new Map<string, ThreadMarks>();

/**
 * The marks for a thread, seeded from the snapshot present when the thread
 * is first seen: what a persisted snapshot already holds is history (the
 * TUI showed it at the time, the composer draft may have moved on), not
 * news to act on.
 */
function marksFor(threadId: string, state: PiExtensionUIState | null): ThreadMarks {
  let marks = threadMarks.get(threadId);
  if (marks === undefined) {
    marks = {
      editorRevision: state?.editor?.revision ?? null,
      notificationId: Math.max(0, ...(state?.notifications ?? []).map(({ id }) => id)),
    };
    threadMarks.set(threadId, marks);
  }
  return marks;
}

/**
 * What Pi's extensions put beside the composer. Statuses, widgets and the
 * title render in place; a notification is transient, like pi's own, so it
 * goes to the app's toaster instead — once, when it arrives.
 */
function PiExtensionState({ payload, placement, threadId }: ExperimentalProviderExtensionStateProps) {
  const composer = useComposer();
  const state = parseState(payload);
  const editor = state?.editor ?? null;
  const notifications = state?.notifications ?? null;
  const marks = marksFor(threadId, state);

  useEffect(() => {
    if (placement !== "aboveEditor") return;
    if (state === null) {
      // The session ended: its successor counts from 1 again.
      marks.editorRevision = null;
      marks.notificationId = 0;
      return;
    }
    if (editor !== null && editor.revision !== marks.editorRevision) {
      marks.editorRevision = editor.revision;
      composer.setText(editor.text);
    }
    for (const notification of notifications ?? []) {
      if (notification.id <= marks.notificationId) continue;
      marks.notificationId = notification.id;
      showNotification(notification);
    }
  }, [composer, editor, marks, notifications, placement, state]);

  if (state === null) return null;
  const widgets = state.widgets.filter((widget) => widget.placement === placement);
  const showMetadata =
    placement === "aboveEditor" && (state.statuses.length > 0 || state.title !== null);
  if (!showMetadata && widgets.length === 0) return null;

  return (
    <div className="pi-extension-state" data-pi-extension-placement={placement}>
      {showMetadata ? (
        <div className="pi-extension-state__metadata">
          {state.title !== null ? (
            <div className="pi-extension-state__title">{state.title}</div>
          ) : null}
          {state.statuses.map((status) => (
            <div className="pi-extension-state__status" key={status.key}>
              {status.text}
            </div>
          ))}
        </div>
      ) : null}
      {widgets.map((widget) => (
        <div className="pi-extension-state__widget" key={widget.key}>
          {widget.lines.map((line, index) => (
            <div key={`${widget.key}:${index}`}>{line || " "}</div>
          ))}
        </div>
      ))}
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.settingsSection({
    id: "models",
    title: "Models",
    description: "Choose the authenticated models available in Pi's picker and model cycling.",
    component: PiModelSettingsEditor,
  });
  app.slots.experimental_providerExtensionState({
    name: PI_EXTENSION_UI_STATE_NAME,
    component: PiExtensionState,
  });
});
