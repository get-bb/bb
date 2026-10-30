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
        event.operation,
        event.outcome,
        event.entry,
      ]),
    ).toEqual([
      ["enable", "started", "first_run"],
      ["enable", "unknown", "first_run"],
      ["enable", "succeeded", "first_run"],
    ]);
    expect(JSON.stringify(capture.mock.calls)).not.toContain("private failure");
  });
  it("does not count startup or refreshed readiness as a setup success", () => {
    const capture = vi.fn();
    const measurement = createConnectSetupMeasurement(capture);
    measurement.observe({ state: "connected", enabled: true, lastError: null });
    measurement.observe({ state: "connected", enabled: true, lastError: null });
    expect(capture).not.toHaveBeenCalled();
    measurement.beginIfIdle("unknown");
    measurement.observe({ state: "connected", enabled: true, lastError: null });
    measurement.observe({ state: "connected", enabled: true, lastError: null });
    expect(capture.mock.calls.map(([event]) => event.outcome)).toEqual([
      "started",
      "succeeded",
    ]);
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
