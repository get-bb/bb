import type { BbDesktopServerTarget } from "@bb/desktop-contract";
import { isConnectServerUrl } from "./connect-target-origin.js";
import {
  BUILTIN_SERVER_ID,
  BUILTIN_SERVER_NAME,
  connectServerId,
  type ConnectServerRef,
  type CustomServerRef,
} from "./server-target.js";

export interface BuildServerTargetOptionsArgs {
  connectServers: readonly ConnectServerRef[];
  connectTrusted: boolean;
  customServers: readonly CustomServerRef[];
  selectedServerId: string;
}

export function buildServerTargetOptions(
  args: BuildServerTargetOptionsArgs,
): BbDesktopServerTarget["servers"] {
  const servers: BbDesktopServerTarget["servers"] = [
    {
      id: BUILTIN_SERVER_ID,
      kind: "builtin",
      name: BUILTIN_SERVER_NAME,
      selected: args.selectedServerId === BUILTIN_SERVER_ID,
      url: null,
    },
  ];
  if (args.connectTrusted) {
    for (const server of args.connectServers) {
      const id = connectServerId(server.handle);
      servers.push({
        id,
        kind: "connect",
        name: server.name,
        selected: args.selectedServerId === id,
        url: server.url,
      });
    }
  }
  for (const server of args.customServers) {
    servers.push({
      id: server.id,
      kind: "custom",
      name: server.name,
      selected: args.selectedServerId === server.id,
      url: server.url,
    });
  }
  return servers;
}

export function shouldAuthenticateCustomWithConnect(args: {
  connectTrusted: boolean;
  url: string;
}): boolean {
  return args.connectTrusted && isConnectServerUrl(args.url);
}
