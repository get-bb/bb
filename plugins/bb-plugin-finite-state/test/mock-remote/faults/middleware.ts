import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { MockHandler, MockHandlerContext, MockHandlerRegistry } from "../types.js";
import type { FaultControllerRuntime, FaultSelection } from "./controller.js";
import {
  FORGE_CREATE_ROUTE,
  FORGE_PREPARE_ROUTE,
  type FaultService,
} from "./scenarios.js";

const TRANSPORT_RESET_STATUS = 599;
export const MOCK_TRANSPORT_RESET_HEADER = "X-FS-Mock-Transport-Reset";

function frozenFaultResponse(
  context: MockHandlerContext,
  fileName: string,
  status: number,
): Response {
  return new Response(readFileSync(resolve(context.fixtureRoot, "faults", fileName)), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function requestWithJson(request: Request, value: unknown): Request {
  const headers = new Headers(request.headers);
  headers.set("content-type", "application/json");
  return new Request(request, { headers, body: JSON.stringify(value) });
}

function contextWithRequest(context: MockHandlerContext, request: Request): MockHandlerContext {
  return { ...context, request };
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && !Array.isArray(value) && typeof value === "object"
    ? value as Record<string, unknown>
    : null;
}

async function partialVex(
  handler: MockHandler,
  context: MockHandlerContext,
  selection: FaultSelection,
): Promise<Response> {
  const body = object(await context.request.clone().json());
  if (body === null || !Array.isArray(body.findings)) return handler(context);
  const failedIds = new Set(selection.spec.findingIds ?? []);
  const successful = body.findings.filter((item) => {
    const finding = object(item);
    return typeof finding?.findingId === "string" && !failedIds.has(finding.findingId);
  });
  const response = await handler(contextWithRequest(
    context,
    requestWithJson(context.request, { ...body, findings: successful }),
  ));
  if (!response.ok) return response;
  const base = object(await response.json());
  const baseResults = Array.isArray(base?.results) ? base.results.map(object) : [];
  const byId = new Map(baseResults.flatMap((result) =>
    typeof result?.findingId === "string" ? [[result.findingId, result]] : [],
  ));
  const results = body.findings.map((item) => {
    const finding = object(item);
    const findingId = typeof finding?.findingId === "string" ? finding.findingId : "";
    return failedIds.has(findingId)
      ? { findingId, success: false, status: null, error: "scenario partial failure" }
      : byId.get(findingId);
  });
  const succeeded = results.filter((result) => result?.success === true).length;
  const failed = results.length - succeeded;
  return Response.json({
    status: failed === 0 ? "success" : succeeded === 0 ? "failure" : "partial_success",
    summary: { total: results.length, succeeded, failed },
    results,
  });
}

async function midPushReset(
  handler: MockHandler,
  context: MockHandlerContext,
  selection: FaultSelection,
): Promise<Response> {
  const body = object(await context.request.clone().json());
  if (body === null || !Array.isArray(body.findings)) return handler(context);
  const afterApplied = selection.spec.afterApplied ?? 1;
  const applied = body.findings.slice(0, afterApplied);
  const response = await handler(contextWithRequest(
    context,
    requestWithJson(context.request, { ...body, findings: applied }),
  ));
  if (!response.ok) return response;
  return jsonError(TRANSPORT_RESET_STATUS, "MOCK_TRANSPORT_RESET_AFTER_APPLY");
}

async function invoke(
  controller: FaultControllerRuntime,
  handler: MockHandler,
  context: MockHandlerContext,
): Promise<Response> {
  const selected = controller.select(context.service, context.route.routeId, context.request);
  if (selected === null) return handler(context);
  if (selected === "unknown") return jsonError(400, "MOCK_SCENARIO_NOT_INSTALLED");
  const { spec, attempt } = selected;

  if (spec.name === "rate-limit-then-success" || spec.name === "rate-limit-exhausted") {
    const times = spec.times ?? (spec.name === "rate-limit-then-success" ? 1 : Number.MAX_SAFE_INTEGER);
    if (attempt <= times) {
      controller.record(selected, "rate-limited");
      return jsonError(429, "MOCK_RATE_LIMITED", {
        "Retry-After": String(spec.retryAfterSeconds ?? 1),
      });
    }
    controller.record(selected, "succeeded-after-rate-limit");
    return handler(context);
  }
  if (spec.name === "as-stale-tara-state") {
    controller.record(selected, "stale-before-mutation");
    return frozenFaultResponse(context, "assurance-studio-stale-tara.json", 409);
  }
  if (spec.name === "platform-firmware-bytes-forbidden") {
    controller.record(selected, "bytes-forbidden");
    return frozenFaultResponse(context, "platform-firmware-forbidden.json", 403);
  }
  if (spec.name === "platform-vex-partial-failure") {
    const response = await partialVex(handler, context, selected);
    controller.record(selected, "partial-success");
    return response;
  }
  if (spec.name === "as-key-strip") {
    const body = object(await context.request.clone().json());
    if (body === null) return handler(context);
    const stripped = { ...body };
    for (const key of spec.unknownKeys ?? []) delete stripped[key];
    const response = await handler(contextWithRequest(context, requestWithJson(context.request, stripped)));
    controller.record(selected, "unknown-keys-stripped");
    return response;
  }
  if (spec.name === "mid-push-reset") {
    if (attempt > 1) {
      const response = await handler(context);
      controller.record(selected, "retry-converged");
      return response;
    }
    const response = await midPushReset(handler, context, selected);
    controller.record(selected, `transport-reset-after-${spec.afterApplied ?? 1}`);
    response.headers.set(MOCK_TRANSPORT_RESET_HEADER, "true");
    return response;
  }
  return handler(context);
}

export function withFaultMiddleware(
  service: "platform" | "assurance-studio",
  registry: MockHandlerRegistry,
  controller: FaultControllerRuntime,
): MockHandlerRegistry {
  registry.onReset(() => controller.clear(service));
  return {
    register(routeId, handler) {
      registry.register(routeId, (context) => invoke(controller, handler, context));
    },
    onReset(reset) {
      registry.onReset(reset);
    },
  };
}

export function transportResetFetch(fetch: typeof globalThis.fetch): typeof globalThis.fetch {
  return async (input, init) => {
    const response = await fetch(input, init);
    if (response.headers.get(MOCK_TRANSPORT_RESET_HEADER) === "true") {
      throw new TypeError("mock transport reset");
    }
    return response;
  };
}

export function forgeFault(
  controller: FaultControllerRuntime,
  input: {
    scenario?: string;
    requestId: string;
    routeId: typeof FORGE_CREATE_ROUTE | typeof FORGE_PREPARE_ROUTE;
  },
): { unavailable: true } | { rootDigestMismatch: true } | null {
  const request = new Request("http://forge.mock/fault", {
    headers: {
      "X-Request-ID": input.requestId,
      ...(input.scenario === undefined ? {} : { "X-FS-Mock-Scenario": input.scenario }),
    },
  });
  const selected = controller.select("forge-compute", input.routeId, request);
  if (selected === null || selected === "unknown") return null;
  if (selected.spec.name === "forge-compute-unavailable") {
    controller.record(selected, "compute-unavailable");
    return { unavailable: true };
  }
  if (selected.spec.name === "forge-root-digest-mismatch") {
    controller.record(selected, "root-digest-mismatch");
    return { rootDigestMismatch: true };
  }
  return null;
}

function jsonError(status: number, code: string, headers?: HeadersInit): Response {
  return Response.json({ error: { code } }, { status, headers });
}

export type { FaultService };
