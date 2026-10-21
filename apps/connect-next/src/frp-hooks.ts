import * as http from "node:http";
import { RESERVED_HANDLES } from "@bb/connect-db";
import {
  FRP_CREDENTIAL_META,
  FRP_LOGIN_REFUSED_REASON,
} from "@bb/tunnel-contract/next";
import type { AccountApi } from "./account-api.js";
import type { TunnelDirectory } from "./directory.js";
import { errorText, type Log } from "./log.js";

export const FRP_HOOK_PATH = "/frp";
export const FRP_HOOK_OPS = ["Login", "NewProxy", "CloseProxy", "Ping"];

const LABEL = /^[a-z0-9][a-z0-9-]{0,62}$/u;
const SHARE_PORT = /^[1-9]\d{0,4}$/u;
const MAX_HOOK_BODY_BYTES = 64 * 1024;
const ROUTE_SETTLE_MS = 150;
export const REMOVAL_SETTLE_MS = 500;
export const HOOK_RESOLVE_DEADLINE_MS = 7_000;

type HookAnswer =
  | { reject: false; unchange: true }
  | { reject: true; reject_reason: string };

const ACCEPT: HookAnswer = { reject: false, unchange: true };

function reject(reason: string): HookAnswer {
  return { reject: true, reject_reason: reason };
}

interface HookUser {
  label: string;
  credential: string | null;
  runId: string;
}

interface HookCall {
  op: string;
  user: HookUser;
  proxyName: string | null;
  proxyType: string | null;
  subdomain: string | null;
  customDomains: string[];
  clientAddress: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function parseMetas(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const credential = value[FRP_CREDENTIAL_META];
  return typeof credential === "string" && credential !== ""
    ? credential
    : null;
}

export function parseHookCall(value: unknown): HookCall | null {
  if (!isRecord(value) || typeof value.op !== "string") return null;
  const content = value.content;
  if (!isRecord(content)) return null;
  let user: HookUser;
  if (typeof content.user === "string") {
    user = {
      label: content.user,
      credential: parseMetas(content.metas),
      runId: optionalString(content.run_id) ?? "",
    };
  } else if (isRecord(content.user) && typeof content.user.user === "string") {
    user = {
      label: content.user.user,
      credential: parseMetas(content.user.metas),
      runId: optionalString(content.user.run_id) ?? "",
    };
  } else {
    return null;
  }
  const domains = content.custom_domains;
  const customDomains = Array.isArray(domains)
    ? domains.filter((domain): domain is string => typeof domain === "string")
    : [];
  if (Array.isArray(domains) && customDomains.length !== domains.length) {
    return null;
  }
  return {
    op: value.op,
    user,
    proxyName: optionalString(content.proxy_name),
    proxyType: optionalString(content.proxy_type),
    subdomain: optionalString(content.subdomain),
    customDomains,
    clientAddress: optionalString(content.client_address),
  };
}

export function isOwnSubdomain(label: string, subdomain: string): boolean {
  if (subdomain === label) return true;
  const prefix = `${label}--`;
  if (!subdomain.startsWith(prefix)) return false;
  const port = subdomain.slice(prefix.length);
  return SHARE_PORT.test(port) && Number(port) <= 65535;
}

export interface FrpHookOptions {
  accounts: AccountApi;
  directory: TunnelDirectory;
  log: Log;
  onLogin?: (clientAddress: string, label: string) => void;
  clientConnected?: (label: string) => boolean;
}

export function createFrpHooks(options: FrpHookOptions) {
  const { accounts, directory, log } = options;
  const proxies = new Map<string, { label: string; subdomain: string }>();
  const pendingRoutes = new Map<string, NodeJS.Timeout>();

  type Verdict = "linked" | "refused" | "unknown";

  async function verify(user: HookUser): Promise<Verdict> {
    if (user.credential === null) return "refused";
    try {
      const answer = await accounts.resolve(
        {
          label: user.label,
          session: null,
          desktopSession: null,
          credential: user.credential,
          machineCredential: null,
          oauth: null,
        },
        { deadlineMs: HOOK_RESOLVE_DEADLINE_MS },
      );
      const linked =
        answer.label !== null &&
        !answer.label.revoked &&
        answer.credential === true;
      return linked ? "linked" : "refused";
    } catch (error) {
      log("warn", "frp_check_failed", {
        label: user.label,
        error: errorText(error),
      });
      return "unknown";
    }
  }

  async function handle(call: HookCall): Promise<HookAnswer> {
    const { user } = call;
    const unknownServer =
      call.op === "Login" ? FRP_LOGIN_REFUSED_REASON : "unknown server";
    if (!LABEL.test(user.label) || user.label.includes("--")) {
      return reject(unknownServer);
    }
    if (RESERVED_HANDLES.has(user.label)) return reject(unknownServer);
    if (call.op === "Login") {
      if (user.credential === null) return reject(FRP_LOGIN_REFUSED_REASON);
      const verdict = await verify(user);
      if (verdict === "unknown") return reject("the gate could not check this");
      if (verdict === "refused") {
        log("warn", "frp_login_refused", { label: user.label });
        return reject(FRP_LOGIN_REFUSED_REASON);
      }
      log("info", "frp_login", { label: user.label });
      if (call.clientAddress !== null) {
        options.onLogin?.(call.clientAddress, user.label);
      }
      return ACCEPT;
    }
    if (call.op === "NewProxy") {
      if (
        call.proxyType !== "http" ||
        call.subdomain === null ||
        !isOwnSubdomain(user.label, call.subdomain) ||
        call.customDomains.length > 0
      ) {
        log("warn", "frp_proxy_refused", { label: user.label });
        return reject("not this server's address");
      }
      const verdict = await verify(user);
      if (verdict === "unknown") return reject("the gate could not check this");
      if (verdict === "refused") return reject("credential refused");
      const proxyKey = `${user.runId}\n${call.proxyName ?? ""}`;
      const proxy = { label: user.label, subdomain: call.subdomain };
      const previous = proxies.get(proxyKey);
      if (previous !== undefined) {
        directory.disconnected({ ...previous, clientId: proxyKey });
      }
      proxies.set(proxyKey, proxy);
      const routed = setTimeout(() => {
        pendingRoutes.delete(proxyKey);
        if (proxies.get(proxyKey) === proxy) {
          directory.connected({ ...proxy, clientId: proxyKey });
        }
      }, ROUTE_SETTLE_MS);
      pendingRoutes.set(proxyKey, routed);
      log("info", "frp_proxy_open", {
        label: user.label,
        subdomain: call.subdomain,
      });
      return ACCEPT;
    }
    if (call.op === "CloseProxy") {
      const proxyKey = `${user.runId}\n${call.proxyName ?? ""}`;
      const proxy = proxies.get(proxyKey);
      clearTimeout(pendingRoutes.get(proxyKey));
      pendingRoutes.delete(proxyKey);
      if (proxy !== undefined) {
        proxies.delete(proxyKey);
        directory.disconnected({ ...proxy, clientId: proxyKey });
        log("info", "frp_proxy_closed", {
          label: proxy.label,
          subdomain: proxy.subdomain,
        });
        const clientConnected = options.clientConnected;
        if (clientConnected !== undefined) {
          setTimeout(() => {
            if (clientConnected(proxy.label)) {
              directory.removed(proxy.subdomain);
            }
          }, REMOVAL_SETTLE_MS).unref();
        }
      }
      return ACCEPT;
    }
    if (call.op === "Ping") {
      const verdict = await verify(user);
      if (verdict === "refused") {
        log("warn", "frp_ping_refused", { label: user.label });
        return reject("credential refused");
      }
      return ACCEPT;
    }
    return ACCEPT;
  }

  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const answer = (body: HookAnswer) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    };
    if (request.method !== "POST" || !request.url?.startsWith(FRP_HOOK_PATH)) {
      request.resume();
      response.writeHead(404).end();
      return;
    }
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= MAX_HOOK_BODY_BYTES) chunks.push(chunk);
    });
    request.on("end", () => {
      if (size > MAX_HOOK_BODY_BYTES) {
        answer(reject("request too large"));
        return;
      }
      let call: HookCall | null = null;
      try {
        call = parseHookCall(JSON.parse(Buffer.concat(chunks).toString()));
      } catch {
        call = null;
      }
      if (call === null) {
        answer(reject("malformed request"));
        return;
      }
      handle(call).then(answer, (error: unknown) => {
        log("error", "frp_hook_failed", { error: errorText(error) });
        answer(reject("the gate could not check this"));
      });
    });
  });

  return { server };
}
