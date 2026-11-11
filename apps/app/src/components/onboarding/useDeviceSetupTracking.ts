import { useCallback, useEffect, useRef } from "react";
import type {
  InternalDoNotUseSetupFailureDetail,
  InternalDoNotUseSetupFailureStage,
} from "@get-bb/plugin-sdk/app";
import { MachineEnrollmentEndedError } from "@/components/dialogs/AddMachineDialog";
import { operationFailureReason } from "./onboarding-model";
import {
  recordTelemetryEvent,
  type OnboardingEntry,
} from "./onboarding-telemetry";

export function useDeviceSetupTracking({
  entry,
  connectStatus,
  addMachineCommandShown,
  connectedMachineCount,
}: {
  entry: OnboardingEntry;
  connectStatus: "on" | "off" | "unavailable";
  addMachineCommandShown: boolean;
  connectedMachineCount: number | undefined;
}) {
  const pending = useRef<{
    remoteAccess: "idle" | "started" | "failed" | "succeeded";
    machinesBefore: number | null;
  }>({ remoteAccess: "idle", machinesBefore: null });
  const record = useCallback(
    (
      operation: "remote_access" | "add_machine",
      outcome: "started" | "succeeded",
    ) =>
      recordTelemetryEvent({
        name: "onboarding_operation",
        properties: { entry, step: "devices", operation, outcome },
      }),
    [entry],
  );
  useEffect(() => {
    const remoteAccess = pending.current.remoteAccess;
    if (
      connectStatus !== "on" ||
      (remoteAccess !== "started" && remoteAccess !== "failed")
    ) {
      return;
    }
    pending.current.remoteAccess = "succeeded";
    record("remote_access", "succeeded");
  }, [connectStatus, record]);
  useEffect(() => {
    if (
      !addMachineCommandShown ||
      connectedMachineCount === undefined ||
      pending.current.machinesBefore !== null
    ) {
      return;
    }
    pending.current.machinesBefore = connectedMachineCount;
    record("add_machine", "started");
  }, [addMachineCommandShown, connectedMachineCount, record]);
  useEffect(() => {
    const before = pending.current.machinesBefore;
    if (
      before === null ||
      connectedMachineCount === undefined ||
      connectedMachineCount <= before
    ) {
      return;
    }
    pending.current.machinesBefore = null;
    record("add_machine", "succeeded");
  }, [connectedMachineCount, record]);

  const startRemoteAccessSetup = useCallback(() => {
    if (connectStatus === "on" || pending.current.remoteAccess === "started") {
      return;
    }
    pending.current.remoteAccess = "started";
    record("remote_access", "started");
  }, [connectStatus, record]);

  const failRemoteAccessSetup = useCallback(
    (
      stage: InternalDoNotUseSetupFailureStage,
      detail?: InternalDoNotUseSetupFailureDetail,
    ) => {
      const remoteAccess = pending.current.remoteAccess;
      if (remoteAccess === "idle" || remoteAccess === "succeeded") return;
      pending.current.remoteAccess = "failed";
      recordTelemetryEvent({
        name: "onboarding_operation",
        properties: {
          entry,
          step: "devices",
          operation: "remote_access",
          outcome: "failed",
          failure_stage: stage,
          ...(detail === undefined ? {} : { failure_detail: detail }),
        },
      });
    },
    [entry],
  );

  const failAddMachine = useCallback(
    (error: unknown) =>
      recordTelemetryEvent({
        name: "onboarding_operation",
        properties: {
          entry,
          step: "devices",
          operation: "add_machine",
          outcome: "failed",
          failure_reason:
            error instanceof MachineEnrollmentEndedError
              ? "command_failed"
              : operationFailureReason(error),
        },
      }),
    [entry],
  );

  return { startRemoteAccessSetup, failRemoteAccessSetup, failAddMachine };
}
