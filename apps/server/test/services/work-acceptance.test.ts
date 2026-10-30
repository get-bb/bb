import { describe, expect, it } from "vitest";
import { recordTelemetryEventRequestSchema } from "@bb/server-contract";
import {
  captureAcceptedWork,
  resolveAcceptedWorkInitiator,
} from "../../src/services/system/work-acceptance.js";
import type { TelemetryEvent } from "../../src/services/system/telemetry.js";

describe("accepted work contract", () => {
  it("uses existing plugin precedence and leaves unidentified SDK callers unknown", () => {
    expect(
      resolveAcceptedWorkInitiator({
        initiator: "user",
        origin: "app",
        originPluginId: null,
      }),
    ).toBe("user");
    expect(
      resolveAcceptedWorkInitiator({
        initiator: "user",
        origin: "sdk",
        originPluginId: null,
      }),
    ).toBe("unknown");
    expect(
      resolveAcceptedWorkInitiator({
        initiator: "agent",
        origin: "plugin",
        originPluginId: "suggestions",
      }),
    ).toBe("plugin");
    expect(
      resolveAcceptedWorkInitiator({
        initiator: "user",
        origin: "plugin",
        originPluginId: "suggestions",
      }),
    ).toBe("plugin");
    expect(
      resolveAcceptedWorkInitiator({
        initiator: "user",
        origin: "plugin",
        originPluginId: "automations",
      }),
    ).toBe("automation");
  });
  it("emits only server-owned acceptance, excluding client-forged events", () => {
    const events: TelemetryEvent[] = [];
    captureAcceptedWork(
      {
        capture: (event) => events.push(event),
        isEnabled: () => true,
        setEnabled: () => {},
      },
      { kind: "message", initiator: "user" },
    );
    expect(events).toEqual([
      {
        name: "work_accepted",
        properties: { work_kind: "message", work_initiator: "user" },
      },
    ]);
    expect(recordTelemetryEventRequestSchema.safeParse(events[0]).success).toBe(
      false,
    );
  });
});
