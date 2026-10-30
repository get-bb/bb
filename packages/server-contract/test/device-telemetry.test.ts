import { describe, expect, it } from "vitest";
import {
  deviceOperationPropertiesSchema,
  deviceStateTelemetrySchema,
  recordTelemetryEventRequestSchema,
  createMachineRequestSchema,
} from "../src/index.js";

const operation = {
  surface: "onboarding",
  entry: "first_run",
  step: "devices",
  resource_type: "device",
  resource_id: "additional_machine",
  operation: "enroll",
  outcome: "succeeded",
  error_category: null,
};

describe("device measurement boundary", () => {
  it("requires category-specific operations, onboarding context and bounded errors", () => {
    expect(deviceOperationPropertiesSchema.safeParse(operation).success).toBe(
      true,
    );
    for (const invalid of [
      { operation: "enable" },
      { entry: null },
      { outcome: "failed" },
      { error_category: "request" },
      { hostId: "private" },
    ])
      expect(
        deviceOperationPropertiesSchema.safeParse({ ...operation, ...invalid })
          .success,
      ).toBe(false);
    expect(
      deviceOperationPropertiesSchema.safeParse({
        ...operation,
        outcome: "unknown",
        error_category: "enrollment",
      }).success,
    ).toBe(true);
  });
  it("accepts interest while rejecting client-reported setup success and connections", () => {
    expect(
      recordTelemetryEventRequestSchema.safeParse({
        name: "onboarding_operation",
        properties: operation,
      }).success,
    ).toBe(false);
    const properties = {
      surface: "settings",
      entry: null,
      step: "devices",
      resource_type: "device",
      resource_id: "browser_access",
      state: "connected",
    };
    expect(
      deviceStateTelemetrySchema.safeParse({
        name: "onboarding_step_state",
        properties,
      }).success,
    ).toBe(true);
    expect(
      recordTelemetryEventRequestSchema.safeParse({
        name: "onboarding_step_state",
        properties,
      }).success,
    ).toBe(false);
    expect(
      recordTelemetryEventRequestSchema.safeParse({
        name: "onboarding_step_state",
        properties: { ...properties, state: "setup_open" },
      }).success,
    ).toBe(true);
    const mobile = {
      ...properties,
      resource_id: "mobile",
      state: "download_requested",
      platform: "ios",
    };
    expect(
      recordTelemetryEventRequestSchema.safeParse({
        name: "onboarding_step_state",
        properties: mobile,
      }).success,
    ).toBe(true);
    expect(
      recordTelemetryEventRequestSchema.safeParse({
        name: "onboarding_step_state",
        properties: { ...mobile, outcome: "succeeded" },
      }).success,
    ).toBe(false);
  });
  it("preserves older machine requests and bounds attribution", () => {
    const request = { machineProviderId: "manual", inputs: null };
    expect(createMachineRequestSchema.safeParse(request).success).toBe(true);
    expect(
      createMachineRequestSchema.safeParse({
        ...request,
        telemetrySource: "replay",
      }).success,
    ).toBe(true);
    expect(
      createMachineRequestSchema.safeParse({
        ...request,
        telemetrySource: "private",
      }).success,
    ).toBe(false);
  });
});
