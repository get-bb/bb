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
  defineOperation,
  isOperationBody,
  operationBodyProblem,
  type Operation,
  type OperationBody,
} from "@bb/operations";
import { z, type ZodType } from "zod";
import { publicApiRoutes } from "./public-api.js";
import { publicOperationKinds } from "./operation-kinds.js";
import { publicOperationNames } from "./operation-names.js";
import { publicOperationOutputSchemas } from "./output-schemas/index.js";

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

export type RouteKeys<Tree> = RouteNames<Tree>;
export type OperationNameTable<Tree> = {
  readonly [Key in RouteKeys<Tree>]: string;
};
export type PublicRouteKey = RouteKeys<typeof publicApiRoutes>;
export type PublicOperationName = (typeof publicOperationNames)[PublicRouteKey];
type RouteKeyFor<Name extends PublicOperationName> = {
  [Key in PublicRouteKey]: (typeof publicOperationNames)[Key] extends Name
    ? Key
    : never;
}[PublicRouteKey];
export type PublicOperationRoute<Name extends PublicOperationName> = RouteAt<
  typeof publicApiRoutes,
  RouteKeyFor<Name>
>;
export type PublicOperationInput<Name extends PublicOperationName> =
  RouteOperationInput<PublicOperationRoute<Name>>;
export type RouteBodyOutput<Route extends RouteDefinition> =
  Route["response"] extends { format: "binary" | "text" }
    ? OperationBody
    : RouteOperationOutput<Route>;

export type PublicOperationOutput<Name extends PublicOperationName> =
  RouteBodyOutput<PublicOperationRoute<Name>>;

type GroupOperationName<Group extends string> = Extract<
  PublicOperationName,
  `${Group}.${string}`
>;

export type PublicOperationOutputSchema<Name extends PublicOperationName> =
  PublicOperationRoute<Name>["response"] extends {
    format: "binary" | "text";
  }
    ? null
    : ZodType<PublicOperationOutput<Name>>;

export type GroupOutputSchemas<Group extends string> = {
  readonly [Name in GroupOperationName<Group>]: PublicOperationOutputSchema<Name>;
};

const NO_STORE = { "cache-control": "no-store" } as const;

const RESPONSE_HEADERS: {
  readonly [Name in PublicOperationName]?: Readonly<Record<string, string>>;
} = {
  "desktopBrowsers.brokerProof": NO_STORE,
  "desktopBrowsers.openConnection": NO_STORE,
  "desktopBrowsers.captureTab": NO_STORE,
  "desktopBrowsers.importCookies": NO_STORE,
  "system.mobileAppReleases": NO_STORE,
};

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

function outputChecker(
  route: RouteDefinition,
  schema: ZodType | null,
): ((output: unknown) => string | null) | undefined {
  if (routeReturnsBody(route)) return operationBodyProblem;
  if (schema === null) return undefined;
  return (output) => {
    if (isOperationBody(output)) return null;
    const result = schema.safeParse(output);
    if (result.success) return null;
    const [issue] = result.error.issues;
    if (issue === undefined) return "invalid result";
    const path = issue.path.join(".");
    return path === "" ? issue.message : `${path}: ${issue.message}`;
  };
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

function lookup<Value>(
  table: Readonly<Record<string, Value>>,
  name: string,
  what: string,
): Value {
  if (!Object.hasOwn(table, name)) {
    throw new Error(`Operation ${name} has no ${what}`);
  }
  return table[name] as Value;
}

function buildOperation(name: string, route: RouteDefinition): Operation {
  const kind = lookup(publicOperationKinds, name, "kind");
  const checkOutput = outputChecker(
    route,
    lookup<ZodType | null>(publicOperationOutputSchemas, name, "output schema"),
  );
  const internal = route.request.source === "form" || routeReturnsBody(route);
  return defineOperation({
    name,
    kind,
    hooks: kind === "read" ? "rewrite" : "answer",
    internal,
    doors: {
      http: {
        method: route.method,
        path: route.path,
        status: routeSuccessStatus(route),
        ...(Object.hasOwn(RESPONSE_HEADERS, name)
          ? {
              headers: (
                RESPONSE_HEADERS as Readonly<
                  Record<string, Readonly<Record<string, string>>>
                >
              )[name],
            }
          : {}),
      },
    },
    parse: routeParser(route),
    ...(checkOutput === undefined ? {} : { checkOutput }),
  });
}

export interface PublicOperationSet {
  operations: ReadonlyMap<string, Operation>;
  routes: ReadonlyMap<string, RouteDefinition>;
  byRoute: WeakMap<RouteDefinition, Operation>;
}

export function createPublicOperations(
  tree: object,
  names: Readonly<Record<string, string>>,
): PublicOperationSet {
  const operations = new Map<string, Operation>();
  const routes = new Map<string, RouteDefinition>();
  const byRoute = new WeakMap<RouteDefinition, Operation>();
  const keys = new Set<string>();
  for (const { key, route } of listRouteEntries(tree)) {
    keys.add(key);
    if (!Object.hasOwn(names, key)) {
      throw new Error(`Route ${key} has no entry in the operation name table`);
    }
    const name = names[key] as string;
    if (operations.has(name)) {
      throw new Error(`Operation ${name} is named by more than one route`);
    }
    const clash = routeFieldClash(name, route);
    if (clash !== null) throw new Error(clash);
    const operation = buildOperation(name, route);
    operations.set(name, operation);
    routes.set(name, route);
    byRoute.set(route, operation);
  }
  for (const key of Object.keys(names)) {
    if (!keys.has(key)) {
      throw new Error(`The operation name table names a missing route ${key}`);
    }
  }
  return { operations, routes, byRoute };
}

let built: PublicOperationSet | null = null;

function publicOperationSet(): PublicOperationSet {
  built ??= createPublicOperations(publicApiRoutes, publicOperationNames);
  return built;
}

export function publicOperations(): ReadonlyMap<string, Operation> {
  return publicOperationSet().operations;
}

export function publicOperation<Name extends PublicOperationName>(
  name: Name,
): Operation<PublicOperationInput<Name>, PublicOperationOutput<Name>> {
  const operation = publicOperations().get(name);
  if (operation === undefined) throw new Error(`Unknown operation ${name}`);
  return operation as Operation<
    PublicOperationInput<Name>,
    PublicOperationOutput<Name>
  >;
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
