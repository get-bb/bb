import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import {
  GATE_FAST_OFFLINE_HEADER,
  GATE_FORWARDED_AUTH_HEADER,
  GATE_FORWARDED_HOST_HEADER,
  GATE_OFFLINE_HEADER,
} from "@bb/tunnel-contract/next";
import { text, type Reply } from "./reply.js";
import { withoutPort } from "./visitor.js";

export interface ForwardedVisit {
  publicHost: string;
  publicOrigin: string;
  publicBaseDomain: string;
  fastOffline: boolean;
}

export type ForwardedCheck =
  | { kind: "direct" }
  | { kind: "forwarded"; visit: ForwardedVisit }
  | { kind: "refused"; reason: string };

export interface ForwardedPolicy {
  baseDomain: string;
  forwardedBaseDomain: string | null;
  scheme: "http" | "https";
  secret: string;
}

const PUBLIC_PORT = /^:\d{1,5}$/u;

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export function forwardedSecretMatches(
  header: string,
  secret: string,
): boolean {
  if (secret === "") return false;
  return timingSafeEqual(digest(header), digest(`Bearer ${secret}`));
}

export function checkForwarded(
  headers: IncomingHttpHeaders,
  host: string,
  policy: ForwardedPolicy,
): ForwardedCheck {
  const forwardedHost = single(
    headers[GATE_FORWARDED_HOST_HEADER],
  )?.toLowerCase();
  const auth = single(headers[GATE_FORWARDED_AUTH_HEADER]);
  if (forwardedHost === undefined && auth === undefined) {
    return { kind: "direct" };
  }
  if (forwardedHost === undefined || auth === undefined) {
    return { kind: "refused", reason: "incomplete" };
  }
  if (!forwardedSecretMatches(auth, policy.secret)) {
    return { kind: "refused", reason: "secret" };
  }
  const publicBase = policy.forwardedBaseDomain;
  if (publicBase === null) return { kind: "refused", reason: "disabled" };
  const visitorHost = withoutPort(host);
  const suffix = `.${policy.baseDomain}`;
  if (!visitorHost.endsWith(suffix)) {
    return { kind: "refused", reason: "host" };
  }
  const subdomain = visitorHost.slice(0, -suffix.length);
  const expected = `${subdomain}.${publicBase}`;
  const port = forwardedHost.slice(expected.length);
  if (
    subdomain === "" ||
    subdomain.includes(".") ||
    !forwardedHost.startsWith(expected) ||
    (port !== "" && !PUBLIC_PORT.test(port))
  ) {
    return { kind: "refused", reason: "host" };
  }
  return {
    kind: "forwarded",
    visit: {
      publicHost: forwardedHost,
      publicOrigin: `${policy.scheme}://${forwardedHost}`,
      publicBaseDomain: publicBase,
      fastOffline: single(headers[GATE_FAST_OFFLINE_HEADER]) === "1",
    },
  };
}

export function forwardedBaseDomainFor(baseDomain: string): string | null {
  return baseDomain.startsWith("next.")
    ? baseDomain.slice("next.".length)
    : null;
}

export function forwardRefusedReply(): Reply {
  return text("bb connect: forwarded request refused\n", 403);
}

export function fastOfflineReply(): Reply {
  const reply = text(
    "bb connect: this server is offline (no tunnel connected)\n",
    503,
  );
  reply.headers[GATE_OFFLINE_HEADER] = "1";
  reply.headers["cache-control"] = "no-store";
  return reply;
}
