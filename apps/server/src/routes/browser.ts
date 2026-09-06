import {
  publicApiRoutes,
  typedRoutes,
  type BrowserBatchResponse,
  type BrowserControlError,
  type PublicApiSchema,
} from "@bb/server-contract";
import type { Hono } from "hono";
import { ApiError } from "../errors.js";
import { BrowserControlRemoteError } from "../ws/hub.js";
import { requirePublicThread } from "../services/lib/entity-lookup.js";
import type { PluginService } from "../services/plugins/plugin-service.js";
import type { AppDeps } from "../types.js";
const BROWSER_BATCH_MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
function browserControlError(
  error: unknown,
  fallbackCode: string,
  fallbackMessage: string,
): BrowserControlError {
  const message =
    error instanceof Error && error.message.length > 0
      ? error.message
      : fallbackMessage;
  const code =
    error instanceof BrowserControlRemoteError ? error.code : fallbackCode;
  if (
    error instanceof BrowserControlRemoteError &&
    error.details !== undefined
  ) {
    return {
      code,
      message: message.slice(0, 2_048),
      details: error.details,
    };
  }
  return { code, message: message.slice(0, 2_048) };
}

export function registerBrowserRoutes(
  app: Hono,
  deps: AppDeps,
  pluginService: PluginService,
): void {
  deps.hub.setBrowserPluginContributionAuthorizer(pluginService.isPluginLoaded);
  const { get, post } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (message) =>
      new ApiError(400, "invalid_request", message),
  });
  const routes = publicApiRoutes.browser;

  get(routes.tabs, (context) =>
    context.json({
      tabs: deps.hub.listBrowserTabs(),
      owners: deps.hub.listBrowserTabOwners(),
    }),
  );

  post(routes.open, async (context, payload) => {
    const thread =
      payload.threadId === undefined
        ? null
        : requirePublicThread(deps.db, payload.threadId);
    if (
      thread !== null &&
      payload.projectId !== undefined &&
      payload.projectId !== thread.projectId
    ) {
      throw new ApiError(
        400,
        "invalid_request",
        "Browser thread and project do not match",
      );
    }
    try {
      const target = await deps.hub.openBrowserTab({
        ...payload,
        ...(thread === null ? {} : { projectId: thread.projectId }),
        signal: context.req.raw.signal,
      });
      return context.json({ target });
    } catch (error) {
      const browserError = browserControlError(
        error,
        "browser_unavailable",
        "Browser tab creation failed",
      );
      throw new ApiError(
        409,
        browserError.code,
        browserError.message,
        browserError.details === undefined
          ? true
          : { details: browserError.details, retryable: true },
      );
    }
  });

  post(routes.control, async (context, payload) => {
    try {
      const value = await deps.hub.runBrowserControl({
        action: payload.action,
        signal: context.req.raw.signal,
        target: payload.target,
        timeoutMs: payload.timeoutMs,
      });
      return context.json({ value });
    } catch (error) {
      const browserError = browserControlError(
        error,
        "browser_unavailable",
        "Browser action failed",
      );
      throw new ApiError(
        409,
        browserError.code,
        browserError.message,
        browserError.details === undefined
          ? true
          : { details: browserError.details, retryable: true },
      );
    }
  });
  post(routes.capture, async (context, payload) => {
    try {
      const chunk = await deps.hub.readBrowserCapture({
        clientId: payload.clientId,
        windowId: payload.windowId,
        tabId: payload.tabId,
        captureId: payload.captureId,
        offset: payload.offset,
        length: payload.length,
        timeoutMs: 10_000,
        signal: context.req.raw.signal,
      });
      return context.json({
        captureId: chunk.captureId,
        offset: chunk.offset,
        base64: chunk.base64,
        eof: chunk.eof,
      });
    } catch (error) {
      throw new ApiError(
        409,
        error instanceof Error ? error.name : "browser_capture_unavailable",
        error instanceof Error ? error.message : "Browser capture read failed",
        true,
      );
    }
  });
  post(routes.captureCreate, async (context, payload) => {
    try {
      const descriptor = await deps.hub.createBrowserCapture({
        clientId: payload.clientId,
        windowId: payload.windowId,
        tabId: payload.tabId,
        mode: payload.mode,
        format: payload.format,
        quality: payload.quality,
        locator: payload.locator,
        expectedNavigationEpoch: payload.expectedNavigationEpoch,
        timeoutMs: 10_000,
        signal: context.req.raw.signal,
      });
      return context.json(descriptor);
    } catch (error) {
      throw new ApiError(
        409,
        error instanceof Error ? error.name : "browser_capture_unavailable",
        error instanceof Error
          ? error.message
          : "Browser capture creation failed",
        true,
      );
    }
  });
  post(routes.captureRelease, async (context, payload) => {
    try {
      deps.hub.releaseBrowserCapture({
        clientId: payload.clientId,
        windowId: payload.windowId,
        tabId: payload.tabId,
        captureId: payload.captureId,
      });
      return context.json({ released: true });
    } catch (error) {
      throw new ApiError(
        409,
        error instanceof Error ? error.name : "browser_capture_unavailable",
        error instanceof Error
          ? error.message
          : "Browser capture release failed",
        true,
      );
    }
  });
  post(routes.plugin, async (context, payload) => {
    // Fail closed before dispatch: an unknown, disabled, not-yet-loaded, or
    // reloaded plugin runtime must never receive a contribution request.
    if (!pluginService.isPluginLoaded(payload.pluginId)) {
      throw new ApiError(
        409,
        "browser_contribution_unavailable",
        "The requested Browser plugin is not enabled or not running",
        false,
      );
    }
    try {
      const value = await deps.hub.requestBrowserPluginContribution({
        pluginId: payload.pluginId,
        target: payload.target,
        controllerId: payload.controllerId,
        input: payload.input,
        timeoutMs: payload.timeoutMs,
        signal: context.req.raw.signal,
      });
      return context.json({ value });
    } catch (error) {
      throw new ApiError(
        409,
        error instanceof Error ? error.name : "browser_contribution_failed",
        error instanceof Error ? error.message : "Browser contribution failed",
        true,
      );
    }
  });
  post(routes.batch, async (context, payload) => {
    const results: BrowserBatchResponse["results"] = [];
    let responseBytes = 0;
    for (
      let offset = 0;
      offset < payload.items.length;
      offset += payload.concurrency
    ) {
      const group = payload.items.slice(offset, offset + payload.concurrency);
      const groupResults = await Promise.all(
        group.map(async (item) => {
          try {
            const value = await deps.hub.runBrowserControl({
              action: item.action,
              signal: context.req.raw.signal,
              target: item.target,
              timeoutMs: payload.timeoutMs,
            });
            return { id: item.id, ok: true as const, value };
          } catch (error) {
            const browserError = browserControlError(
              error,
              "browser_unavailable",
              "Browser action failed",
            );
            return {
              id: item.id,
              ok: false as const,
              error: browserError,
            };
          }
        }),
      );
      for (const result of groupResults) {
        const bytes = new TextEncoder().encode(
          JSON.stringify(result),
        ).byteLength;
        if (responseBytes + bytes > BROWSER_BATCH_MAX_RESPONSE_BYTES) {
          results.push({
            id: result.id,
            ok: false,
            error: {
              code: "browser_batch_response_too_large",
              message:
                "Browser batch response exceeded the aggregate byte limit",
            },
          });
        } else {
          results.push(result);
          responseBytes += bytes;
        }
      }
    }
    return context.json({ results });
  });
}
