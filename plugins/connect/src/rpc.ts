import { z } from "zod";
import type { ConnectTunnel } from "./tunnel.js";
import type { ConnectStatus } from "./types.js";

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
};

export function createRpcHandlers(tunnel: ConnectTunnel): ConnectRpcHandlers {
  return {
    async pair(input: unknown) {
      const args = pairInputSchema.parse(input);
      return tunnel.pair({
        code: args.code,
        ...(args.server !== undefined ? { serverUrl: args.server } : {}),
        ...(args.baseUrl !== undefined ? { baseUrl: args.baseUrl } : {}),
      });
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
  };
}
