import { MachineAccessControls } from "@/components/settings/MachineAccessSettings";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import { machineServerAccessReady } from "@/components/machines/machine-server-access";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import type { Host } from "@bb/domain";
import { Button } from "@bb/shared-ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import { Icon } from "@bb/shared-ui/icon";
import { MachineStatusDot } from "@/components/machines/MachineStatusDot";
import { useHosts } from "@/hooks/queries/host-queries";
import { sdk } from "@/lib/sdk";
import { useClipboardCopy } from "@/lib/clipboard";
import { Link } from "react-router-dom";
import { getSettingsMachineRoutePath } from "@/lib/route-paths";
import { getMutationErrorMessage } from "@/lib/mutation-errors";

const MANUAL_MACHINE_PROVIDER_ID = "manual";

export function AddMachineDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const hosts = useHosts();
  const close = (next: boolean) => {
    if (!next) void hosts.refetch();
    onOpenChange(next);
  };
  return (
    <Dialog open={open} onOpenChange={close} modal={false}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        {open && <AddMachineContent onOpenChange={close} />}
      </DialogContent>
    </Dialog>
  );
}

export function AddMachineContent({
  onOpenChange,
}: {
  onOpenChange: (open: boolean) => void;
}) {
  const config = useSystemConfig();
  const accessReady = machineServerAccessReady(config.data?.serverAccess);
  if (!accessReady) {
    return (
      <MachineAccessGate
        state={
          config.isPending
            ? { status: "checking" }
            : config.isError
              ? { status: "failed", onRetry: () => void config.refetch() }
              : { status: "blocked" }
        }
      >
        <MachineAccessControls onNavigate={() => onOpenChange(false)} />
      </MachineAccessGate>
    );
  }
  return <ManualMachineSetup onOpenChange={onOpenChange} />;
}

export type MachineAccessGateState =
  | { status: "checking" }
  | { status: "failed"; onRetry: () => void }
  | { status: "blocked" };

export function MachineAccessGate({
  state,
  children,
}: {
  state: MachineAccessGateState;
  children: ReactNode;
}) {
  if (state.status === "checking") {
    return (
      <>
        <DialogTitle className="sr-only">Add a machine</DialogTitle>
        <p role="status" className="text-sm text-subtle-foreground">
          Checking machine access…
        </p>
      </>
    );
  }
  if (state.status === "failed") {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Add a machine</DialogTitle>
          <DialogDescription className="text-destructive-text">
            Couldn’t check whether machines can reach this server.
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={state.onRetry}>
            Try again
          </Button>
        </div>
      </>
    );
  }
  return (
    <>
      <DialogHeader>
        <DialogTitle>Set up machine access</DialogTitle>
        <DialogDescription>
          A new machine has to reach this server over the network. Choose the
          address it should use.
        </DialogDescription>
      </DialogHeader>
      {children}
    </>
  );
}

export interface EnrollmentCommand {
  value: string;
  expiresAt: number;
}

export function ManualMachineSetup({
  onOpenChange,
}: {
  onOpenChange: (open: boolean) => void;
}) {
  const createController = useRef<AbortController | null>(null);
  const createKey = useRef<string | null>(null);
  const pendingHostIds = useRef(new Set<string>());
  const lifecycleGeneration = useRef(0);
  const [command, setCommand] = useState<EnrollmentCommand | null>(null);
  const [connectedHost, setConnectedHost] = useState<Host | null>(null);
  useEffect(
    () => () => {
      lifecycleGeneration.current += 1;
      createController.current?.abort();
      createKey.current = null;
      for (const hostId of pendingHostIds.current) {
        void sdk.hosts.delete({ hostId }).catch(() => undefined);
      }
      pendingHostIds.current.clear();
    },
    [],
  );
  const createMachine = useMutation({
    meta: { showErrorToast: false },
    mutationFn: async (options: { replaceLaunch: boolean }) => {
      const generation = lifecycleGeneration.current;
      if (options.replaceLaunch) {
        createController.current?.abort();
        createController.current = null;
        const ids = [...pendingHostIds.current];
        pendingHostIds.current.clear();
        await Promise.all(ids.map((hostId) => sdk.hosts.delete({ hostId })));
        createKey.current = null;
      }
      setCommand(null);
      const controller = new AbortController();
      createController.current = controller;
      createKey.current ??= crypto.randomUUID();
      try {
        let host = await sdk.hosts.experimental_create({
          key: createKey.current,
          machineProviderId: MANUAL_MACHINE_PROVIDER_ID,
          inputs: null,
          wait: false,
          signal: controller.signal,
        });
        pendingHostIds.current.add(host.id);
        if (generation !== lifecycleGeneration.current) {
          pendingHostIds.current.delete(host.id);
          await sdk.hosts.delete({ hostId: host.id });
          throw new Error("Machine setup closed");
        }
        let enrollment: Awaited<
          ReturnType<typeof sdk.hosts.experimental_getEnrollmentCommand>
        > = null;
        while (host.lifecycle.phase === "creating") {
          controller.signal.throwIfAborted();
          if (enrollment === null) {
            enrollment = await sdk.hosts.experimental_getEnrollmentCommand({
              hostId: host.id,
              signal: controller.signal,
            });
            setCommand(
              enrollment === null
                ? null
                : {
                    value: enrollment.command,
                    expiresAt: enrollment.expiresAt,
                  },
            );
          }
          await new Promise<void>((resolve) => setTimeout(resolve, 1_000));
          controller.signal.throwIfAborted();
          host = await sdk.hosts.get({
            hostId: host.id,
            signal: controller.signal,
          });
        }
        createKey.current = null;
        pendingHostIds.current.delete(host.id);
        if (host.lifecycle.phase !== "active") {
          throw new Error(host.lifecycle.message ?? "Machine setup cancelled");
        }
        return host;
      } finally {
        if (createController.current === controller)
          createController.current = null;
      }
    },
    onSuccess: (host: Host) => {
      createKey.current = null;
      setConnectedHost(host);
    },
  });
  const start = createMachine.mutate;
  useEffect(() => {
    start({ replaceLaunch: false });
  }, [start]);

  return (
    <ManualMachineSetupView
      command={command}
      connectedHost={connectedHost}
      errorMessage={
        createMachine.isError
          ? getMutationErrorMessage({
              error: createMachine.error,
              fallbackMessage: "Couldn't prepare an enrollment command.",
            })
          : null
      }
      onRetry={() => createMachine.mutate({ replaceLaunch: false })}
      onRegenerate={() => createMachine.mutate({ replaceLaunch: true })}
      onOpenMachine={() => onOpenChange(false)}
    />
  );
}

export function ManualMachineSetupView({
  command,
  connectedHost,
  errorMessage,
  onRetry,
  onRegenerate,
  onOpenMachine,
}: {
  command: EnrollmentCommand | null;
  connectedHost: Host | null;
  errorMessage: string | null;
  onRetry: () => void;
  onRegenerate: () => void;
  onOpenMachine: () => void;
}) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Add a machine</DialogTitle>
        <DialogDescription
          className={
            errorMessage === null ? undefined : "text-destructive-text"
          }
        >
          {errorMessage ??
            "Run this command on the machine you want to add. It installs bb and keeps the machine connected to this server."}
        </DialogDescription>
      </DialogHeader>
      {errorMessage === null ? null : (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={onRetry}>
            Try again
          </Button>
        </div>
      )}
      {command === null ? null : (
        <MachineLaunchCommand
          key={command.value}
          command={command.value}
          expiresAt={command.expiresAt}
          onRegenerate={onRegenerate}
        />
      )}
      {errorMessage === null ? (
        <div className="flex items-center gap-2.5 rounded-md bg-muted/40 px-3 py-2.5">
          {connectedHost === null ? (
            <>
              <Icon
                name="Spinner"
                className="size-4 shrink-0 animate-spin text-muted-foreground"
              />
              <span role="status" className="text-sm text-muted-foreground">
                {command === null
                  ? "Preparing an enrollment command…"
                  : "Waiting for the machine to connect…"}
              </span>
            </>
          ) : (
            <>
              <MachineStatusDot connected />
              <span
                role="status"
                className="min-w-0 flex-1 truncate text-sm text-foreground"
              >
                {connectedHost.name} connected
              </span>
              <Button
                asChild
                size="sm"
                variant="ghost"
                className="h-7 shrink-0 px-2 text-xs"
              >
                <Link
                  to={getSettingsMachineRoutePath(connectedHost.id)}
                  onClick={onOpenMachine}
                >
                  Open machine
                  <Icon name="ArrowRight" />
                </Link>
              </Button>
            </>
          )}
        </div>
      ) : null}
    </>
  );
}

function formatCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function MachineLaunchCommand({
  command,
  expiresAt,
  onRegenerate,
}: {
  command: string;
  expiresAt: number;
  onRegenerate: () => void;
}) {
  const { copied, copy } = useClipboardCopy({ text: command });
  const [remaining, setRemaining] = useState(() => expiresAt - Date.now());
  useEffect(() => {
    const timer = setInterval(
      () => setRemaining(expiresAt - Date.now()),
      1_000,
    );
    return () => clearInterval(timer);
  }, [expiresAt]);
  const expired = remaining <= 0;
  return (
    <div className="overflow-hidden rounded-md border border-border bg-muted/30">
      <pre className="overflow-x-auto whitespace-pre-wrap break-all p-3 font-mono text-xs text-foreground">
        {command}
      </pre>
      <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2">
        {expired ? (
          <>
            <span role="status" className="text-xs text-subtle-foreground">
              Command expired
            </span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={onRegenerate}
            >
              Generate a new command
            </Button>
          </>
        ) : (
          <span
            role="status"
            className="text-xs tabular-nums text-subtle-foreground"
          >
            Command expires in {formatCountdown(remaining)}
          </span>
        )}
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="ml-auto h-7 px-2.5 text-xs"
          disabled={expired}
          onClick={() => void copy()}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}
