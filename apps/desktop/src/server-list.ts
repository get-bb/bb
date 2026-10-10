import { createHash } from "node:crypto";
import type { BbDesktopServerChoice } from "@bb/desktop-contract";
import {
  BUILTIN_SERVER_NAME,
  type ConnectServerRef,
  type ServerTargetStore,
} from "./server-target.js";

export function customServerId(url: string): string {
  return `custom:${createHash("sha256").update(url).digest("hex")}`;
}

export function buildDesktopServerChoices(
  store: ServerTargetStore | null,
  connectServers: readonly ConnectServerRef[],
): BbDesktopServerChoice[] {
  const target = store?.getTarget() ?? { kind: "builtin" };
  return [
    {
      id: "builtin",
      name: BUILTIN_SERVER_NAME,
      active: target.kind === "builtin",
    },
    ...connectServers.map((server) => ({
      id: `connect:${server.handle}`,
      name: server.name,
      active:
        target.kind === "connect" && target.server.handle === server.handle,
    })),
    ...(store?.getCustomServerUrls() ?? []).map((url) => ({
      id: customServerId(url),
      name: new URL(url).host,
      active: target.kind === "custom" && target.url === url,
    })),
  ];
}
