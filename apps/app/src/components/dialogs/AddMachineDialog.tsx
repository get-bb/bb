import { nanoid } from "nanoid";
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
import {
  formatCountdown,
  useCountdown,
} from "@bb/shared-ui/hooks/use-countdown";
import { Icon } from "@bb/shared-ui/icon";
import { InlineTextButton, PendingStatus } from "@bb/shared-ui/sign-in-panel";
import { MachineStatusDot } from "@/components/machines/MachineStatusDot";
import { useHosts } from "@/hooks/queries/host-queries";
import { sdk } from "@/lib/sdk";
import { useClipboardCopy } from "@/lib/clipboard";
import { Link } from "react-router-dom";
import { getSettingsMachineRoutePath } from "@/lib/route-paths";
import {
  getMutationErrorMessage,
  isAbortLikeError,
} from "@/lib/mutation-errors";

const MANUAL_MACHINE_PROVIDER_ID = "manual";

export class MachineEnrollmentEndedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MachineEnrollmentEndedError";
  }
}

type EnrollmentFailureHandler = (error: unknown) => void;

export function AddMachineDialog({
  open,
  onOpenChange,
  onEnrollmentFailed,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEnrollmentFailed?: EnrollmentFailureHandler;
}) {
  const hosts = useHosts();
  const close = (next: boolean) => {
    if (!next) void hosts.refetch();
    onOpenChange(next);
  };
  return (
    <Dialog open={open} onOpenChange={close} modal={false}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        {open && (
          <AddMachineContent
            onOpenChange={close}
            onEnrollmentFailed={onEnrollmentFailed}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

export function AddMachineContent({
  onOpenChange,
  onEnrollmentFailed,
}: {
  onOpenChange: (open: boolean) => void;
  onEnrollmentFailed?: EnrollmentFailureHandler | undefined;
}) {
  const config = useSystemConfig();
  const hosts = useHosts();
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
  const serverPrimaryHostId = config.data?.primaryHostId ?? null;
  const serverMachineName =
    hosts.data?.find((host) => host.id === serverPrimaryHostId)?.name ?? null;
  return (
    <ManualMachineSetup
      serverMachineName={serverMachineName}
      onOpenChange={onOpenChange}
      onEnrollmentFailed={onEnrollmentFailed}
    />
  );
}

function serverMachineNotice(serverMachineName: string | null): string {
  return serverMachineName === null
    ? "The new machine will connect to your bb server. Keep the server machine on so the new machine can keep working."
    : `The new machine will connect to the bb server on ${serverMachineName}. Keep that computer on so the new machine can keep working.`;
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
  windowsValue: string;
  expiresAt: number;
  unavailable: boolean;
}

interface ManualMachineEnrollment {
  command: EnrollmentCommand | null;
  connectedHost: Host | null;
  errorMessage: string | null;
  retry: () => void;
  regenerate: () => void;
}

function useManualMachineEnrollment(
  onFailed: EnrollmentFailureHandler | undefined,
): ManualMachineEnrollment {
  const onFailedRef = useRef(onFailed);
  useEffect(() => {
    onFailedRef.current = onFailed;
  });
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
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
      createKey.current ??= nanoid();
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
          const currentEnrollment =
            await sdk.hosts.experimental_getEnrollmentCommand({
              hostId: host.id,
              signal: controller.signal,
            });
          if (currentEnrollment !== null) {
            enrollment = currentEnrollment;
            setCommand({
              value: currentEnrollment.command,
              windowsValue: currentEnrollment.windowsCommand,
              expiresAt: currentEnrollment.expiresAt,
              unavailable: false,
            });
          } else if (enrollment !== null) {
            const usedEnrollment = enrollment;
            setCommand((previous) =>
              previous?.unavailable
                ? previous
                : {
                    value: usedEnrollment.command,
                    windowsValue: usedEnrollment.windowsCommand,
                    expiresAt: usedEnrollment.expiresAt,
                    unavailable: true,
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
          throw new MachineEnrollmentEndedError(
            host.lifecycle.message ?? "Machine setup cancelled",
          );
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
    onError: (error) => {
      if (!mountedRef.current || isAbortLikeError(error)) return;
      onFailedRef.current?.(error);
    },
  });
  const start = createMachine.mutate;
  useEffect(() => {
    start({ replaceLaunch: false });
  }, [start]);

  return {
    command,
    connectedHost,
    errorMessage: createMachine.isError
      ? getMutationErrorMessage({
          error: createMachine.error,
          fallbackMessage: "Couldn't prepare an enrollment command.",
        })
      : null,
    retry: () => start({ replaceLaunch: false }),
    regenerate: () => start({ replaceLaunch: true }),
  };
}

export function ManualMachineSetup({
  serverMachineName,
  onOpenChange,
  onEnrollmentFailed,
}: {
  serverMachineName: string | null;
  onOpenChange: (open: boolean) => void;
  onEnrollmentFailed?: EnrollmentFailureHandler | undefined;
}) {
  const enrollment = useManualMachineEnrollment(onEnrollmentFailed);
  return (
    <ManualMachineSetupView
      command={enrollment.command}
      connectedHost={enrollment.connectedHost}
      serverMachineName={serverMachineName}
      errorMessage={enrollment.errorMessage}
      onRetry={enrollment.retry}
      onRegenerate={enrollment.regenerate}
      onOpenMachine={() => onOpenChange(false)}
    />
  );
}

export function AddMachineInline({
  onEnrollmentFailed,
}: {
  onEnrollmentFailed?: EnrollmentFailureHandler;
}) {
  const enrollment = useManualMachineEnrollment(onEnrollmentFailed);
  return (
    <QuickMachineSetupView
      command={enrollment.command}
      connectedHost={enrollment.connectedHost}
      errorMessage={enrollment.errorMessage}
      onRetry={enrollment.retry}
      onRegenerate={enrollment.regenerate}
    />
  );
}

export function QuickMachineSetupView({
  command,
  connectedHost,
  errorMessage,
  onRetry,
  onRegenerate,
}: {
  command: EnrollmentCommand | null;
  connectedHost: Host | null;
  errorMessage: string | null;
  onRetry: () => void;
  onRegenerate: () => void;
}) {
  const [platform, setPlatform] = useState<MachineLaunchPlatform>("posix");
  if (errorMessage !== null) {
    return (
      <div className="flex flex-col items-start gap-2 text-xs">
        <p role="alert" className="text-destructive-text">
          {errorMessage}
        </p>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3 text-xs text-muted-foreground">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <p className="text-foreground">On the other machine, run:</p>
          <div
            role="group"
            aria-label="Machine operating system"
            className="flex items-center gap-1"
          >
            {MACHINE_LAUNCH_PLATFORMS.map((option, index) => (
              <span key={option.id} className="flex items-center gap-1">
                {index > 0 ? <span aria-hidden="true">·</span> : null}
                <button
                  type="button"
                  aria-pressed={platform === option.id}
                  className={
                    platform === option.id
                      ? "rounded-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      : "rounded-sm underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  }
                  onClick={() => setPlatform(option.id)}
                >
                  {option.shortLabel}
                </button>
              </span>
            ))}
          </div>
        </div>
        {command === null ? null : (
          <QuickMachineCommand
            key={command.value}
            command={
              platform === "windows" ? command.windowsValue : command.value
            }
            expiresAt={command.expiresAt}
            unavailable={command.unavailable}
            onRegenerate={onRegenerate}
          />
        )}
      </div>
      {connectedHost === null ? (
        <PendingStatus>
          {command === null
            ? "Preparing a command…"
            : "Waiting for it to connect…"}
        </PendingStatus>
      ) : (
        <p role="status" className="flex items-center gap-1.5 text-foreground">
          <Icon
            name="CircleCheck"
            aria-hidden
            className="size-3.5 shrink-0 text-success"
          />
          {connectedHost.name} connected
        </p>
      )}
    </div>
  );
}

function QuickMachineCommand({
  command,
  expiresAt,
  unavailable,
  onRegenerate,
}: {
  command: string;
  expiresAt: number;
  unavailable: boolean;
  onRegenerate: () => void;
}) {
  const { copied, copy } = useClipboardCopy({ text: command });
  const remaining = useCountdown(expiresAt);
  const expired = remaining <= 0;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-start gap-2 rounded-md border border-border bg-background py-2 pl-3 pr-1.5">
        <code className="min-w-0 flex-1 whitespace-pre-wrap break-all py-0.5 font-mono text-xs text-foreground">
          {command}
        </code>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-6 shrink-0"
          aria-label={copied ? "Copied" : "Copy command"}
          disabled={expired || unavailable}
          onClick={() => void copy()}
        >
          <Icon
            name={copied ? "Check" : "Copy"}
            aria-hidden
            className="size-3.5"
          />
        </Button>
      </div>
      {unavailable ? (
        <p role="status">Command used</p>
      ) : expired ? (
        <p role="status" className="flex flex-wrap items-center gap-x-2">
          Command expired
          <InlineTextButton onClick={onRegenerate}>
            Get a new command
          </InlineTextButton>
        </p>
      ) : (
        <p className="tabular-nums">Expires in {formatCountdown(remaining)}</p>
      )}
    </div>
  );
}

export function ManualMachineSetupView({
  command,
  connectedHost,
  serverMachineName,
  errorMessage,
  onRetry,
  onRegenerate,
  onOpenMachine,
}: {
  command: EnrollmentCommand | null;
  connectedHost: Host | null;
  serverMachineName: string | null;
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
          windowsCommand={command.windowsValue}
          expiresAt={command.expiresAt}
          unavailable={command.unavailable}
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
      {errorMessage === null ? (
        <p className="text-xs text-subtle-foreground">
          {serverMachineNotice(serverMachineName)}
        </p>
      ) : null}
    </>
  );
}

type MachineLaunchPlatform = "posix" | "windows";

const MACHINE_LAUNCH_PLATFORMS: readonly {
  id: MachineLaunchPlatform;
  label: string;
  shortLabel: string;
}[] = [
  { id: "posix", label: "macOS or Linux", shortLabel: "Mac/Linux" },
  { id: "windows", label: "Windows", shortLabel: "Windows" },
];

export function MachineLaunchCommand({
  command,
  windowsCommand,
  expiresAt,
  unavailable = false,
  onRegenerate,
}: {
  command: string;
  windowsCommand: string;
  expiresAt: number;
  unavailable?: boolean;
  onRegenerate: () => void;
}) {
  const [platform, setPlatform] = useState<MachineLaunchPlatform>("posix");
  const shownCommand = platform === "windows" ? windowsCommand : command;
  const { copied, copy } = useClipboardCopy({ text: shownCommand });
  const remaining = useCountdown(expiresAt);
  const expired = remaining <= 0;
  return (
    <div className="overflow-hidden rounded-md border border-border bg-muted/30">
      <div
        role="group"
        aria-label="Machine operating system"
        className="flex items-center gap-1 border-b border-border px-2 py-1.5"
      >
        {MACHINE_LAUNCH_PLATFORMS.map((option) => (
          <Button
            key={option.id}
            type="button"
            size="sm"
            variant={platform === option.id ? "secondary" : "ghost"}
            aria-pressed={platform === option.id}
            className="h-6 px-2 text-xs"
            onClick={() => setPlatform(option.id)}
          >
            {option.label}
          </Button>
        ))}
        {platform === "windows" ? (
          <span className="ml-auto text-xs text-subtle-foreground">
            Run in PowerShell
          </span>
        ) : null}
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap break-all p-3 font-mono text-xs text-foreground">
        {shownCommand}
      </pre>
      <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2">
        {unavailable ? (
          <span role="status" className="text-xs text-subtle-foreground">
            Command used
          </span>
        ) : expired ? (
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
          disabled={expired || unavailable}
          onClick={() => void copy()}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}
