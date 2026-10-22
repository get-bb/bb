import type { AppUpdateTelemetry } from "../../src/services/system/app-update-telemetry.js";

export interface FakeAppUpdateTelemetry extends AppUpdateTelemetry {
  calls: Array<{ method: string; args: unknown }>;
}

export function createFakeAppUpdateTelemetry(): FakeAppUpdateTelemetry {
  const calls: FakeAppUpdateTelemetry["calls"] = [];
  return {
    calls,
    async restarting(args) {
      calls.push({ method: "restarting", args });
    },
    async reportFinished(args) {
      calls.push({ method: "reportFinished", args });
    },
    started(args) {
      calls.push({ method: "started", args });
    },
  };
}
