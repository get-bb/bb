import type { ThreadCreateOrigin, ThreadTurnInitiator } from "@bb/domain";
import { resolveTelemetryInitiator } from "../threads/telemetry-initiator.js";
import type { TelemetryInitiator, TelemetryService } from "./telemetry.js";

export type WorkInitiator = TelemetryInitiator | "unknown";

export type AcceptedWorkTelemetryEvent = {
  name: "work_accepted";
  properties: {
    work_kind: "thread" | "message";
    provider: string;
    work_initiator: WorkInitiator;
  };
};

export function resolveAcceptedWorkInitiator(args: {
  initiator: ThreadTurnInitiator;
  origin: ThreadCreateOrigin | null;
  originPluginId: string | null;
}): WorkInitiator {
  if (args.origin === "sdk" && args.initiator === "user") return "unknown";
  return resolveTelemetryInitiator(args);
}

export function captureAcceptedWork(
  telemetry: TelemetryService,
  args: {
    kind: "thread" | "message";
    initiator: WorkInitiator;
    provider: string;
  },
): void {
  telemetry.capture({
    name: "work_accepted",
    properties: {
      work_kind: args.kind,
      work_initiator: args.initiator,
      provider: args.provider,
    },
  });
}
