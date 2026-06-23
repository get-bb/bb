import { buildDevWebSocketUrl } from "@/lib/dev-websocket-url";

interface BuildTerminalWebSocketUrlArgs {
  terminalId: string;
}

function buildTerminalWebSocketPath({
  terminalId,
}: BuildTerminalWebSocketUrlArgs): string {
  return `/ws/terminals/${encodeURIComponent(terminalId)}`;
}

function buildWebSocketUrl(path: string): string {
  const devWebSocketUrl = buildDevWebSocketUrl({ path });
  if (devWebSocketUrl !== undefined) {
    return devWebSocketUrl;
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${path}`;
}

export function buildTerminalWebSocketUrl(
  args: BuildTerminalWebSocketUrlArgs,
): string {
  return buildWebSocketUrl(buildTerminalWebSocketPath(args));
}
