import {
  routeParamNames,
  routeResponseFormat,
  routeSuccessStatus,
  validationMessageFromZodError,
  type RouteDefinition,
  type RouteOperationInput,
  type RouteOperationOutput,
} from "@bb/hono-typed-routes";
import {
  OperationError,
  type Operation,
  type OperationBody,
} from "@bb/operations";
import { z, type ZodType } from "zod";
import { publicApiRoutes } from "./public-api.js";

type RouteNames<Tree, Prefix extends string = ""> = {
  [Key in keyof Tree & string]: Tree[Key] extends RouteDefinition
    ? `${Prefix}${Key}`
    : RouteNames<Tree[Key], `${Prefix}${Key}.`>;
}[keyof Tree & string];

type RouteAt<
  Tree,
  Name extends string,
> = Name extends `${infer Head}.${infer Rest}`
  ? Head extends keyof Tree
    ? RouteAt<Tree[Head], Rest>
    : never
  : Name extends keyof Tree
    ? Tree[Name] extends RouteDefinition
      ? Tree[Name]
      : never
    : never;

export type PublicOperationName = RouteNames<typeof publicApiRoutes>;
export type PublicOperationRoute<Name extends PublicOperationName> = RouteAt<
  typeof publicApiRoutes,
  Name
>;
export type PublicOperationInput<Name extends PublicOperationName> =
  RouteOperationInput<PublicOperationRoute<Name>>;
export type RouteBodyOutput<Route extends RouteDefinition> =
  Route["response"] extends { format: "binary" | "text" }
    ? OperationBody
    : RouteOperationOutput<Route>;

export type PublicOperationOutput<Name extends PublicOperationName> =
  RouteBodyOutput<PublicOperationRoute<Name>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(message: string): OperationError {
  return new OperationError("invalid_input", message);
}

function parsePart(schema: ZodType, value: unknown): unknown {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw invalid(validationMessageFromZodError(result.error));
}

function withoutKeys(
  record: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (!keys.includes(key)) rest[key] = value;
  }
  return rest;
}

export interface RouteRequestParts {
  param: Record<string, string>;
  body?: unknown;
}

export function routeInputFromRequest(
  route: RouteDefinition,
  parts: RouteRequestParts,
): Record<string, unknown> {
  const { param, body } = parts;
  const request = route.request;
  if (request.source === "json") {
    if (request.field !== null) return { ...param, [request.field]: body };
    const names = Object.keys(param);
    if (!isRecord(body) || names.some((name) => name in body)) {
      parsePart(request.schema, body);
    }
    return isRecord(body) ? { ...body, ...param } : { ...param };
  }
  if (
    (request.source === "query" || request.source === "form") &&
    isRecord(body)
  ) {
    return { ...body, ...param };
  }
  return { ...param };
}

export interface RouteRequestInput {
  param?: Record<string, unknown>;
  json?: unknown;
  query?: Record<string, unknown>;
  form?: Record<string, unknown>;
}

export function routeRequestFromInput(
  route: RouteDefinition,
  input: unknown,
): RouteRequestInput {
  const record = isRecord(input) ? input : {};
  const names = routeParamNames(route.path);
  const param: Record<string, unknown> = {};
  for (const name of names) {
    if (name in record) param[name] = record[name];
  }
  const rest = withoutKeys(record, names);
  const request: RouteRequestInput = names.length === 0 ? {} : { param };
  if (route.request.source === "json") {
    request.json =
      route.request.field === null ? rest : rest[route.request.field];
  } else if (route.request.source === "query") {
    if (Object.keys(rest).length > 0) request.query = rest;
  } else if (route.request.source === "form") {
    request.form = rest;
  }
  return request;
}

function routeParser(route: RouteDefinition): (raw: unknown) => unknown {
  const names = routeParamNames(route.path);
  return (raw) => {
    const record = isRecord(raw) ? raw : {};
    const param: Record<string, string> = {};
    for (const name of names) {
      const value = record[name];
      if (typeof value !== "string" || value.length === 0) {
        throw invalid(`Missing path parameter ${name}`);
      }
      param[name] = value;
    }
    const request = route.request;
    const rest = withoutKeys(record, names);
    if (request.source === "json") {
      if (request.field !== null) {
        return {
          ...param,
          [request.field]: parsePart(request.schema, rest[request.field]),
        };
      }
      const parsed = parsePart(request.schema, rest);
      return isRecord(parsed) ? { ...parsed, ...param } : { ...param };
    }
    if (request.source === "query") {
      const parsed = parsePart(request.schema, rest);
      return isRecord(parsed) ? { ...parsed, ...param } : { ...param };
    }
    if (request.source === "form") return { ...rest, ...param };
    return param;
  };
}

export function routeReturnsBody(route: RouteDefinition): boolean {
  return routeResponseFormat(route) !== "json";
}

export interface PublicRouteEntry {
  key: string;
  route: RouteDefinition;
}

function collectRoutes(
  tree: object,
  prefix: string,
  into: PublicRouteEntry[],
): void {
  for (const [segment, value] of Object.entries(tree)) {
    if (typeof value !== "object" || value === null) continue;
    const key = `${prefix}${segment}`;
    if ("path" in value && "method" in value && "request" in value) {
      into.push({ key, route: value as RouteDefinition });
      continue;
    }
    collectRoutes(value, `${key}.`, into);
  }
}

export function listRouteEntries(tree: object): PublicRouteEntry[] {
  const entries: PublicRouteEntry[] = [];
  collectRoutes(tree, "", entries);
  return entries;
}

export function listPublicApiRoutes(): PublicRouteEntry[] {
  return listRouteEntries(publicApiRoutes);
}

function collectFieldNames(
  schema: z.core.$ZodType,
  into: Set<string>,
  seen: Set<z.core.$ZodType>,
): void {
  if (seen.has(schema)) return;
  seen.add(schema);
  if (schema instanceof z.ZodObject) {
    for (const key of Object.keys(schema.shape)) into.add(key);
    return;
  }
  if (schema instanceof z.ZodUnion) {
    for (const option of schema.options) collectFieldNames(option, into, seen);
    return;
  }
  if (schema instanceof z.ZodIntersection) {
    collectFieldNames(schema.def.left, into, seen);
    collectFieldNames(schema.def.right, into, seen);
    return;
  }
  if (schema instanceof z.ZodPipe) {
    collectFieldNames(schema.def.in, into, seen);
    return;
  }
  if (
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodNullable ||
    schema instanceof z.ZodDefault ||
    schema instanceof z.ZodPrefault ||
    schema instanceof z.ZodReadonly ||
    schema instanceof z.ZodCatch ||
    schema instanceof z.ZodNonOptional
  ) {
    collectFieldNames(schema.def.innerType, into, seen);
    return;
  }
  if (schema instanceof z.ZodLazy) {
    collectFieldNames(schema.def.getter(), into, seen);
  }
}

export function routeInputFields(route: RouteDefinition): ReadonlySet<string> {
  const fields = new Set<string>(routeParamNames(route.path));
  const request = route.request;
  if (request.source === "json" && request.field !== null) {
    fields.add(request.field);
  } else if (request.source === "json" || request.source === "query") {
    collectFieldNames(request.schema, fields, new Set());
  }
  return fields;
}

export function routeFieldClash(
  name: string,
  route: RouteDefinition,
): string | null {
  const request = route.request;
  if (request.source !== "json" && request.source !== "query") return null;
  const fields = new Set<string>();
  if (request.source === "json" && request.field !== null) {
    fields.add(request.field);
  } else {
    collectFieldNames(request.schema, fields, new Set());
  }
  const clash = routeParamNames(route.path).find((param) => fields.has(param));
  if (clash === undefined) return null;
  const where = request.source === "json" ? "body" : "query";
  return `Operation ${name}: path parameter "${clash}" and ${where} field "${clash}" share a name, so its flat input would be ambiguous`;
}

function buildOperation(name: string, route: RouteDefinition): Operation {
  return Object.freeze({
    name,
    http: {
      method: route.method,
      path: route.path,
      status: routeSuccessStatus(route),
      headers: route.headers ?? {},
    },
    parse: routeParser(route),
  });
}

export interface PublicOperationSet {
  operations: ReadonlyMap<string, Operation>;
  routes: ReadonlyMap<string, RouteDefinition>;
  byRoute: WeakMap<RouteDefinition, Operation>;
}

export function createPublicOperations(tree: object): PublicOperationSet {
  const operations = new Map<string, Operation>();
  const routes = new Map<string, RouteDefinition>();
  const byRoute = new WeakMap<RouteDefinition, Operation>();
  for (const { key, route } of listRouteEntries(tree)) {
    const clash = routeFieldClash(key, route);
    if (clash !== null) throw new Error(clash);
    const operation = buildOperation(key, route);
    operations.set(key, operation);
    routes.set(key, route);
    byRoute.set(route, operation);
  }
  return { operations, routes, byRoute };
}

let built: PublicOperationSet | null = null;

function publicOperationSet(): PublicOperationSet {
  built ??= createPublicOperations(publicApiRoutes);
  return built;
}

export function publicOperations(): ReadonlyMap<string, Operation> {
  return publicOperationSet().operations;
}

export function publicOperation<Name extends PublicOperationName>(
  name: Name,
): Operation<PublicOperationInput<Name>> {
  const operation = publicOperations().get(name);
  if (operation === undefined) throw new Error(`Unknown operation ${name}`);
  return operation as Operation<PublicOperationInput<Name>>;
}

export function publicOperationRouteDefinition(
  name: string,
): RouteDefinition | null {
  return publicOperationSet().routes.get(name) ?? null;
}

export function publicOperationForRoute(route: RouteDefinition): Operation {
  const operation = publicOperationSet().byRoute.get(route);
  if (operation === undefined) {
    throw new Error(`No operation for ${route.method} ${route.path}`);
  }
  return operation;
}
