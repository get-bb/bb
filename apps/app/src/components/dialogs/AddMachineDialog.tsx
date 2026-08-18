import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
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
import { isLocalOnlyUrl } from "@/lib/loopback-hostname";
import {
  getPluginConfigurationRoutePath,
  getPluginDetailRoutePath,
} from "@/lib/route-paths";
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

/**
 * Outcome of asking the connect plugin for a machine code.
 * - `issued`: connect is paired; the command routes through getbb.app.
 * - `unpaired`: connect is installed but not paired (or not installed at all).
 *   Only a direct server URL can work.
 * - `disabled`: the user turned the connect plugin off. Retrying cannot help;
 *   the plugin must be enabled first. Only a direct server URL can work.
 * - `unavailable`: a temporary failure (for example the plugin is still
 *   starting). Nothing is known about pairing.
 */
type ConnectMachineCodeResult =
  | { kind: "issued"; code: ConnectMachineCode }
  | { kind: "unpaired" }
  | { kind: "disabled" }
  | { kind: "unavailable" };

/**
 * The rpc dispatcher answers 503 for any plugin that is not running, whether
 * it is disabled or merely still starting. The plugin list carries the real
 * status, so ask it instead of parsing the 503 message.
 */
async function isConnectPluginDisabled(): Promise<boolean> {
  try {
    const { plugins } = await sdk.plugins.list();
    const connect = plugins.find((plugin) => plugin.id === "connect");
    return connect !== undefined && !connect.enabled;
  } catch {
    return false;
  }
}

async function createConnectMachineCode(): Promise<ConnectMachineCodeResult> {
  try {
    const code = await sdk.plugins.callRpc({
      pluginId: "connect",
      method: "createMachineCode",
      input: null,
      outputSchema: connectMachineCodeSchema,
    });
    return { kind: "issued", code };
  } catch (error) {
    if (!(error instanceof BbHttpError)) throw error;
    if (
      error.code === "not_paired" ||
      isNotPairedRpcError(error) ||
      error.status === 404
    ) {
      return { kind: "unpaired" };
    }
    if (error.status === 503) {
      return (await isConnectPluginDisabled())
        ? { kind: "disabled" }
        : { kind: "unavailable" };
    }
    if (error.status === 422) {
      return { kind: "unavailable" };
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

const REMOTE_ACCESS_ROUTE = getPluginConfigurationRoutePath({
  pluginId: "connect",
});
// The plugin detail page carries the enable switch; the settings page only
// says "Enable this plugin" while it is off.
const CONNECT_PLUGIN_ROUTE = getPluginDetailRoutePath({
  pluginId: "connect",
  view: "installed",
});

/**
 * Shown instead of the pairing command when connect cannot issue a machine
 * code and the only server URL we know is loopback or unspecified (issue
 * #1690). bb listens on loopback by default, so a command that targets this
 * address dials the new machine itself instead of this server.
 */
function UnreachableServerNotice({
  serverUrl,
  reason,
}: {
  serverUrl: string;
  reason: "unpaired" | "disabled";
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="space-y-2 rounded-md border border-border bg-muted/40 p-3"
    >
      <p className="text-sm text-foreground">
        Another machine cannot use this address.
      </p>
      <p className="text-xs text-subtle-foreground">
        The pairing command would target{" "}
        <span className="font-mono">{serverUrl}</span>, which points to the
        machine that runs it, not to this bb.{" "}
        {reason === "disabled"
          ? "The Connect plugin is disabled, so remote access is off. Enable it, then come back here to get a pairing command that works from anywhere."
          : "Set up remote access first, then come back here to get a pairing command that works from anywhere."}
      </p>
      <div className="flex items-center gap-2">
        <Button
          asChild
          size="sm"
          variant="outline"
          className="h-7 px-2.5 text-xs"
        >
          {reason === "disabled" ? (
            <Link to={CONNECT_PLUGIN_ROUTE}>Enable the Connect plugin</Link>
          ) : (
            <Link to={REMOTE_ACCESS_ROUTE}>Set up remote access</Link>
          )}
        </Button>
        <a
          href="https://github.com/get-bb/bb/blob/main/docs/multiple-devices.md"
          target="_blank"
          rel="noreferrer"
          className="text-xs text-subtle-foreground underline underline-offset-2"
        >
          Other options
        </a>
      </div>
    </div>
  );
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

  const joinCode = mintJoinCode.data?.join ?? null;
  const machineCodeResult = mintJoinCode.data?.machine ?? null;
  const machineCode =
    machineCodeResult?.kind === "issued" ? machineCodeResult.code : null;
  const expiresAt =
    joinCode === null
      ? null
      : Math.min(joinCode.expiresAt, machineCode?.expiresAt ?? Infinity);
  const localOnlyServerUrl =
    serverUrl !== null && isLocalOnlyUrl(serverUrl) ? serverUrl : null;
  // Connect cannot issue a machine code and the fallback URL cannot work:
  // explain instead of showing a command that dials the wrong machine.
  const unreachable =
    (machineCodeResult?.kind === "unpaired" ||
      machineCodeResult?.kind === "disabled") &&
    localOnlyServerUrl !== null
      ? { serverUrl: localOnlyServerUrl, reason: machineCodeResult.kind }
      : null;
  // Connect failed for a temporary reason and the fallback URL cannot work:
  // offer a retry instead of a command that dials the wrong machine.
  const connectUnavailable =
    machineCodeResult?.kind === "unavailable" && localOnlyServerUrl !== null;
  const showCommand =
    joinCode !== null && unreachable === null && !connectUnavailable;

  // Tick only while a command with an expiry is on screen.
  const [now, setNow] = useState(() => Date.now());
  const hasCountdown = showCommand && expiresAt !== null;
  useEffect(() => {
    if (!hasCountdown) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [hasCountdown]);
  const remainingMs =
    hasCountdown && expiresAt !== null ? expiresAt - now : null;
  const expired = remainingMs !== null && remainingMs <= 0;
  const command =
    showCommand && joinCode !== null
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
          {unreachable !== null
            ? "Pair a machine to run projects and threads on it."
            : "Run this on the machine you want to add. It pairs the machine to this server and keeps it available for your projects."}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        {mintJoinCode.isError || connectUnavailable ? (
          <div className="space-y-2">
            <p className="text-sm text-destructive">
              {connectUnavailable
                ? "Remote access isn't ready yet."
                : getMutationErrorMessage({
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
        ) : unreachable !== null ? (
          <UnreachableServerNotice
            serverUrl={unreachable.serverUrl}
            reason={unreachable.reason}
          />
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
                <span className="text-xs tabular-nums text-subtle-foreground">
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
        {unreachable !== null ? null : (
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
        )}
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
