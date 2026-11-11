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

const ROUTE_METHODS: readonly RouteMethod[] = [
  "get",
  "post",
  "patch",
  "delete",
  "put",
];
const BODY_SOURCES: readonly RouteBodySource[] = [
  "none",
  "query",
  "json",
  "form",
];
const RESPONSE_FORMATS: readonly RouteCallShape["format"][] = [
  "json",
  "text",
  "binary",
];

function defaultBodySource(method: RouteMethod): RouteBodySource {
  return method === "get" || method === "delete" ? "none" : "json";
}

function oneOf<Value extends string>(
  values: readonly Value[],
  value: string,
): value is Value {
  return values.some((candidate) => candidate === value);
}

export function encodeRouteCall(shape: RouteCallShape): string {
  return [
    shape.method,
    shape.path,
    shape.source === defaultBodySource(shape.method) ? "" : shape.source,
    shape.field ?? "",
    shape.format === "json" ? "" : shape.format,
  ]
    .join(" ")
    .trimEnd();
}

export function decodeRouteCall(encoded: string): RouteCallShape {
  const [method = "", path = "", source = "", field = "", format = ""] =
    encoded.split(" ");
  if (!oneOf(ROUTE_METHODS, method) || !path.startsWith("/")) {
    throw new Error(`Malformed route index entry: ${encoded}`);
  }
  const bodySource = source === "" ? defaultBodySource(method) : source;
  const responseFormat = format === "" ? "json" : format;
  if (
    !oneOf(BODY_SOURCES, bodySource) ||
    !oneOf(RESPONSE_FORMATS, responseFormat)
  ) {
    throw new Error(`Malformed route index entry: ${encoded}`);
  }
  return {
    method,
    path,
    source: bodySource,
    field: field === "" ? null : field,
    format: responseFormat,
  };
}

type RouteArea<Name> = Name extends `${infer Area}.${string}` ? Area : never;
type RouteMember<Name, Area extends string> = Name extends `${Area}.${infer Member}`
  ? Member
  : never;

export type RouteIndex<Name extends string> = {
  readonly [Area in RouteArea<Name>]: {
    readonly [Member in RouteMember<Name, Area>]: string;
  };
};

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
