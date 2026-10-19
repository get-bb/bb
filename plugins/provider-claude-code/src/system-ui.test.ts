import { describe, expect, it } from "vitest";
import { createClaudeDeltaHarness, threadScope } from "./delta-test-harness.js";

describe("Claude plugin UI system pushes", () => {
  it.each([
    "ui_invalidate",
    "ui_log",
    "ui_toast",
    "ui_status",
    "ui_panes",
    "ui_scroll",
    "ui_focus",
  ])("ignores %s without creating diagnostic timeline events", (subtype) => {
    const harness = createClaudeDeltaHarness();

    const events = harness.translate({
      jsonrpc: "2.0",
      method: "sdk/message",
      params: {
        threadId: "ui-thread",
        message: {
          type: "system",
          subtype,
          session_id: "ui-session",
          uuid: "ui-message",
        },
      },
    });

    expect(events).toEqual([]);
  });

  it.each(["unrecognized_system_event", "ui_unrecognized", undefined])(
    "preserves diagnostics for an unsupported system subtype %s",
    (subtype) => {
      const harness = createClaudeDeltaHarness();

      const events = harness.translate({
        jsonrpc: "2.0",
        method: "sdk/message",
        params: {
          threadId: "ui-thread",
          message: { type: "system", subtype },
        },
      });

      expect(events).toEqual([
        expect.objectContaining({
          type: "provider/unhandled",
          rawType: "sdk/system",
          providerId: "claude-code",
          scope: threadScope(),
        }),
      ]);
    },
  );
});
