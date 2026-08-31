import { describe, expect, it } from "vitest";
import {
  BROWSER_AUTOMATION_MAX_AX_DEPTH,
  BROWSER_AUTOMATION_MAX_SCREENSHOT_BYTES,
  browserAutomationCommandResultSchema,
  browserAutomationCommandSchema,
  formatBrowserSnapshotRef,
  parseBrowserSnapshotRef,
  browserAutomationOpenMessageLenientSchema,
  browserAutomationOpenMessageSchema,
  browserAutomationUrlSchema,
  clientMessageSchema,
} from "../src/index.js";

function zeroBase64(byteLength: number): string {
  const encodedLength = Math.ceil(byteLength / 3) * 4;
  const remainder = byteLength % 3;
  const padding = remainder === 0 ? 0 : 3 - remainder;
  return "A".repeat(encodedLength - padding) + "=".repeat(padding);
}

describe("browser automation contracts", () => {
  it("accepts only http(s) URLs for automation targets", () => {
    expect(
      browserAutomationUrlSchema.safeParse("https://example.test/path").success,
    ).toBe(true);
    expect(
      browserAutomationUrlSchema.safeParse("http://localhost:3000/").success,
    ).toBe(true);
    for (const rejected of [
      "",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "about:blank",
      "example.test",
      `https://example.test/${"a".repeat(5000)}`,
    ]) {
      expect(browserAutomationUrlSchema.safeParse(rejected).success).toBe(false);
    }
  });

  it("parses desktop capability and lifecycle replies as client messages without accepting tab adoption fields", () => {
    expect(
      clientMessageSchema.safeParse({
        type: "browser-automation.capability",
        windowId: "window-a",
      }).success,
    ).toBe(true);
    expect(
      clientMessageSchema.safeParse({
        type: "browser-automation.capability-unavailable",
      }).success,
    ).toBe(true);
    expect(
      clientMessageSchema.safeParse({
        type: "browser-automation.open-ready",
        requestId: "req-1",
        targetId: "bt_1",
        windowId: "window-a",
        tabId: "tab-1",
        url: "https://example.test/",
      }).success,
    ).toBe(true);
    expect(
      clientMessageSchema.safeParse({
        type: "browser-automation.open-failed",
        requestId: "req-1",
        targetId: "bt_1",
        code: "thread_not_open",
      }).success,
    ).toBe(true);
    expect(
      clientMessageSchema.safeParse({
        type: "browser-automation.target-closed",
        targetId: "bt_1",
        windowId: "window-a",
        tabId: "tab-1",
      }).success,
    ).toBe(true);

    expect(
      clientMessageSchema.safeParse({
        type: "browser-automation.capability",
        windowId: "window-a",
        tabs: [{ tabId: "existing-user-tab" }],
      }).success,
    ).toBe(false);
    expect(
      clientMessageSchema.safeParse({
        type: "browser-automation.open-ready",
        requestId: "req-1",
        targetId: "bt_1",
        windowId: "window-a",
        tabId: "tab-1",
        url: "https://example.test/",
        threadId: "thr_forged",
      }).success,
    ).toBe(false);
    expect(
      clientMessageSchema.safeParse({
        type: "browser-automation.open-failed",
        requestId: "req-1",
        targetId: "bt_1",
        code: "anything",
      }).success,
    ).toBe(false);
  });

  it("strictly consumes every bounded command and rejects oversized command payloads", () => {
    const commands = [
      { kind: "navigate", url: "https://example.test/next" },
      { kind: "wait", text: "Saved" },
      { kind: "snapshot" },
      { kind: "click", ref: "e0g1r1", snapshotGeneration: 1 },
      { kind: "type", ref: "e0g1r1", snapshotGeneration: 1, text: "hello" },
      { kind: "press", key: "Enter" },
      { kind: "select", ref: "e0g1r1", snapshotGeneration: 1, value: "Admin" },
      { kind: "screenshot" },
    ];
    for (const command of commands) {
      expect(browserAutomationCommandSchema.safeParse(command).success).toBe(true);
    }
    expect(browserAutomationCommandSchema.safeParse({
      kind: "type",
      ref: "e0g1r1",
      snapshotGeneration: 1,
      text: "x".repeat(16_385),
    }).success).toBe(false);
    expect(browserAutomationCommandSchema.safeParse({ kind: "snapshot", script: "document.body" }).success).toBe(false);
  });

  it("owns snapshot-ref grammar and bounded key validation", () => {
    const ref = formatBrowserSnapshotRef({
      navigationEpoch: 12,
      snapshotGeneration: 34,
      refNumber: 56,
    });
    expect(ref).toBe("e12g34r56");
    expect(parseBrowserSnapshotRef(ref)).toEqual({
      navigationEpoch: 12,
      snapshotGeneration: 34,
      refNumber: 56,
      ref,
    });
    for (const invalid of ["e1g2", "e1g-2r3", "x1g2r3", "e1g2r3extra", `e${"9".repeat(40)}g2r3`]) {
      expect(parseBrowserSnapshotRef(invalid)).toBeNull();
    }
    for (const key of ["Enter", "Tab", "Escape", "Space", "PageDown", "PageUp", "ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown", "Backspace", "a", "?"]) {
      expect(browserAutomationCommandSchema.safeParse({ kind: "press", key }).success).toBe(true);
    }
    for (const key of ["Delete", "Control", "EnterEnter", "é", ""]) {
      expect(browserAutomationCommandSchema.safeParse({ kind: "press", key }).success).toBe(false);
    }
  });

  it("rejects deep snapshots and oversized screenshots at the realtime boundary", () => {
    let node = {
      children: [] as object[],
      name: "leaf",
      role: "group",
      visible: true,
    };
    for (let depth = 0; depth < BROWSER_AUTOMATION_MAX_AX_DEPTH; depth += 1) {
      node = { children: [node], name: `level-${depth}`, role: "group", visible: true };
    }
    expect(browserAutomationCommandResultSchema.safeParse({
      kind: "snapshot",
      generation: 1,
      navigationEpoch: 0,
      ready: true,
      url: "https://example.test/",
      nodes: [node],
    }).success).toBe(false);
    const screenshot = {
      kind: "screenshot",
      mimeType: "image/png",
      navigationEpoch: 0,
      ready: true,
      url: "https://example.test/",
    } as const;
    expect(browserAutomationCommandResultSchema.safeParse({
      ...screenshot,
      base64: zeroBase64(BROWSER_AUTOMATION_MAX_SCREENSHOT_BYTES),
    }).success).toBe(true);
    expect(browserAutomationCommandResultSchema.safeParse({
      ...screenshot,
      base64: zeroBase64(BROWSER_AUTOMATION_MAX_SCREENSHOT_BYTES + 1),
    }).success).toBe(false);
    expect(browserAutomationCommandResultSchema.safeParse({
      ...screenshot,
      base64: "A",
    }).success).toBe(false);
  });

  it("keeps server open messages strict on the wire and lenient for older clients", () => {
    const message = {
      type: "browser-automation.open",
      requestId: "req-1",
      targetId: "bt_1",
      threadId: "thr_1",
      url: "https://example.test/",
    };
    expect(browserAutomationOpenMessageSchema.safeParse(message).success).toBe(
      true,
    );
    expect(
      browserAutomationOpenMessageSchema.safeParse({
        ...message,
        futureField: 1,
      }).success,
    ).toBe(false);
    expect(
      browserAutomationOpenMessageLenientSchema.safeParse({
        ...message,
        futureField: 1,
      }).success,
    ).toBe(true);
    expect(
      browserAutomationOpenMessageSchema.safeParse({
        ...message,
        url: "file:///tmp/page.html",
      }).success,
    ).toBe(false);
  });
});
