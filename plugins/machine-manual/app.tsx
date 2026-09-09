import { useCallback, useEffect, useRef, useState } from "react";
import {
  definePluginApp,
  type ExperimentalMachineSetupProps,
} from "@get-bb/plugin-sdk/app";
import { Button } from "@bb/shared-ui/button";
import { ManualEnrollmentCommand } from "./enrollment-command.js";

export function ManualMachineSetup({
  client,
  onClose,
}: ExperimentalMachineSetupProps) {
  const [launchId, setLaunchId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [expired, setExpired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const key = useRef<string | null>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const start = useCallback(async () => {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    key.current ??= crypto.randomUUID();
    setError(null);
    setReady(false);
    setExpired(false);
    setLaunchId(null);
    try {
      const launch = await client.hosts.submit({
        key: key.current,
        machineProviderId: "manual",
        projectId: null,
        inputs: null,
        signal: abort.signal,
      });
      if (abort.signal.aborted) return;
      setLaunchId(launch.id);
      await client.hosts.follow({ id: launch.id, signal: abort.signal });
      if (!abort.signal.aborted) close.current();
    } catch (failure) {
      if (!abort.signal.aborted)
        setError(
          failure instanceof Error
            ? failure.message
            : "Could not prepare the command.",
        );
    }
  }, [client]);
  useEffect(() => {
    void start();
    return () => controller.current?.abort();
  }, [start]);
  return (
    <>
      <div className="flex flex-col space-y-1.5 text-center sm:text-left">
        <h2 className="text-lg font-semibold leading-none tracking-tight">
          Add a machine
        </h2>
        <p className="text-sm text-muted-foreground">
          Run this command on the machine you want to add. It installs bb and
          keeps the machine connected to this server.
        </p>
      </div>
      {error && !expired && (
        <div className="space-y-2">
          <p role="alert" className="text-xs text-destructive-text">
            {error}
          </p>
          <Button size="sm" variant="outline" onClick={() => void start()}>
            Try again
          </Button>
        </div>
      )}
      {launchId && (
        <ManualEnrollmentCommand
          client={client}
          id={launchId}
          scope="launch"
          onReadyChange={setReady}
          onExpired={() => setExpired(true)}
          onRegenerate={async () => {
            await client.hosts.cancel({ id: launchId });
            key.current = null;
            await start();
          }}
        />
      )}
      <div className="flex items-center justify-between gap-3">
        {!expired && !error && (
          <p role="status" className="text-xs text-subtle-foreground">
            {ready
              ? "Waiting for the machine to connect…"
              : "Preparing command…"}
          </p>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
    </>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_machineSetup({
    machineProviderId: "manual",
    component: ManualMachineSetup,
    progress: ManualEnrollmentCommand,
  });
});
