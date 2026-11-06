import {
  routeParamNames,
  routeResponseFormat,
  type RouteDefinition,
  type RouteMethod,
} from "@bb/hono-typed-routes";

export type RouteBodySource = "none" | "query" | "json" | "form";

export interface RouteCallShape {
  readonly method: RouteMethod;
  readonly path: string;
  readonly source: RouteBodySource;
  readonly field: string | null;
  readonly format: "json" | "text" | "binary";
}

export function routeCallShape(route: RouteDefinition): RouteCallShape {
  const request = route.request;
  return {
    method: route.method,
    path: route.path,
    source: request.source,
    field: request.source === "json" ? request.field : null,
    format: routeResponseFormat(route),
  };
}

export interface RouteRequestInput {
  param?: Record<string, unknown>;
  json?: unknown;
  query?: Record<string, unknown>;
  form?: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function routeRequestFromInput(
  shape: Pick<RouteCallShape, "path" | "source" | "field">,
  input: unknown,
): RouteRequestInput {
  const record = isRecord(input) ? input : {};
  const names = routeParamNames(shape.path);
  const param: Record<string, unknown> = {};
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (names.includes(key)) param[key] = value;
    else rest[key] = value;
  }
  const request: RouteRequestInput = names.length === 0 ? {} : { param };
  if (shape.source === "json") {
    request.json = shape.field === null ? rest : rest[shape.field];
  } else if (shape.source === "query") {
    if (Object.keys(rest).length > 0) request.query = rest;
  } else if (shape.source === "form") {
    request.form = rest;
  }
  return request;
}
