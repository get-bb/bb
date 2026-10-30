import type { ThreadCreateOrigin, ThreadTurnInitiator } from "@bb/domain";
import type { TelemetryService } from "./telemetry.js";

export type WorkInitiator =
  | "user"
  | "agent"
  | "system"
  | "plugin"
  | "automation"
  | "unknown";

export type AcceptedWorkTelemetryEvent = {
  name: "work_accepted";
  properties: { work_kind: "thread" | "message"; work_initiator: WorkInitiator };
};

export function resolveAcceptedWorkInitiator(args: {
  initiator: ThreadTurnInitiator;
  origin: ThreadCreateOrigin | null;
  originPluginId: string | null;
}): WorkInitiator {
  if (args.initiator === "agent" || args.initiator === "system")
    return args.initiator;
  if (args.originPluginId === "automations") return "automation";
  if (args.origin === "plugin" || args.originPluginId !== null) return "plugin";
  if (args.origin === "sdk") return "unknown";
  return args.initiator;
}

export function captureAcceptedWork(
  telemetry: TelemetryService,
  args: { kind: "thread" | "message"; initiator: WorkInitiator },
): void {
  telemetry.capture({
    name: "work_accepted",
    properties: { work_kind: args.kind, work_initiator: args.initiator },
  });
}
