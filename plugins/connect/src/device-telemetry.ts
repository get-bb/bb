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
export const setupAttemptSchema = z
  .object({
    id: z.string().uuid(),
    source: deviceSourceSchema,
    outcome: z.enum(["started", "failed", "cancelled", "unknown"]),
  })
  .strict();
export type SetupAttempt = z.infer<typeof setupAttemptSchema>;
type Observation = Extract<
  Parameters<BbPluginApi["internal_DO_NOT_USE_recordDeviceSetup"]>[0],
  { operation: string }
>;
function context(source: DeviceSource) {
  return source === "first_run" || source === "replay"
    ? { surface: "onboarding" as const, entry: source }
    : { surface: source, entry: null };
}

export function createConnectSetupMeasurement(
  capture: (properties: Observation) => void,
) {
  let pending: {
    id: string | null;
    source: DeviceSource;
    unknown: boolean;
  } | null = null;
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
  function begin(source: DeviceSource, id: string | null = null): void {
    pending = { id, source, unknown: false };
    record(source, "started", null);
  }
  return {
    begin,
    attempt(input: SetupAttempt) {
      if (input.outcome === "started") {
        begin(input.source, input.id);
      } else if (pending?.id === input.id) {
        const source = pending.source;
        pending = null;
        record(
          source,
          input.outcome,
          input.outcome === "cancelled"
            ? null
            : input.outcome === "failed"
              ? "authentication"
              : "request",
        );
      }
    },
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
