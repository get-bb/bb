import { describe, expect, it, vi } from "vitest";
import {
  PI_EXTENSION_NOTIFICATION_MAX,
  PI_EXTENSION_STATUS_MAX,
  PI_EXTENSION_WIDGET_MAX,
} from "../extension-state.js";
import {
  PI_EXTENSION_EDITOR_TEXT_MAX_BYTES,
  createPiExtensionStateController,
  type PiExtensionUIState,
} from "./extension-state.js";

function latestState(
  onChange: ReturnType<
    typeof vi.fn<(state: PiExtensionUIState | null) => void>
  >,
): PiExtensionUIState {
  const state = onChange.mock.calls.at(-1)?.[0];
  if (state === null || state === undefined) {
    throw new Error("Expected a Pi extension UI state snapshot");
  }
  return state;
}

describe("Pi extension state bounds", () => {
  it("caps replayable collections, preserves accepted editor bytes, and clears atomically", () => {
    const onChange = vi.fn<(state: PiExtensionUIState | null) => void>();
    const controller = createPiExtensionStateController(onChange);

    for (let index = 0; index < PI_EXTENSION_STATUS_MAX + 5; index += 1) {
      controller.ui.setStatus(`status-${index}`, `value-${index}`);
    }
    for (let index = 0; index < PI_EXTENSION_WIDGET_MAX + 5; index += 1) {
      controller.ui.setWidget(`widget-${index}`, [`line-${index}`]);
    }
    for (let index = 0; index < PI_EXTENSION_NOTIFICATION_MAX + 5; index += 1) {
      controller.ui.notify(`notice-${index}`);
    }
    const editorText = "  leading\n\ntrailing  ";
    controller.ui.setEditorText(editorText);

    const state = latestState(onChange);
    expect(state.statuses).toHaveLength(PI_EXTENSION_STATUS_MAX);
    expect(state.statuses[0]?.key).toBe("status-5");
    expect(state.widgets).toHaveLength(PI_EXTENSION_WIDGET_MAX);
    expect(state.widgets[0]?.key).toBe("widget-5");
    expect(state.notifications).toHaveLength(PI_EXTENSION_NOTIFICATION_MAX);
    expect(state.notifications[0]?.message).toBe("notice-5");
    expect(state.editor?.text).toBe(editorText);
    expect(Buffer.byteLength(JSON.stringify(state), "utf8")).toBeLessThan(
      64 * 1024,
    );

    const acceptedCallCount = onChange.mock.calls.length;
    controller.ui.setEditorText(
      "x".repeat(PI_EXTENSION_EDITOR_TEXT_MAX_BYTES + 1),
    );
    expect(onChange).toHaveBeenCalledTimes(acceptedCallCount);

    controller.clear();
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});
