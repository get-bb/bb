import { getExperiments } from "@bb/db";
import {
  publicApiRoutes,
  typedRoutes,
  type BrowserCommandRequest,
  type BrowserPublicCommandResult,
  type PublicApiSchema,
} from "@bb/server-contract";
import type { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { ApiError } from "../errors.js";
import { requirePublicThreadEnvironment } from "../services/lib/entity-lookup.js";
import type { AppDeps } from "../types.js";

type BrowserRouteDeps = Pick<AppDeps, "browserArtifacts" | "browserAutomation" | "db">;

export const BROWSER_REQUEST_MAX_BYTES = 256 * 1024;

function requireBrowserEnabled(deps: BrowserRouteDeps): void {
  if (!getExperiments(deps.db).browserAutomation) {
    throw new ApiError(404, "not_found", "Browser automation is unavailable");
  }
}

function requireCallerHost(deps: BrowserRouteDeps, threadId: string, callerHostId: string): string {
  const lookup = requirePublicThreadEnvironment(deps.db, threadId);
  if (lookup.environment.hostId !== callerHostId) {
    throw new ApiError(403, "browser_host_mismatch", "Browser automation caller host does not own this thread");
  }
  return lookup.thread.id;
}

async function runCommand(deps: BrowserRouteDeps, targetId: string, payload: BrowserCommandRequest): Promise<BrowserPublicCommandResult> {
  const threadId = requireCallerHost(deps, payload.threadId, payload.callerHostId);
  const result = await deps.browserAutomation.run({
    command: payload.command,
    targetId,
    threadId,
    timeoutMs: payload.timeoutMs,
  });
  if (result.kind !== "screenshot") return result;
  const artifact = await deps.browserArtifacts.store({
    base64: result.base64,
    targetId,
    threadId,
  });
  return { artifact, kind: "screenshot" };
}

export function registerBrowserRoutes(app: Hono, deps: BrowserRouteDeps): void {
  const { get, post } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (message) => new ApiError(400, "invalid_request", message),
  });
  const routes = publicApiRoutes.browser;
  const limitBrowserBody = bodyLimit({
    maxSize: BROWSER_REQUEST_MAX_BYTES,
    onError: (context) => context.json({ code: "payload_too_large", message: "Browser request body is too large" }, 413),
  });
  app.use(routes.open.path, limitBrowserBody);
  app.use(routes.command.path, limitBrowserBody);
  app.use(routes.close.path, limitBrowserBody);

  post(routes.open, async (context, payload) => {
    requireBrowserEnabled(deps);
    const threadId = requireCallerHost(deps, payload.threadId, payload.callerHostId);
    const target = await deps.browserAutomation.open({ threadId, timeoutMs: payload.timeoutMs, url: payload.url });
    return context.json(target, 201);
  });

  get(routes.list, (context, query) => {
    requireBrowserEnabled(deps);
    const threadId = requireCallerHost(deps, query.threadId, query.callerHostId);
    return context.json({ targets: deps.browserAutomation.list({ threadId }) });
  });

  post(routes.command, async (context, payload) => {
    requireBrowserEnabled(deps);
    return context.json(await runCommand(deps, context.req.param("targetId"), payload));
  });

  post(routes.close, (context, payload) => {
    requireBrowserEnabled(deps);
    const threadId = requireCallerHost(deps, payload.threadId, payload.callerHostId);
    return context.json(deps.browserAutomation.close({ targetId: context.req.param("targetId"), threadId }));
  });

  get(routes.artifactMetadata, async (context, query) => {
    requireBrowserEnabled(deps);
    const threadId = requireCallerHost(deps, query.threadId, query.callerHostId);
    return context.json(await deps.browserArtifacts.metadata({ artifactId: context.req.param("artifactId"), threadId }));
  });

  get(routes.artifactContent, async (context, query) => {
    requireBrowserEnabled(deps);
    const threadId = requireCallerHost(deps, query.threadId, query.callerHostId);
    const content = await deps.browserArtifacts.read({ artifactId: context.req.param("artifactId"), threadId });
    return context.body(new Uint8Array(content), 200, {
      "cache-control": "private, no-store",
      "content-disposition": `attachment; filename="${context.req.param("artifactId")}.png"`,
      "content-type": "image/png",
    });
  });
}
