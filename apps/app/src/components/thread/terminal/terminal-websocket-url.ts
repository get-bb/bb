import { buildDevWebSocketUrl } from "@/lib/dev-websocket-url";

interface BuildTerminalWebSocketUrlArgs {
  terminalId: string;
  threadId: string;
}

interface BuildThreadlessTerminalWebSocketUrlArgs {
  terminalId: string;
}

function buildTerminalWebSocketPath({
  terminalId,
  threadId,
}: BuildTerminalWebSocketUrlArgs): string {
  return `/ws/threads/${encodeURIComponent(threadId)}/terminals/${encodeURIComponent(
    terminalId,
  )}`;
}

function buildThreadlessTerminalWebSocketPath({
  terminalId,
}: BuildThreadlessTerminalWebSocketUrlArgs): string {
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

export function buildThreadlessTerminalWebSocketUrl(
  args: BuildThreadlessTerminalWebSocketUrlArgs,
): string {
  return buildWebSocketUrl(buildThreadlessTerminalWebSocketPath(args));
}
