import { describe, expect, it, vi } from "vitest";
import { createConnectSetupMeasurement } from "./device-telemetry.js";

describe("Connect setup milestones", () => {
  it("retains the initiating source through transport uncertainty and deduplicates reconnects", () => {
    const capture = vi.fn();
    const measurement = createConnectSetupMeasurement(capture);
    measurement.begin("first_run");
    measurement.observe({
      state: "reconnecting",
      enabled: true,
      lastError: null,
    });
    expect(capture).toHaveBeenCalledTimes(1);
    measurement.observe({
      state: "reconnecting",
      enabled: true,
      lastError: "private failure",
    });
    measurement.observe({
      state: "reconnecting",
      enabled: true,
      lastError: "private failure",
    });
    measurement.observe({ state: "connected", enabled: true, lastError: null });
    measurement.observe({
      state: "reconnecting",
      enabled: true,
      lastError: null,
    });
    measurement.observe({ state: "connected", enabled: true, lastError: null });
    expect(
      capture.mock.calls.map(([event]) => [
        event.action,
        event.outcome,
        event.source,
      ]),
    ).toEqual([
      ["enable_requested", "started", "first_run"],
      ["setup_result", "unknown", "first_run"],
      ["service_ready", "succeeded", "first_run"],
    ]);
    expect(JSON.stringify(capture.mock.calls)).not.toContain("private failure");
  });
  it("does not invent an enable request for startup readiness", () => {
    const capture = vi.fn();
    const measurement = createConnectSetupMeasurement(capture);
    measurement.observe({ state: "connected", enabled: true, lastError: null });
    measurement.observe({ state: "connected", enabled: true, lastError: null });
    expect(capture).toHaveBeenCalledExactlyOnceWith({
      target: "browser_access",
      action: "service_ready",
      outcome: "succeeded",
      source: "unknown",
      error_category: null,
    });
  });
  it("treats request loss as unknown and actual disabling as cancellation", () => {
    const capture = vi.fn();
    const measurement = createConnectSetupMeasurement(capture);
    measurement.begin("cli");
    measurement.requestLost();
    measurement.requestLost();
    measurement.observe({
      state: "disconnected",
      enabled: false,
      lastError: null,
    });
    expect(capture.mock.calls.map(([event]) => event.outcome)).toEqual([
      "started",
      "unknown",
      "cancelled",
    ]);
  });
});
