import type {
  FeatureFlags,
  ThreadCreateOrigin,
  ThreadTurnInitiator,
} from "@bb/domain";
import type { TelemetryInitiator } from "../system/telemetry.js";

const AUTOMATIONS_PLUGIN_ID = "automations";

export function resolveTelemetryInitiator(args: {
  origin: ThreadCreateOrigin | null;
  originPluginId: string | null;
  initiator: ThreadTurnInitiator;
}): TelemetryInitiator {
  if (args.origin === "plugin") {
    return args.originPluginId === AUTOMATIONS_PLUGIN_ID
      ? "automation"
      : "plugin";
  }
  if (args.initiator === "agent") return "agent";
  if (args.initiator === "system") return "system";
  return "user";
}

export function initiatorTelemetryProperty(
  featureFlags: FeatureFlags,
  initiator: TelemetryInitiator,
): { initiator?: TelemetryInitiator } {
  return featureFlags.initiatorTelemetry ? { initiator: initiator } : {};
}
