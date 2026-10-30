import { describe, expect, it, vi } from "vitest";
import {
  deviceSetupEvent,
  deviceSetupPropertiesSchema,
  type ConnectDeviceSetupProperties,
} from "@bb/server-contract";
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
  target: "browser_access",
  action: "service_ready",
  outcome: "succeeded",
  source: "first_run",
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
    expect(capture).toHaveBeenCalledExactlyOnceWith(
      deviceSetupEvent(properties),
    );
    expect(() =>
      Reflect.apply(report, null, [{ ...properties, url: "private" }]),
    ).toThrow();
    expect(() =>
      Reflect.apply(report, null, [
        { ...properties, action: "remote_connected", outcome: "observed" },
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
        { ...properties, action: "remote_connected", outcome: "observed" },
        {
          ...properties,
          target: "additional_machine",
          action: "machine_ready",
        },
      ]) {
        const response = await harness.app.request(
          "/api/v1/system/telemetry/events",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(
              deviceSetupEvent(deviceSetupPropertiesSchema.parse(milestone)),
            ),
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
          body: JSON.stringify(
            deviceSetupEvent({
              ...properties,
              action: "setup_opened",
              outcome: "observed",
            }),
          ),
        },
      );
      expect(response.status).toBe(200);
      expect(capture).toHaveBeenCalledTimes(1);
    } finally {
      await harness.cleanup();
    }
  });
});
