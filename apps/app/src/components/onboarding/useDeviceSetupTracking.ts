import { useCallback, useEffect, useRef } from "react";
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
    remoteAccess: boolean;
    machinesBefore: number | null;
  }>({ remoteAccess: false, machinesBefore: null });
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
    if (connectStatus !== "on" || !pending.current.remoteAccess) return;
    pending.current.remoteAccess = false;
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
    if (connectStatus !== "off" || pending.current.remoteAccess) return;
    pending.current.remoteAccess = true;
    record("remote_access", "started");
  }, [connectStatus, record]);

  return { startRemoteAccessSetup };
}
