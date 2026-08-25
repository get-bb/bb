import {
  PI_EXTENSION_NOTIFICATION_MAX,
  PI_EXTENSION_STATUS_MAX,
  PI_EXTENSION_WIDGET_LINE_MAX,
  PI_EXTENSION_WIDGET_MAX,
  type PiExtensionUIState,
} from "../extension-state.js";

export type { PiExtensionUIState } from "../extension-state.js";

export const PI_EXTENSION_UI_STATE_KIND = "provider-pi/extension-ui";

export const PI_EXTENSION_KEY_MAX_BYTES = 128;
export const PI_EXTENSION_STATUS_TEXT_MAX_BYTES = 512;
export const PI_EXTENSION_NOTIFICATION_TEXT_MAX_BYTES = 1_024;
export const PI_EXTENSION_UI_TEXT_MAX_BYTES = 1_024;
export const PI_EXTENSION_WIDGET_LINE_MAX_BYTES = 1_024;
export const PI_EXTENSION_WIDGET_TEXT_MAX_BYTES = 12_288;
export const PI_EXTENSION_EDITOR_TEXT_MAX_BYTES = 16_384;
/**
 * The server caps an `extension.state` payload at 64 KiB of JSON. The
 * per-field byte caps above bound the raw text, not its JSON encoding
 * (quotes, backslashes and control characters escape to 2–6 bytes), so the
 * whole snapshot is measured as it will be sent, with headroom.
 */
export const PI_EXTENSION_SNAPSHOT_MAX_BYTES = 60 * 1024;

/**
 * Process-wide: an editor request must read as new even when its text
 * equals the previous one, and a replaced session must not restart at 1.
 */
let editorRevisionCounter = 0;

export interface PiExtensionStateController {
  /** Drop every entry and publish a null snapshot (the session is over). */
  clear(): void;
  ui: {
    notify(message: string, level?: "info" | "warning" | "error"): void;
    setEditorText(text: string): void;
    setStatus(key: string, text: string | undefined): void;
    setTitle(title: string): void;
    setWidget(
      key: string,
      lines: readonly unknown[] | undefined,
      placement?: "aboveEditor" | "belowEditor",
    ): void;
  };
}

function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function acceptsText(value: string, maxBytes: number): boolean {
  return utf8Bytes(value) <= maxBytes;
}

function upsertBoundedByKey<T extends { key: string }>(
  entries: readonly T[],
  entry: T,
  limit: number,
): T[] {
  const withoutKey = entries.filter((candidate) => candidate.key !== entry.key);
  return [...withoutKey, entry].slice(-limit);
}

function removeByKey<T extends { key: string }>(
  entries: readonly T[],
  key: string,
): T[] {
  return entries.filter((entry) => entry.key !== key);
}

function widgetTextBytes(widgets: PiExtensionUIState["widgets"]): number {
  return widgets.reduce(
    (total, widget) =>
      total +
      utf8Bytes(widget.key) +
      widget.lines.reduce((lineTotal, line) => lineTotal + utf8Bytes(line), 0),
    0,
  );
}

function emptyState(): PiExtensionUIState {
  return { statuses: [], widgets: [], notifications: [], title: null, editor: null };
}

function copyState(state: PiExtensionUIState): PiExtensionUIState {
  return {
    statuses: state.statuses.map((status) => ({ ...status })),
    widgets: state.widgets.map((widget) => ({ ...widget, lines: [...widget.lines] })),
    notifications: state.notifications.map((notification) => ({ ...notification })),
    title: state.title,
    editor: state.editor === null ? null : { ...state.editor },
  };
}

/**
 * Project pi's fire-and-forget extension UI methods (what RPC mode emits as
 * `extension_ui_request` lines with no answer) into one bounded snapshot.
 * An update that would exceed a bound is dropped whole rather than
 * truncated: a truncated status or widget line would read as the
 * extension's own text.
 */
export function createPiExtensionStateController(
  onChange: (state: PiExtensionUIState | null) => void,
): PiExtensionStateController {
  let notificationId = 0;
  let state = emptyState();
  const publish = (): void => onChange(copyState(state));
  /**
   * Apply one mutation if the snapshot it produces still fits the wire; a
   * snapshot that would be rejected downstream is not worth more than the
   * one already showing, so the update is dropped whole.
   */
  const commit = (next: PiExtensionUIState): void => {
    if (utf8Bytes(JSON.stringify(next)) > PI_EXTENSION_SNAPSHOT_MAX_BYTES) {
      return;
    }
    state = next;
    publish();
  };

  return {
    clear() {
      state = emptyState();
      onChange(null);
    },
    ui: {
      notify(message, level = "info") {
        if (!acceptsText(message, PI_EXTENSION_NOTIFICATION_TEXT_MAX_BYTES)) {
          return;
        }
        notificationId += 1;
        commit({
          ...state,
          notifications: [
            ...state.notifications,
            { id: notificationId, message, level },
          ].slice(-PI_EXTENSION_NOTIFICATION_MAX),
        });
      },
      setEditorText(text) {
        if (!acceptsText(text, PI_EXTENSION_EDITOR_TEXT_MAX_BYTES)) return;
        editorRevisionCounter += 1;
        commit({ ...state, editor: { revision: editorRevisionCounter, text } });
      },
      setStatus(key, text) {
        if (!acceptsText(key, PI_EXTENSION_KEY_MAX_BYTES)) return;
        if (text !== undefined && !acceptsText(text, PI_EXTENSION_STATUS_TEXT_MAX_BYTES)) {
          return;
        }
        commit({
          ...state,
          statuses:
            text === undefined
              ? removeByKey(state.statuses, key)
              : upsertBoundedByKey(state.statuses, { key, text }, PI_EXTENSION_STATUS_MAX),
        });
      },
      setTitle(title) {
        if (!acceptsText(title, PI_EXTENSION_UI_TEXT_MAX_BYTES)) return;
        commit({ ...state, title });
      },
      setWidget(key, content, placement) {
        if (!acceptsText(key, PI_EXTENSION_KEY_MAX_BYTES)) return;
        if (content === undefined) {
          commit({ ...state, widgets: removeByKey(state.widgets, key) });
          return;
        }
        const lines = content.slice(0, PI_EXTENSION_WIDGET_LINE_MAX);
        if (
          !lines.every(
            (line): line is string =>
              typeof line === "string" && acceptsText(line, PI_EXTENSION_WIDGET_LINE_MAX_BYTES),
          )
        ) {
          return;
        }
        const widgets = upsertBoundedByKey(
          state.widgets,
          { key, lines, placement: placement ?? "aboveEditor" },
          PI_EXTENSION_WIDGET_MAX,
        );
        if (widgetTextBytes(widgets) > PI_EXTENSION_WIDGET_TEXT_MAX_BYTES) {
          return;
        }
        commit({ ...state, widgets });
      },
    },
  };
}
