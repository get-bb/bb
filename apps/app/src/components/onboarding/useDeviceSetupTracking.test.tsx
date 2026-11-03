// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { BbHttpError } from "@bb/sdk/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MachineEnrollmentEndedError } from "@/components/dialogs/AddMachineDialog";
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

  it("records the failed remote access stage and counts a retry as a new start", () => {
    const hook = render();
    act(() => hook.result.current.startRemoteAccessSetup());
    act(() => hook.result.current.failRemoteAccessSetup("sign_in"));
    act(() => hook.result.current.startRemoteAccessSetup());
    act(() => hook.result.current.failRemoteAccessSetup("turn_on"));

    expect(
      recordTelemetryEvent.mock.calls.map(([event]) => event.properties),
    ).toEqual([
      { ...devices, operation: "remote_access", outcome: "started" },
      {
        ...devices,
        operation: "remote_access",
        outcome: "failed",
        failure_stage: "sign_in",
      },
      { ...devices, operation: "remote_access", outcome: "started" },
      {
        ...devices,
        operation: "remote_access",
        outcome: "failed",
        failure_stage: "turn_on",
      },
    ]);
  });

  it.each([
    [
      new MachineEnrollmentEndedError("Machine setup cancelled"),
      "command_failed",
    ],
    [
      new BbHttpError({
        body: null,
        code: "forbidden",
        message: "Forbidden",
        status: 403,
      }),
      "permission",
    ],
    [new Error("Connection lost"), "other"],
  ] as const)(
    "records an add machine failure as %s",
    (error, failureReason) => {
      const hook = render();
      act(() => hook.result.current.failAddMachine(error));

      expect(recordTelemetryEvent).toHaveBeenCalledExactlyOnceWith({
        name: "onboarding_operation",
        properties: {
          ...devices,
          operation: "add_machine",
          outcome: "failed",
          failure_reason: failureReason,
        },
      });
    },
  );
});

const devices = { entry: "first_run", step: "devices" } as const;

function baseProps(): Props {
  return {
    entry: "first_run",
    connectStatus: "off",
    addMachineCommandShown: false,
    connectedMachineCount: 0,
  };
}
