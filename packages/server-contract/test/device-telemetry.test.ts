import { serverDeviceSetupTelemetrySchema } from "../src/api/system-device-telemetry.js";
import { describe, expect, it } from "vitest";
import {
  recordTelemetryEventRequestSchema,
  createMachineRequestSchema,
} from "../src/index.js";

const properties = {
  target: "additional_machine",
  action: "credentials_accepted",
  outcome: "succeeded",
  source: "first_run",
  error_category: null,
};
const valid = (value: object) =>
  serverDeviceSetupTelemetrySchema.safeParse({
    name: "device_setup",
    properties: value,
  }).success;

describe("device telemetry privacy and milestone contract", () => {
  it("keeps credential acceptance separate from readiness and client interest", () => {
    expect(valid(properties)).toBe(true);
    expect(valid({ ...properties, action: "machine_ready" })).toBe(true);
    expect(
      valid({ ...properties, action: "setup_opened", outcome: "observed" }),
    ).toBe(true);
    expect(valid({ ...properties, action: "setup_opened" })).toBe(false);
    expect(
      valid({
        ...properties,
        target: "browser_access",
        action: "remote_connected",
        outcome: "observed",
      }),
    ).toBe(true);
    expect(
      valid({
        ...properties,
        target: "mobile",
        action: "download_clicked",
        outcome: "observed",
        platform: "ios",
      }),
    ).toBe(true);
    expect(
      valid({
        ...properties,
        target: "mobile",
        action: "download_clicked",
        outcome: "succeeded",
        platform: "ios",
      }),
    ).toBe(false);
  });
  it.each(["hostId", "device_id", "account", "url", "operation_id", "detail"])(
    "rejects extra private property %s",
    (field) => {
      expect(valid({ ...properties, [field]: "private" })).toBe(false);
    },
  );
  it("requires bounded errors only for actual failed or unknown observations", () => {
    expect(
      valid({
        ...properties,
        action: "setup_result",
        outcome: "unknown",
        error_category: "request",
      }),
    ).toBe(true);
    expect(
      valid({
        ...properties,
        action: "setup_result",
        outcome: "failed",
        error_category: null,
      }),
    ).toBe(false);
    expect(
      valid({
        ...properties,
        action: "setup_result",
        outcome: "cancelled",
        error_category: null,
      }),
    ).toBe(true);
    expect(valid({ ...properties, error_category: "request" })).toBe(false);
    expect(valid({ ...properties, source: "private-name" })).toBe(false);
  });
  it("accepts old machine requests while bounding new source attribution", () => {
    expect(
      createMachineRequestSchema.safeParse({
        machineProviderId: "manual",
        inputs: null,
      }).success,
    ).toBe(true);
    expect(
      createMachineRequestSchema.safeParse({
        machineProviderId: "manual",
        inputs: null,
        telemetrySource: "replay",
      }).success,
    ).toBe(true);
    expect(
      createMachineRequestSchema.safeParse({
        machineProviderId: "manual",
        inputs: null,
        telemetrySource: "private",
      }).success,
    ).toBe(false);
  });
});

it.each([
  { target: "browser_access", action: "service_ready", outcome: "succeeded" },
  { target: "browser_access", action: "remote_connected", outcome: "observed" },
  {
    target: "additional_machine",
    action: "machine_ready",
    outcome: "succeeded",
  },
  {
    target: "additional_machine",
    action: "credentials_accepted",
    outcome: "succeeded",
  },
  {
    target: "additional_machine",
    action: "enrollment_requested",
    outcome: "started",
  },
])("refuses client-injected authoritative $action", (milestone) => {
  expect(
    recordTelemetryEventRequestSchema.safeParse({
      name: "device_setup",
      properties: { ...properties, ...milestone },
    }).success,
  ).toBe(false);
});
