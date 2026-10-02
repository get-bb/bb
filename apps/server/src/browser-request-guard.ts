import {
  buildLocalAppOrigins,
  type BuildLocalAppOriginsArgs,
} from "@bb/config/local-app-origins";
import type { ServerRuntimeConfig } from "./types.js";

interface BrowserRequestGuardDeps {
  config: Pick<ServerRuntimeConfig, "serverPort" | "appUrl" | "devAppPort">;
}

export interface BrowserRequestProblem {
  status: 403 | 415;
  error: string;
}

interface BrowserRequestGuardOptions {
  checkOrigin?: boolean;
  requireJsonForMutation?: boolean;
}

interface BrowserRequestContext {
  req: {
    url: string;
    method: string;
    header(name: string): string | undefined;
  };
}

export function allowedAppOrigins(deps: BrowserRequestGuardDeps): Set<string> {
  const args: BuildLocalAppOriginsArgs = {
    serverPort: deps.config.serverPort,
  };
  if (deps.config.appUrl !== undefined) {
    args.appUrl = deps.config.appUrl;
  }
  if (deps.config.devAppPort !== undefined) {
    args.devAppPort = deps.config.devAppPort;
  }
  return new Set(
    buildLocalAppOrigins(args).filter(
      (origin) => origin.startsWith("http://") || origin.startsWith("https://"),
    ),
  );
}

export function effectivePort(url: URL): number | null {
  if (url.port.length > 0) {
    const port = Number(url.port);
    return Number.isInteger(port) ? port : null;
  }
  if (url.protocol === "http:") {
    return 80;
  }
  if (url.protocol === "https:") {
    return 443;
  }
  return null;
}

function parseRequestHostname(host: string | undefined): string | null {
  if (host === undefined) {
    return null;
  }
  const authority = /^(\[[0-9a-f:]+\]|[a-z0-9.-]+)(?::([0-9]+))?$/iu.exec(host);
  if (authority === null) {
    return null;
  }
  const hostname = authority[1]?.toLowerCase();
  if (hostname === undefined) {
    return null;
  }
  if (authority[2] !== undefined && Number(authority[2]) === 0) {
    return null;
  }
  try {
    const url = new URL(`http://${host}`);
    return url.hostname === hostname ? hostname : null;
  } catch {
    return null;
  }
}

function isTrustedOrigin(
  context: BrowserRequestContext,
  deps: BrowserRequestGuardDeps,
  checkOrigin: boolean,
): boolean {
  const hostname = parseRequestHostname(context.req.header("host"));
  if (hostname === null) {
    return false;
  }
  const origins = allowedAppOrigins(deps);
  if (![...origins].some((origin) => new URL(origin).hostname === hostname)) {
    return false;
  }
  const origin = context.req.header("origin");
  if (!checkOrigin || origin === undefined) {
    return true;
  }
  return origins.has(origin);
}

function isJsonContentType(contentType: string | undefined): boolean {
  return (
    contentType?.split(";", 1)[0]?.trim().toLowerCase() === "application/json"
  );
}

export function browserRequestProblem(
  context: BrowserRequestContext,
  deps: BrowserRequestGuardDeps,
  options: BrowserRequestGuardOptions = {},
): BrowserRequestProblem | null {
  if (!isTrustedOrigin(context, deps, options.checkOrigin !== false)) {
    return {
      status: 403,
      error: "Host or Origin is not a configured BB app address",
    };
  }

  const method = context.req.method.toUpperCase();
  if (
    options.requireJsonForMutation === true &&
    method !== "GET" &&
    method !== "HEAD" &&
    method !== "OPTIONS" &&
    !isJsonContentType(context.req.header("content-type"))
  ) {
    return {
      status: 415,
      error: "content-type must be application/json",
    };
  }

  return null;
}
