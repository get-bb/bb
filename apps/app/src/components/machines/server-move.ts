import { toRecord } from "@bb/core-ui";
import type { Host, LastServerMove, ServerMoveStepId } from "@bb/domain";
import {
  SERVER_MOVED_ERROR_CODE,
  serverMovedErrorDetailsSchema,
} from "@bb/host-daemon-contract";
import { BbHttpError } from "@bb/sdk/browser";
import {
  serverMoveCheckItemSchema,
  type ServerMoveCheckItem,
  type ServerMoveCheckResponse,
  type ServerMoveCheckSeverity,
  type ServerMoveStatus,
  type ServerMoveStatusResponse,
} from "@bb/server-contract";

export const SERVER_MOVE_POLL_INTERVAL_MS = 1_000;

const SERVER_MOVE_BLOCKED_ERROR_CODE = "server_move_blocked";

export const SERVER_MOVE_SEVERITY_ORDER: readonly ServerMoveCheckSeverity[] = [
  "blocker",
  "warning",
  "info",
];

export function isServerMoveUnderway(move: ServerMoveStatus | null): boolean {
  return (
    move !== null &&
    (move.state === "preparing" ||
      move.state === "switching" ||
      move.state === "recovery_required" ||
      move.state === "completed")
  );
}

interface CanMoveServerHereArgs {
  host: Host;
  primaryHostId: string | null;
  move: ServerMoveStatus | null;
  serverMoveEnabled: boolean;
}

export function canMoveServerHere({
  host,
  primaryHostId,
  move,
  serverMoveEnabled,
}: CanMoveServerHereArgs): boolean {
  return (
    serverMoveEnabled &&
    host.type === "persistent" &&
    host.status === "connected" &&
    host.lifecycle.phase === "active" &&
    host.id !== primaryHostId &&
    !isServerMoveUnderway(move)
  );
}

export function serverMoveStepLabel(
  stepId: ServerMoveStepId,
  targetHostName: string,
): string {
  switch (stepId) {
    case "stop-work":
      return "Stopping running work";
    case "update-target":
      return `Updating bb on ${targetHostName}`;
    case "export":
      return "Exporting server data";
    case "transfer":
      return `Sending data to ${targetHostName}`;
    case "start-target":
      return "Starting the new server";
    case "verify-address":
      return "Checking the new address";
    case "switch":
      return "Switching machines over";
  }
}

export function groupServerMoveCheckItems(
  items: readonly ServerMoveCheckItem[],
): Record<ServerMoveCheckSeverity, ServerMoveCheckItem[]> {
  const groups: Record<ServerMoveCheckSeverity, ServerMoveCheckItem[]> = {
    blocker: [],
    warning: [],
    info: [],
  };
  for (const item of items) {
    groups[item.severity].push(item);
  }
  return groups;
}

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

export function formatServerDataSize(bytes: number): string {
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < BYTE_UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const rounded =
    unitIndex === 0 || value >= 10 ? Math.round(value) : value.toFixed(1);
  return `${rounded} ${BYTE_UNITS[unitIndex]}`;
}

interface ServerMoveStartGateArgs {
  result: ServerMoveCheckResponse | null;
  checking: boolean;
  starting: boolean;
  showAddress: boolean;
  addressDraft: string;
  checkedServerUrl: string | null;
  archiveConfirmed: boolean;
}

export function serverMoveStartAllowed({
  result,
  checking,
  starting,
  showAddress,
  addressDraft,
  checkedServerUrl,
  archiveConfirmed,
}: ServerMoveStartGateArgs): boolean {
  if (result === null || checking || starting || !result.canMove) {
    return false;
  }
  if (result.items.some((item) => item.severity === "blocker")) {
    return false;
  }
  if (
    showAddress &&
    (checkedServerUrl === null || addressDraft.trim() !== checkedServerUrl)
  ) {
    return false;
  }
  return result.existingTargetServerData === null || archiveConfirmed;
}

export function serverMoveBlockedItems(
  error: unknown,
): ServerMoveCheckItem[] | null {
  if (
    !(error instanceof BbHttpError) ||
    error.code !== SERVER_MOVE_BLOCKED_ERROR_CODE
  ) {
    return null;
  }
  const details = toRecord(toRecord(error.body)?.details);
  const parsed = serverMoveCheckItemSchema.array().safeParse(details?.items);
  return parsed.success && parsed.data.length > 0 ? parsed.data : null;
}

export function movedServerUrlFromError(error: unknown): string | null {
  if (
    !(error instanceof BbHttpError) ||
    error.status !== 410 ||
    error.code !== SERVER_MOVED_ERROR_CODE
  ) {
    return null;
  }
  const parsed = serverMovedErrorDetailsSchema.safeParse(
    toRecord(error.body)?.details,
  );
  return parsed.success ? parsed.data.serverUrl : null;
}

export interface CurrentAppLocation {
  pathname: string;
  search: string;
  hash: string;
}

export function serverMoveDestinationUrl(
  serverUrl: string,
  location: CurrentAppLocation,
): string {
  let url: URL;
  try {
    url = new URL(serverUrl);
  } catch {
    return `${serverUrl.replace(/\/+$/u, "")}${location.pathname}${location.search}${location.hash}`;
  }
  url.pathname = `${url.pathname.replace(/\/+$/u, "")}${location.pathname}`;
  url.search = location.search;
  url.hash = location.hash;
  return url.toString();
}

export function nextFollowedServerMove(
  followed: ServerMoveStatus | null,
  live: ServerMoveStatus | null,
): ServerMoveStatus | null {
  if (live === null) {
    return followed;
  }
  if (live.moveId === followed?.moveId || isServerMoveUnderway(live)) {
    return live;
  }
  return followed;
}

export type ServerMoveOverlayContent =
  | { kind: "progress"; move: ServerMoveStatus }
  | { kind: "recovery"; move: ServerMoveStatus }
  | { kind: "redirecting"; move: ServerMoveStatus; destination: string }
  | { kind: "reconnecting"; move: ServerMoveStatus }
  | { kind: "arrived"; move: ServerMoveStatus; lastMove: LastServerMove }
  | { kind: "ended"; move: ServerMoveStatus }
  | { kind: "abandoned"; move: ServerMoveStatus };

interface ResolveServerMoveOverlayArgs {
  response: ServerMoveStatusResponse | undefined;
  error: unknown;
  followed: ServerMoveStatus | null;
  dismissedMoveId: string | null;
  location: CurrentAppLocation;
}

export function resolveServerMoveOverlay({
  response,
  error,
  followed,
  dismissedMoveId,
  location,
}: ResolveServerMoveOverlayArgs): ServerMoveOverlayContent | null {
  const live = response?.move ?? null;
  const move = nextFollowedServerMove(followed, live);
  if (move === null || move.moveId === dismissedMoveId) {
    return null;
  }
  const lastMove = response?.lastMove ?? null;
  if (lastMove !== null && lastMove.moveId === move.moveId) {
    return { kind: "arrived", move, lastMove };
  }
  const movedServerUrl = movedServerUrlFromError(error);
  if (movedServerUrl !== null && isServerMoveUnderway(move)) {
    return {
      kind: "redirecting",
      move,
      destination: serverMoveDestinationUrl(movedServerUrl, location),
    };
  }
  if (live === null) {
    return move.state === "preparing" ||
      move.state === "switching" ||
      move.state === "recovery_required"
      ? { kind: "abandoned", move }
      : move.state === "completed"
        ? completedContent(move, location)
        : null;
  }
  switch (move.state) {
    case "preparing":
    case "switching":
      return { kind: "progress", move };
    case "recovery_required":
      return { kind: "recovery", move };
    case "completed":
      return completedContent(move, location);
    case "failed":
    case "cancelled":
      return followed?.moveId === move.moveId ? { kind: "ended", move } : null;
  }
}

function completedContent(
  move: ServerMoveStatus,
  location: CurrentAppLocation,
): ServerMoveOverlayContent {
  return move.mode === "direct"
    ? {
        kind: "redirecting",
        move,
        destination: serverMoveDestinationUrl(move.serverUrl, location),
      }
    : { kind: "reconnecting", move };
}

export function serverMoveOverlayPollIntervalMs(args: {
  content: ServerMoveOverlayContent | null;
  realtimeConnected: boolean;
  intervalMs: number;
}): number | null {
  const { content } = args;
  if (content === null) {
    return null;
  }
  if (content.kind === "reconnecting") {
    return args.intervalMs;
  }
  if (content.kind === "recovery") {
    return args.realtimeConnected ? null : args.intervalMs;
  }
  if (content.kind !== "progress") {
    return null;
  }
  return content.move.state === "switching" || !args.realtimeConnected
    ? args.intervalMs
    : null;
}
