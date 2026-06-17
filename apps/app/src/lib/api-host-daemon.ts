import {
  createHostDaemonLocalClient,
  DEFAULT_HOST_DAEMON_LOCAL_BIND_HOST,
  providerCliInstallEventSchema,
  providerCliStatusResponseSchema,
  workspaceOpenTargetsResponseSchema,
  type OpenInTargetRequest,
  type ProviderCliInstallEvent,
  type ProviderCliInstallRequest,
  type ProviderCliStatusResponse,
  type StatusResponse,
  type WorkspaceOpenTarget,
} from "@bb/host-daemon-contract";
import { z } from "zod";

let client: ReturnType<typeof createHostDaemonLocalClient> | null = null;
let clientPort: number | null = null;

export interface HostDaemonStatusSnapshot extends StatusResponse {}

const hostDaemonErrorResponseSchema = z.object({
  message: z.string().min(1),
});

export type ProviderCliInstallEventHandler = (
  event: ProviderCliInstallEvent,
) => void;

export interface InstallProviderCliArgs {
  port: number;
  request: ProviderCliInstallRequest;
  onEvent: ProviderCliInstallEventHandler;
  signal?: AbortSignal;
}

/**
 * Get or create the host daemon client.
 * Recreates the client if the port changes.
 */
export function getHostDaemonClient(port: number) {
  if (!client || clientPort !== port) {
    client = createHostDaemonLocalClient(
      `http://${DEFAULT_HOST_DAEMON_LOCAL_BIND_HOST}:${port}`,
    );
    clientPort = port;
  }
  return client;
}

function getHostDaemonBaseUrl(port: number): string {
  return `http://${DEFAULT_HOST_DAEMON_LOCAL_BIND_HOST}:${port}`;
}

/**
 * Fetch local daemon status.
 * Returns null if the daemon is unreachable.
 */
export async function fetchHostStatus(
  port: number,
): Promise<HostDaemonStatusSnapshot | null> {
  try {
    const daemon = getHostDaemonClient(port);
    const res = await daemon.status.$get();
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Fetch the local connected server-session host ID from the daemon. */
export async function fetchHostId(port: number): Promise<string | null> {
  const status = await fetchHostStatus(port);
  if (!status?.connected) {
    return null;
  }
  return status.hostId;
}

export async function fetchWorkspaceOpenTargets(
  port: number,
): Promise<WorkspaceOpenTarget[]> {
  const daemon = getHostDaemonClient(port);
  const res = await daemon["workspace-open-targets"].$get();
  const status = Number(res.status);
  if (status === 404) {
    return [];
  }
  if (!res.ok) {
    throw new Error(`Workspace open target discovery failed: HTTP ${status}`);
  }
  const body = await res.json();
  return workspaceOpenTargetsResponseSchema.parse(body).targets;
}

export async function fetchProviderCliStatus(
  port: number,
): Promise<ProviderCliStatusResponse> {
  const daemon = getHostDaemonClient(port);
  const res = await daemon["provider-clis"].status.$get();
  if (!res.ok) {
    const status = Number(res.status);
    throw new Error(`Provider CLI status check failed: HTTP ${status}`);
  }
  return providerCliStatusResponseSchema.parse(await res.json());
}

export async function openInTarget(
  port: number,
  request: OpenInTargetRequest,
): Promise<void> {
  const daemon = getHostDaemonClient(port);
  const res = await daemon["open-in-target"].$post({
    json: request,
  });
  if (!res.ok) {
    const status = Number(res.status);
    throw new Error(
      await readHostDaemonErrorMessage(
        res,
        `Failed to open target: HTTP ${status}`,
      ),
    );
  }
}

function handleProviderCliInstallEventLine(
  line: string,
  onEvent: ProviderCliInstallEventHandler,
): void {
  const trimmedLine = line.trim();
  if (trimmedLine.length === 0) {
    return;
  }
  onEvent(providerCliInstallEventSchema.parse(JSON.parse(trimmedLine)));
}

function emitProviderCliInstallEventLines(
  buffer: string,
  onEvent: ProviderCliInstallEventHandler,
): string {
  const lines = buffer.split(/\r?\n/u);
  const lastLine = lines.pop();
  for (const line of lines) {
    handleProviderCliInstallEventLine(line, onEvent);
  }
  return lastLine ?? "";
}

export async function installProviderCli({
  port,
  request,
  onEvent,
  signal,
}: InstallProviderCliArgs): Promise<void> {
  const res = await fetch(
    `${getHostDaemonBaseUrl(port)}/provider-clis/install`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(request),
      signal,
    },
  );

  if (!res.ok) {
    const status = Number(res.status);
    throw new Error(
      await readHostDaemonErrorMessage(
        res,
        `Provider CLI install failed: HTTP ${status}`,
      ),
    );
  }

  if (!res.body) {
    throw new Error("Provider CLI install did not return a log stream");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const result = await reader.read();
    if (result.done) {
      break;
    }
    buffer += decoder.decode(result.value, { stream: true });
    buffer = emitProviderCliInstallEventLines(buffer, onEvent);
  }

  buffer += decoder.decode();
  handleProviderCliInstallEventLine(buffer, onEvent);
}

async function readHostDaemonErrorMessage(
  response: Response,
  fallbackMessage: string,
): Promise<string> {
  const text = await response.text().catch(() => "");
  const trimmedText = text.trim();
  if (trimmedText === "") {
    return fallbackMessage;
  }

  try {
    const parsed = hostDaemonErrorResponseSchema.safeParse(
      JSON.parse(trimmedText),
    );
    if (parsed.success) {
      return parsed.data.message;
    }
  } catch {
    return trimmedText;
  }

  return trimmedText;
}

/**
 * Open a native folder picker dialog via the host daemon.
 * Returns the selected path, or null if cancelled.
 * Returns null if the daemon rejects the request (e.g. the host has no
 * native picker support).
 */
export async function pickFolder(port: number): Promise<string | null> {
  const daemon = getHostDaemonClient(port);
  const res = await daemon["pick-folder"].$post({});
  if (!res.ok) return null;
  const body = await res.json();
  return body.path;
}

/**
 * Probe the daemon for the existence of each path. Throws if the daemon is
 * unreachable or returns an error so React Query callers can surface
 * `isError` instead of silently treating "unknown" as "exists".
 */
export async function checkPathsExist(
  port: number,
  paths: string[],
): Promise<Record<string, boolean>> {
  if (paths.length === 0) return {};
  const daemon = getHostDaemonClient(port);
  const res = await daemon.paths.exist.$post({ json: { paths } });
  if (!res.ok) {
    throw new Error(`Path existence check failed: HTTP ${res.status}`);
  }
  const body = await res.json();
  return body.existence;
}
