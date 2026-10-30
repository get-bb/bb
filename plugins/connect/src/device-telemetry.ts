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
type Observation = {
  target: "browser_access";
  action: "enable_requested" | "service_ready" | "setup_result";
  outcome: "started" | "succeeded" | "unknown" | "cancelled";
  source: DeviceSource;
  error_category: "request" | "transport" | null;
};

export function createConnectSetupMeasurement(
  capture: (properties: Observation) => void,
) {
  let pending: { source: DeviceSource; unknown: boolean } | null = null;
  function begin(source: DeviceSource): void {
    pending = { source, unknown: false };
    capture({
      target: "browser_access",
      action: "enable_requested",
      outcome: "started",
      source,
      error_category: null,
    });
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
        capture({
          target: "browser_access",
          action: "service_ready",
          outcome: "succeeded",
          source: attempt.source,
          error_category: null,
        });
      } else if (!status.enabled) {
        pending = null;
        capture({
          target: "browser_access",
          action: "setup_result",
          outcome: "cancelled",
          source: attempt.source,
          error_category: null,
        });
      } else if (status.lastError !== null && !attempt.unknown) {
        attempt.unknown = true;
        capture({
          target: "browser_access",
          action: "setup_result",
          outcome: "unknown",
          source: attempt.source,
          error_category: "transport",
        });
      }
    },
    requestLost() {
      if (!pending || pending.unknown) return;
      pending.unknown = true;
      capture({
        target: "browser_access",
        action: "setup_result",
        outcome: "unknown",
        source: pending.source,
        error_category: "request",
      });
    },
  };
}
