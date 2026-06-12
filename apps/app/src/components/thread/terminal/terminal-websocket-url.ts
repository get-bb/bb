import { buildDevWebSocketUrl } from "@/lib/dev-websocket-url";

interface BuildTerminalWebSocketUrlArgs {
  terminalId: string;
  threadId: string;
}

function buildTerminalWebSocketPath({
  terminalId,
  threadId,
}: BuildTerminalWebSocketUrlArgs): string {
  return `/ws/threads/${encodeURIComponent(threadId)}/terminals/${encodeURIComponent(
    terminalId,
  )}`;
}

export function buildTerminalWebSocketUrl(
  args: BuildTerminalWebSocketUrlArgs,
): string {
  const path = buildTerminalWebSocketPath(args);
  const devWebSocketUrl = buildDevWebSocketUrl({ path });
  if (devWebSocketUrl !== undefined) {
    return devWebSocketUrl;
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${path}`;
}
