import { describe, expect, it, vi } from "vitest";
import { createBrowserMetricsRecorder } from "../../../src/services/browser/browser-metrics.js";

describe("Browser metrics", () => {
  it("records only bounded operational fields", () => {
    const capture = vi.fn();
    const metrics = createBrowserMetricsRecorder({ capture });
    metrics.record({ kind: "command", command: "type", latencyMs: 12, outcome: "success", sizeBytes: 0 });
    metrics.record({ kind: "target_closed_after_success", count: 1 });
    const serialized = JSON.stringify(capture.mock.calls);
    expect(serialized).toContain("browser_automation");
    expect(serialized).not.toMatch(/url|path|base64|ref|text|key|error|value|retry|workflow/i);
    expect(capture).toHaveBeenCalledTimes(2);
  });
});
