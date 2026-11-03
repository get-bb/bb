// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDeviceSetupTracking } from "./useDeviceSetupTracking";

const recordTelemetryEvent = vi.hoisted(() => vi.fn());
vi.mock("./onboarding-telemetry", () => ({ recordTelemetryEvent }));

afterEach(() => {
  cleanup();
  recordTelemetryEvent.mockReset();
});

type Props = Parameters<typeof useDeviceSetupTracking>[0];

function render() {
  return renderHook((props: Props) => useDeviceSetupTracking(props), {
    initialProps: baseProps(),
  });
}

function recorded() {
  return recordTelemetryEvent.mock.calls.map(([event]) => {
    const { operation, outcome } = event.properties;
    return `${operation} ${outcome}`;
  });
}

describe("useDeviceSetupTracking", () => {
  it("records remote access started once, then succeeded when bb connect turns on", () => {
    const hook = render();
    act(() => hook.result.current.startRemoteAccessSetup());
    act(() => hook.result.current.startRemoteAccessSetup());
    hook.rerender({ ...baseProps(), connectStatus: "on" });

    expect(recorded()).toEqual([
      "remote_access started",
      "remote_access succeeded",
    ]);
  });

  it("records add machine started only once the setup command shows, even if access becomes ready while open", () => {
    const hook = render();
    expect(recorded()).toEqual([]);

    hook.rerender({ ...baseProps(), addMachineCommandShown: true });
    hook.rerender({ ...baseProps(), addMachineCommandShown: false });
    hook.rerender({ ...baseProps(), addMachineCommandShown: true });
    hook.rerender({
      ...baseProps(),
      addMachineCommandShown: true,
      connectedMachineCount: 1,
    });

    expect(recorded()).toEqual([
      "add_machine started",
      "add_machine succeeded",
    ]);
  });
});

function baseProps(): Props {
  return {
    entry: "first_run",
    connectStatus: "off",
    addMachineCommandShown: false,
    connectedMachineCount: 0,
  };
}
