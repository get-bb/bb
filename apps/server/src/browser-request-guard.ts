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
  requireJsonForMutation?: boolean;
}

interface BrowserRequestContext {
  req: {
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
  return new Set(buildLocalAppOrigins(args));
}

function isTrustedOrigin(
  deps: BrowserRequestGuardDeps,
  origin: string,
): boolean {
  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return false;
  }
  if (
    originUrl.origin !== origin ||
    (originUrl.protocol !== "http:" && originUrl.protocol !== "https:")
  ) {
    return false;
  }

  return allowedAppOrigins(deps).has(originUrl.origin);
}

function isJsonContentType(contentType: string | undefined): boolean {
  return (
    contentType?.split(";", 1)[0]?.trim().toLowerCase() === "application/json"
  );
}

/**
 * Guards privileged local-browser boundaries without imposing credentials on
 * non-browser clients. Browsers send Origin; Node SDK, CLI, and server-to-server
 * callers commonly do not. Only configured app origins are trusted; request
 * Host and X-Forwarded-Host headers never expand that allowlist.
 */
export function browserRequestProblem(
  context: BrowserRequestContext,
  deps: BrowserRequestGuardDeps,
  options: BrowserRequestGuardOptions = {},
): BrowserRequestProblem | null {
  const origin = context.req.header("origin");
  if (origin !== undefined && !isTrustedOrigin(deps, origin)) {
    return {
      status: 403,
      error: `origin "${origin}" is not a local BB app origin`,
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
