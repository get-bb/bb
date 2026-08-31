import type { TelemetryService } from "../system/telemetry.js";
import type { BrowserMetricEvent, BrowserMetricsRecorder } from "./browser-automation.js";

export function createBrowserMetricsRecorder(telemetry: TelemetryService): BrowserMetricsRecorder {
  return {
    record(event: BrowserMetricEvent): void {
      if (event.kind === "command") {
        telemetry.capture({
          name: "browser_automation",
          properties: {
            command: event.command,
            latency_ms: event.latencyMs,
            metric: "command",
            outcome: event.outcome,
            size_bytes: event.sizeBytes,
          },
        });
        return;
      }
      telemetry.capture({
        name: "browser_automation",
        properties: {
          count: event.count,
          metric: event.kind,
        },
      });
    },
  };
}
