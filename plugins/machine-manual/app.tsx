import { useCallback, useEffect, useRef, useState } from "react";
import {
  definePluginApp,
  UrlLink,
  type ExperimentalMachineSetupProps,
} from "@get-bb/plugin-sdk/app";
import { Button } from "@bb/shared-ui/button";
import { ManualEnrollmentCommand } from "./enrollment-command.js";

type Config = Awaited<
  ReturnType<ExperimentalMachineSetupProps["client"]["system"]["config"]>
>;

function localOnly(value: string): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return (
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host === "[::1]" ||
      host === "[::]" ||
      host === "0.0.0.0" ||
      /^127\./u.test(host)
    );
  } catch {
    return false;
  }
}

export function ManualMachineSetup({
  client,
  onClose,
  onShowProviders,
}: ExperimentalMachineSetupProps) {
  const [config, setConfig] = useState<Config | null>(null);
  const [launchId, setLaunchId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [expired, setExpired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const key = useRef<string | null>(null);
  const started = useRef(false);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    let active = true;
    void client.system
      .config()
      .then((value) => {
        if (active) setConfig(value);
      })
      .catch(() => {
        if (active)
          setError(
            "Could not check machine access. Reopen setup to try again.",
          );
      });
    return () => {
      active = false;
      controller.current?.abort();
    };
  }, [client]);
  const access = config?.serverAccess;
  const provider = access?.providers.find(
    (entry) => entry.id === access.defaultProviderId,
  );
  const url =
    access?.defaultProviderId === "direct"
      ? access.effectiveUrl
      : config?.serverUrl;
  const unreachable = url && localOnly(url) ? url : null;
  const accessReady =
    provider?.availability.status === "available" &&
    !(access?.defaultProviderId === "direct" && unreachable);
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
    if (accessReady && !started.current) {
      started.current = true;
      void start();
    }
  }, [accessReady, start]);
  return (
    <>
      <div className="flex flex-col space-y-1.5 text-center sm:text-left">
        <h2 className="text-lg font-semibold leading-none tracking-tight">
          Add a machine
        </h2>
        <p className="text-sm text-muted-foreground">
          {accessReady
            ? "Run this command on the machine you want to add. It installs bb and keeps the machine connected to this server."
            : "Pair a machine to run projects and threads on it."}
        </p>
      </div>
      {config && !accessReady && (
        <div
          role="status"
          className="space-y-3 rounded-md border border-border bg-muted/30 p-3"
        >
          <p className="text-sm font-medium">
            {unreachable
              ? "Another machine cannot use this address."
              : "Remote access isn't ready yet."}
          </p>
          <p className="text-xs text-subtle-foreground">
            {unreachable ? (
              <>
                The pairing command would target{" "}
                <span className="font-mono">{unreachable}</span>, which points
                to the machine that runs it, not to this bb. Set up remote
                access first, then come back here to get a pairing command that
                works from anywhere.
              </>
            ) : provider?.availability.status !== "available" ? (
              (provider?.availability.message ??
              "Choose a reachable server address in Advanced settings.")
            ) : (
              "Checking remote access…"
            )}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" variant="outline" asChild>
              <UrlLink
                onClick={onClose}
                href={
                  access?.defaultProviderId === "connect"
                    ? "/settings/plugins/connect"
                    : "/settings/machines#advanced-machine-settings"
                }
              >
                {access?.defaultProviderId === "connect"
                  ? "Set up bb connect"
                  : "Configure machine access"}
              </UrlLink>
            </Button>
            {access?.defaultProviderId === "connect" && (
              <UrlLink
                className="text-xs text-subtle-foreground underline underline-offset-2"
                href="/settings/machines#advanced-machine-settings"
                onClick={onClose}
              >
                Other ways to connect
              </UrlLink>
            )}
          </div>
        </div>
      )}
      {error && !expired && (
        <div className="space-y-2">
          <p role="alert" className="text-xs text-destructive-text">
            {error}
          </p>
          {accessReady && (
            <Button size="sm" variant="outline" onClick={() => void start()}>
              Try again
            </Button>
          )}
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
            {!config
              ? "Checking machine access…"
              : accessReady
                ? ready
                  ? "Waiting for the machine to connect…"
                  : "Preparing command…"
                : ""}
          </p>
        )}
        {onShowProviders && (
          <button
            type="button"
            className="text-xs text-subtle-foreground underline underline-offset-2 hover:text-foreground"
            onClick={async () => {
              try {
                if (launchId) await client.hosts.cancel({ id: launchId });
                controller.current?.abort();
                onShowProviders();
              } catch {
                setError("Could not switch setup methods. Try again.");
              }
            }}
          >
            Other ways to add a machine
          </button>
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
    default: true,
    component: ManualMachineSetup,
    progress: ManualEnrollmentCommand,
  });
});
