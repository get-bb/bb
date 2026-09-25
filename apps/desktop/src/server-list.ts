import { createHash } from "node:crypto";
import type { BbDesktopServerTarget } from "@bb/desktop-contract";
import {
  BUILTIN_SERVER_NAME,
  type ConnectServerRef,
  type CustomServer,
  type DesktopServerTarget,
} from "./server-target.js";

export const BUILTIN_SERVER_ID = "builtin";

export interface DesktopServerListEntry extends BbDesktopServerTarget {
  connectServer: ConnectServerRef | null;
  customUrl: string | null;
}

interface BuildDesktopServerListArgs {
  connectServers: readonly ConnectServerRef[];
  customServers: readonly CustomServer[];
  showBuiltinServer: boolean;
  target: DesktopServerTarget;
}

export function formatCustomServerName(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.host.length > 0 ? parsed.host : url;
  } catch {
    return url;
  }
}

export function customServerId(url: string): string {
  return `custom:${createHash("sha256").update(url).digest("hex").slice(0, 16)}`;
}

export function buildDesktopServerList(
  args: BuildDesktopServerListArgs,
): DesktopServerListEntry[] {
  const { target } = args;
  const others: DesktopServerListEntry[] = [
    ...args.connectServers.map((server) => ({
      active:
        target.kind === "connect" && target.server.handle === server.handle,
      connectServer: server,
      customUrl: null,
      id: `connect:${server.handle}`,
      kind: "connect" as const,
      name: server.name,
    })),
    ...args.customServers.map((server) => ({
      active: target.kind === "custom" && target.url === server.url,
      connectServer: null,
      customUrl: server.url,
      id: customServerId(server.url),
      kind: "custom" as const,
      name: server.name ?? formatCustomServerName(server.url),
    })),
  ];
  const showBuiltin =
    args.showBuiltinServer || target.kind === "builtin" || others.length === 0;
  return [
    ...(showBuiltin
      ? [
          {
            active: target.kind === "builtin",
            connectServer: null,
            customUrl: null,
            id: BUILTIN_SERVER_ID,
            kind: "builtin" as const,
            name: BUILTIN_SERVER_NAME,
          },
        ]
      : []),
    ...others,
  ];
}
