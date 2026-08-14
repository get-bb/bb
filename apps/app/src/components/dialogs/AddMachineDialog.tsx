import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { Host } from "@bb/domain";
import { z } from "zod";
import { Button } from "@bb/shared-ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import { Icon } from "@bb/shared-ui/icon";
import { MachineStatusDot } from "@/components/machines/MachineStatusDot";
import { useHosts } from "@/hooks/queries/host-queries";
import { useClipboardCopy } from "@/lib/clipboard";
import { BbHttpError, sdk } from "@/lib/sdk";
import { getMutationErrorMessage } from "@/lib/mutation-errors";

interface AddMachineDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serverUrl: string | null;
}

const connectMachineCodeSchema = z.object({
  code: z.string(),
  expiresAt: z.number(),
  serverUrl: z.string(),
});

const pluginRpcErrorEnvelopeSchema = z.object({
  error: z.object({ message: z.string() }),
});

type ConnectMachineCode = z.infer<typeof connectMachineCodeSchema>;

function isNotPairedRpcError(error: BbHttpError): boolean {
  const envelope = pluginRpcErrorEnvelopeSchema.safeParse(error.body);
  return envelope.success && envelope.data.error.message === "not_paired";
}

async function createConnectMachineCode(): Promise<ConnectMachineCode | null> {
  try {
    return await sdk.plugins.callRpc({
      pluginId: "connect",
      method: "createMachineCode",
      input: null,
      outputSchema: connectMachineCodeSchema,
    });
  } catch (error) {
    if (
      error instanceof BbHttpError &&
      (error.code === "not_paired" ||
        isNotPairedRpcError(error) ||
        error.status === 404 ||
        error.status === 422 ||
        error.status === 503)
    ) {
      return null;
    }
    throw error;
  }
}

/**
 * Add-a-machine pairing dialog (multi-machine plan §4.4, Mockup D): mints a
 * join code on open, shows the one-line pairing command with an expiry
 * countdown, and flips to "connected" live when the new machine's daemon
 * appears in the host list.
 */
export function AddMachineDialog({
  open,
  onOpenChange,
  serverUrl,
}: AddMachineDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {open ? (
          <AddMachineDialogContent
            onOpenChange={onOpenChange}
            serverUrl={serverUrl}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function formatCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * The pairing one-liner. S9 ships the install script this command downloads;
 * the flag names and order here are the contract it must honor
 * (`--join-code`, `--host-id`, `--server`, mapping onto
 * `bb-app host-daemon join`).
 *
 * With a machine code (tunnel pairing) the whole command targets the connect
 * serverUrl the code was minted for. Otherwise it uses the direct server URL
 * reported by system config, which may differ from the frontend origin in
 * source development.
 */
function pairingCommand(
  joinCode: string,
  hostId: string,
  machineCode: ConnectMachineCode | null,
  directServerUrl: string | null,
): string | null {
  const serverUrl = machineCode?.serverUrl ?? directServerUrl;
  if (serverUrl === null) return null;
  const machineFlag =
    machineCode === null ? "" : ` --machine-code ${machineCode.code}`;
  return `curl -fL --progress-meter --connect-timeout 10 --max-time 60 --retry 2 ${serverUrl}/install.sh | sh -s -- --join-code ${joinCode} --host-id ${hostId} --server ${serverUrl}${machineFlag}`;
}

function AddMachineDialogContent({
  onOpenChange,
  serverUrl,
}: {
  onOpenChange: (open: boolean) => void;
  serverUrl: string | null;
}) {
  const hostsQuery = useHosts();
  const mintJoinCode = useMutation({
    meta: { showErrorToast: false },
    mutationFn: async () => {
      const [join, machine] = await Promise.all([
        sdk.hosts.createJoinCode(),
        createConnectMachineCode(),
      ]);
      return { join, machine };
    },
  });
  const mint = mintJoinCode.mutate;
  useEffect(() => {
    mint();
  }, [mint]);

  // Hosts known when the dialog opened. A connected host outside this set is
  // the machine the user just paired.
  const baselineHostIds = useRef<Set<string> | null>(null);
  if (baselineHostIds.current === null && hostsQuery.data !== undefined) {
    baselineHostIds.current = new Set(hostsQuery.data.map((host) => host.id));
  }
  const connectedNewHost: Host | null =
    (baselineHostIds.current !== null
      ? hostsQuery.data?.find(
          (host) =>
            host.status === "connected" &&
            !baselineHostIds.current?.has(host.id),
        )
      : undefined) ?? null;

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const joinCode = mintJoinCode.data?.join ?? null;
  const machineCode = mintJoinCode.data?.machine ?? null;
  const expiresAt =
    joinCode === null
      ? null
      : Math.min(joinCode.expiresAt, machineCode?.expiresAt ?? Infinity);
  const remainingMs = expiresAt !== null ? expiresAt - now : null;
  const expired = remainingMs !== null && remainingMs <= 0;
  const command =
    joinCode !== null
      ? pairingCommand(
          joinCode.joinCode,
          joinCode.hostId,
          machineCode,
          serverUrl,
        )
      : null;
  const { copied, copy } = useClipboardCopy({ text: command ?? "" });

  return (
    <>
      <DialogHeader>
        <DialogTitle>Add a machine</DialogTitle>
        <DialogDescription>
          Run this on the machine you want to add. It pairs the machine to this
          server and keeps it available for your projects.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        {mintJoinCode.isError ? (
          <div className="space-y-2">
            <p className="text-sm text-destructive">
              {getMutationErrorMessage({
                error: mintJoinCode.error,
                fallbackMessage: "Couldn't create a join code.",
              })}
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => mintJoinCode.mutate()}
            >
              Try again
            </Button>
          </div>
        ) : command !== null ? (
          <div className="space-y-2">
            <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-md border border-border bg-muted/40 p-3 font-mono text-xs text-foreground">
              {command}
            </pre>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 px-2.5 text-xs"
                disabled={expired}
                onClick={() => void copy()}
              >
                {copied ? "Copied" : "Copy"}
              </Button>
              {expired ? (
                <>
                  <span className="text-xs text-subtle-foreground">
                    Code expired
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    disabled={mintJoinCode.isPending}
                    onClick={() => mintJoinCode.mutate()}
                  >
                    Generate a new code
                  </Button>
                </>
              ) : remainingMs !== null ? (
                <span className="text-xs text-subtle-foreground">
                  Code expires in {formatCountdown(remainingMs)}
                </span>
              ) : null}
            </div>
            <p className="text-xs text-subtle-foreground/75">
              This installs bb, enrolls the daemon, and configures it to
              reconnect automatically on the other machine.
            </p>
          </div>
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon name="Spinner" className="size-4 shrink-0 animate-spin" />
            Creating a join code…
          </p>
        )}
        <div className="flex items-center gap-2.5 rounded-md border border-border bg-muted/40 px-3 py-2.5">
          {connectedNewHost !== null ? (
            <>
              <MachineStatusDot connected />
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                {connectedNewHost.name} connected
              </span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 shrink-0 px-2 text-xs"
                onClick={() => onOpenChange(false)}
              >
                Set up a project on it →
              </Button>
            </>
          ) : (
            <>
              <Icon
                name="Spinner"
                className="size-4 shrink-0 animate-spin text-muted-foreground"
              />
              <span className="text-sm text-muted-foreground">
                Waiting for the machine to connect…
              </span>
            </>
          )}
        </div>
      </div>
      <DialogFooter>
        <Button
          type="button"
          variant="ghost"
          onClick={() => onOpenChange(false)}
        >
          Done
        </Button>
      </DialogFooter>
    </>
  );
}
