import { defaultFeatureFlags } from "@bb/domain";
import { describe, expect, it } from "vitest";
import {
  resolveTelemetryInitiator,
  initiatorTelemetryProperty,
} from "../../src/services/threads/telemetry-initiator.js";

describe("resolveTelemetryInitiator", () => {
  it.each([
    [
      { origin: "plugin", originPluginId: "automations", initiator: "user" },
      "automation",
    ],
    [
      { origin: "plugin", originPluginId: "scheduled-send", initiator: "user" },
      "plugin",
    ],
    [
      { origin: "plugin", originPluginId: "automations", initiator: "agent" },
      "automation",
    ],
    [{ origin: "app", originPluginId: null, initiator: "user" }, "user"],
    [{ origin: "cli", originPluginId: null, initiator: "agent" }, "agent"],
    [{ origin: "sdk", originPluginId: null, initiator: "system" }, "system"],
    [{ origin: null, originPluginId: null, initiator: "user" }, "user"],
  ] as const)("maps %o to %s", (args, expected) => {
    expect(resolveTelemetryInitiator(args)).toBe(expected);
  });
});

describe("initiatorTelemetryProperty", () => {
  it("sends the fixed value by default", () => {
    expect(
      initiatorTelemetryProperty(defaultFeatureFlags, "automation"),
    ).toEqual({ initiator: "automation" });
  });

  it("is empty when the flag is turned off", () => {
    expect(
      initiatorTelemetryProperty(
        { ...defaultFeatureFlags, initiatorTelemetry: false },
        "user",
      ),
    ).toEqual({});
  });
});
