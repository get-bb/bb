import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { ConnectStatus } from "./types.js";

export const deviceSourceSchema = z.enum([
  "first_run",
  "replay",
  "settings",
  "cli",
  "other",
  "unknown",
]);
export type DeviceSource = z.infer<typeof deviceSourceSchema>;
type Observation = Parameters<
  BbPluginApi["internal_DO_NOT_USE_recordDeviceSetup"]
>[0];
function context(source: DeviceSource) {
  return source === "first_run" || source === "replay"
    ? { surface: "onboarding" as const, entry: source }
    : { surface: source, entry: null };
}

export function createConnectSetupMeasurement(
  capture: (properties: Observation) => void,
) {
  let pending: { source: DeviceSource; unknown: boolean } | null = null;
  function record(
    source: DeviceSource,
    outcome: Observation["outcome"],
    error_category: Observation["error_category"] = null,
  ) {
    capture({
      step: "devices",
      resource_type: "device",
      resource_id: "browser_access",
      operation: "enable",
      ...context(source),
      outcome,
      error_category,
    });
  }
  function begin(source: DeviceSource): void {
    pending = { source, unknown: false };
    record(source, "started", null);
  }
  return {
    begin,
    beginIfIdle(source: DeviceSource) {
      if (pending === null) begin(source);
    },
    observe(status: Pick<ConnectStatus, "state" | "enabled" | "lastError">) {
      const attempt = pending;
      if (!attempt) return;
      if (status.state === "connected" && status.enabled) {
        pending = null;
        record(attempt.source, "succeeded", null);
      } else if (!status.enabled) {
        pending = null;
        record(attempt.source, "cancelled", null);
      } else if (status.lastError !== null && !attempt.unknown) {
        attempt.unknown = true;
        record(attempt.source, "unknown", "transport");
      }
    },
    requestLost() {
      if (!pending || pending.unknown) return;
      pending.unknown = true;
      record(pending.source, "unknown", "request");
    },
  };
}
