import { describe, expect, it } from "vitest";
import {
  unknownWorkSuggestionAttribution,
  noWorkSuggestionAttribution,
  recordTelemetryEventRequestSchema,
  type WorkSuggestionAttribution,
} from "@bb/server-contract";
import {
  captureAcceptedWork,
  resolveAcceptedWorkInitiator,
} from "../../src/services/system/work-acceptance.js";
import type { TelemetryEvent } from "../../src/services/system/telemetry.js";

const suggestion: WorkSuggestionAttribution = {
  origin: "agent_context",
  surface: "continuation",
  template_key: null,
  content_revision: "baseline",
  edit_state: "edited",
};

describe("accepted work contract", () => {
  it("keeps actors independent of wrappers without claiming backend plugin work is user work", () => {
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
    ).toBe("agent");
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
  it("counts one accepted message and a distinct suggestion observation, excluding private references", () => {
    const events: TelemetryEvent[] = [];
    const telemetry = {
      capture: (event: TelemetryEvent) => events.push(event),
      isEnabled: () => true,
      setEnabled: () => {},
    };
    captureAcceptedWork(telemetry, {
      kind: "message",
      initiator: "user",
      suggestion,
    });
    expect(events.map((event) => event.name)).toEqual([
      "work_accepted",
      "onboarding_suggestion",
    ]);
    expect(events[0]).toMatchObject({
      properties: {
        work_kind: "message",
        work_initiator: "user",
        suggestion_origin: "agent_context",
        suggestion_edit_state: "edited",
      },
    });
    expect(events[1]).toEqual({
      name: "onboarding_suggestion",
      properties: {
        action: "send_accepted",
        surface: "continuation",
        origin: "agent_context",
        target: "current_thread",
        fallback_reason: "none",
        template_key: null,
        content_revision: "baseline",
        edit_state: "edited",
      },
    });
    expect(recordTelemetryEventRequestSchema.safeParse(events[0]).success).toBe(
      false,
    );
    expect(recordTelemetryEventRequestSchema.safeParse(events[1]).success).toBe(
      false,
    );
    events.length = 0;
    captureAcceptedWork(telemetry, {
      kind: "message",
      initiator: "plugin",
      suggestion,
    });
    expect(events.map((event) => event.name)).toEqual(["work_accepted"]);
  });
  it("distinguishes a legacy unknown draft from explicitly unsuggested work", () => {
    const events: TelemetryEvent[] = [];
    const telemetry = {
      capture: (event: TelemetryEvent) => events.push(event),
      isEnabled: () => true,
      setEnabled: () => {},
    };
    captureAcceptedWork(telemetry, {
      kind: "thread",
      initiator: "user",
      suggestion: unknownWorkSuggestionAttribution(),
    });
    captureAcceptedWork(telemetry, {
      kind: "thread",
      initiator: "user",
      suggestion: noWorkSuggestionAttribution(),
    });
    expect(
      events.map((event) =>
        event.name === "work_accepted"
          ? event.properties.suggestion_origin
          : null,
      ),
    ).toEqual(["unknown", "none"]);
  });
});
