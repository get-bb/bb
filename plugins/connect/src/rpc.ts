import { z } from "zod";
import { ConnectListError } from "./list-servers.js";
import { ConnectPairError } from "./redeem.js";
import type { ConnectTunnel } from "./tunnel.js";
import type { ConnectStatus } from "./types.js";
import type { ListAccountServersResult } from "./list-servers.js";

// Panel-facing rpc surface. `server` is optional: the dashboard command
// carries both --code and --server, but the panel's paste-a-code field only
// has the code — the server URL is then derived from the redeemed handle
// (https://<handle>.getbb.app). `baseUrl` overrides the connect cloud apex
// (tests and self-hosted gates).
const pairInputSchema = z.object({
  code: z.string().min(1),
  server: z.string().url().optional(),
  baseUrl: z.string().url().optional(),
});

const portInputSchema = z.object({
  port: z.number().int().min(1).max(65535),
});

export type ConnectRpcHandlers = {
  pair(input: unknown): Promise<ConnectStatus>;
  status(): ConnectStatus;
  disconnect(): Promise<ConnectStatus>;
  expose(input: unknown): Promise<{ port: number; url: string }>;
  unexpose(input: unknown): Promise<{ removed: boolean; port: number }>;
  listShares(): Array<{ port: number; url: string }>;
  listAccountServers(): Promise<ListAccountServersResult>;
};

export function createRpcHandlers(tunnel: ConnectTunnel): ConnectRpcHandlers {
  return {
    async pair(input: unknown) {
      const args = pairInputSchema.parse(input);
      try {
        return await tunnel.pair({
          code: args.code,
          ...(args.server !== undefined ? { serverUrl: args.server } : {}),
          ...(args.baseUrl !== undefined ? { baseUrl: args.baseUrl } : {}),
        });
      } catch (error) {
        // The panel maps stable codes to human copy; raw detail stays in the
        // plugin log (see ConnectTunnel.pair). Never surface wire text.
        if (error instanceof ConnectPairError) {
          throw new Error(error.code);
        }
        throw error;
      }
    },
    status() {
      return tunnel.status();
    },
    async disconnect() {
      return tunnel.disconnect();
    },
    async expose(input: unknown) {
      const args = portInputSchema.parse(input);
      return tunnel.expose(args.port);
    },
    async unexpose(input: unknown) {
      const args = portInputSchema.parse(input);
      return tunnel.unexpose(args.port);
    },
    listShares() {
      return tunnel.listShares();
    },
    async listAccountServers() {
      try {
        return await tunnel.listAccountServers();
      } catch (error) {
        // Stable codes for callers (CLI / panel); raw detail stays on the error
        // message for plugin logs when surfaced elsewhere.
        if (error instanceof ConnectListError) {
          throw new Error(error.code);
        }
        throw error;
      }
    },
  };
}
