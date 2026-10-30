import { describe, expect, it, vi } from "vitest";
import { type ConnectDeviceSetupProperties } from "@bb/server-contract";
import { createConnectDeviceSetupRecorder } from "../../../src/services/plugins/plugin-device-setup-telemetry.js";
import type { TelemetryService } from "../../../src/services/system/telemetry.js";
import { createTestAppHarness } from "../../helpers/test-app.js";

const owner = {
  id: "connect",
  provenance: "builtin",
  sourceKind: "builtin",
  sourceBuiltinName: "connect",
} as const;
const properties: ConnectDeviceSetupProperties = {
  step: "devices",
  resource_type: "device",
  resource_id: "browser_access",
  operation: "enable",
  outcome: "succeeded",
  surface: "onboarding",
  entry: "first_run",
  error_category: null,
};

describe("trusted Connect lifecycle reporting", () => {
  it("binds only builtin provenance and validates the narrow owner payload under opt-out", () => {
    const capture = vi.fn<TelemetryService["capture"]>();
    let enabled = true;
    const telemetry: TelemetryService = {
      capture,
      isEnabled: () => enabled,
      setEnabled: (next) => {
        enabled = next;
      },
    };
    expect(
      createConnectDeviceSetupRecorder(telemetry, {
        ...owner,
        provenance: "direct",
        sourceKind: "path",
      }),
    ).toBeNull();
    expect(
      createConnectDeviceSetupRecorder(telemetry, {
        ...owner,
        sourceBuiltinName: "other",
      }),
    ).toBeNull();
    expect(
      createConnectDeviceSetupRecorder(telemetry, { ...owner, id: "other" }),
    ).toBeNull();
    const report = createConnectDeviceSetupRecorder(telemetry, owner);
    if (!report) throw new Error("Missing trusted recorder");
    report(properties);
    expect(capture).toHaveBeenCalledExactlyOnceWith({
      name: "onboarding_operation",
      properties,
    });
    expect(() =>
      Reflect.apply(report, null, [{ ...properties, url: "private" }]),
    ).toThrow();
    expect(() =>
      Reflect.apply(report, null, [
        {
          ...properties,
          resource_id: "additional_machine",
          operation: "enroll",
        },
      ]),
    ).toThrow();
    enabled = false;
    report(properties);
    expect(capture).toHaveBeenCalledTimes(1);
    enabled = true;
    report(properties);
    expect(capture).toHaveBeenCalledTimes(2);
  });

  it("rejects confirmed milestones on the client endpoint while retaining interest observations", async () => {
    const harness = await createTestAppHarness();
    try {
      const capture = vi.fn<TelemetryService["capture"]>();
      harness.deps.telemetry = {
        capture,
        isEnabled: () => true,
        setEnabled: () => {},
      };
      for (const milestone of [
        properties,
        {
          ...properties,
          resource_id: "additional_machine",
          operation: "enroll",
        },
      ]) {
        const response = await harness.app.request(
          "/api/v1/system/telemetry/events",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              name: "onboarding_operation",
              properties: milestone,
            }),
          },
        );
        expect(response.status).toBe(400);
      }
      expect(capture).not.toHaveBeenCalled();
      const response = await harness.app.request(
        "/api/v1/system/telemetry/events",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: "onboarding_step_state",
            properties: {
              surface: "onboarding",
              entry: "first_run",
              step: "devices",
              resource_type: "device",
              resource_id: "browser_access",
              state: "setup_open",
            },
          }),
        },
      );
      expect(response.status).toBe(200);
      expect(capture).toHaveBeenCalledTimes(1);
    } finally {
      await harness.cleanup();
    }
  });
});
