import { createHash, randomBytes } from "node:crypto";
import {
  createNodeBbSdk,
  createRequestTimeoutFetch,
  DEFAULT_BB_REQUEST_TIMEOUT_MS,
  type BbSdk,
} from "@bb/sdk";
import type { ExperimentalPluginRpcCaller } from "@get-bb/plugin-sdk";

export const PLUGIN_RPC_CALLER_HEADER = "x-bb-plugin-caller";

export interface PluginRpcCallerCredential {
  readonly token: string;
  revoke(): void;
}

export type PluginRpcCallerResolution =
  | { ok: true; caller: ExperimentalPluginRpcCaller }
  | { ok: false };

export interface PluginRpcCallerRegistry {
  issue(pluginId: string): PluginRpcCallerCredential;
  resolve(token: string | undefined): PluginRpcCallerResolution;
}

function tokenKey(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createPluginRpcCallerRegistry(): PluginRpcCallerRegistry {
  const callers = new Map<string, string>();
  return {
    issue(pluginId) {
      const token = randomBytes(32).toString("base64url");
      const key = tokenKey(token);
      callers.set(key, pluginId);
      return {
        token,
        revoke() {
          callers.delete(key);
        },
      };
    },
    resolve(token) {
      if (token === undefined) return { ok: true, caller: { kind: "client" } };
      const pluginId = callers.get(tokenKey(token));
      return pluginId === undefined
        ? { ok: false }
        : { ok: true, caller: { kind: "plugin", pluginId } };
    },
  };
}

export function createPluginRpcCallerSdk(args: {
  baseUrl: string;
  token: string;
}): BbSdk {
  const timeoutFetch = createRequestTimeoutFetch({
    timeoutMs: DEFAULT_BB_REQUEST_TIMEOUT_MS,
  });
  return createNodeBbSdk({
    baseUrl: args.baseUrl,
    fetch: (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set(PLUGIN_RPC_CALLER_HEADER, args.token);
      return timeoutFetch(input, { ...init, headers });
    },
  });
}
