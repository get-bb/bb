import {
  getEnvironment,
  getProject,
  getThread,
  type DbConnection,
} from "@bb/db";
import type { PolicyAction, PolicyDecision, PolicyResource } from "@bb/domain";
import {
  canonicalizeInternalRequestTarget,
  publicApiRoutes,
} from "@bb/server-contract";
import type { MiddlewareHandler, Next } from "hono";
import type { Context } from "hono";
import { ApiError } from "../errors.js";
import { authorize } from "../request-context.js";

/** Namespaced action prefix for registry-issued public HTTP operations. */
export const PUBLIC_HTTP_ACTION_PREFIX = "publicHttp." as const;

/** Fixed action for method/path pairs that are not in the closed inventory. */
export const PUBLIC_HTTP_UNMAPPED_ACTION_NAME =
  `${PUBLIC_HTTP_ACTION_PREFIX}unmapped` as const;

const API_V1_PREFIX = "/api/v1";

export type PublicHttpInventorySource = "typed" | "untyped";

export type PublicHttpInventoryEntry = {
  readonly operationName: string;
  readonly method: string;
  readonly pattern: string;
  readonly source: PublicHttpInventorySource;
  readonly group: string;
};

type PathSegment =
  | { readonly type: "static"; readonly value: string }
  | { readonly type: "param"; readonly name: string }
  | { readonly type: "greedy"; readonly name: string | null };

type CompiledInventoryEntry = PublicHttpInventoryEntry & {
  readonly segments: readonly PathSegment[];
  readonly resourceKind: string;
  readonly idParam: string | null;
  readonly specificity: readonly [number, number, number];
};

export type ResolvedPublicHttpOperation =
  | {
      readonly kind: "mapped";
      readonly operationName: string;
      readonly action: PolicyAction;
      readonly resource: PolicyResource;
      readonly entry: PublicHttpInventoryEntry;
    }
  | {
      readonly kind: "unmapped";
      readonly action: PolicyAction;
      readonly resource: PolicyResource;
    };

/**
 * Manual closed inventory for untyped `/api/v1` routes registered outside
 * `publicApiRoutes` (plugins, plugin-catalog, skills-registry).
 */
export const UNTYPED_PUBLIC_HTTP_INVENTORY = Object.freeze([
  {
    operationName: "plugins.list",
    method: "GET",
    pattern: "/plugins",
    source: "untyped",
    group: "plugins",
  },
  {
    operationName: "plugins.contributions",
    method: "GET",
    pattern: "/plugins/contributions",
    source: "untyped",
    group: "plugins",
  },
  {
    operationName: "plugins.mentionsSearch",
    method: "GET",
    pattern: "/plugins/mentions/search",
    source: "untyped",
    group: "plugins",
  },
  {
    operationName: "plugins.cli",
    method: "POST",
    pattern: "/plugins/:id/cli",
    source: "untyped",
    group: "plugins",
  },
  {
    operationName: "plugins.assets",
    method: "GET",
    pattern: "/plugins/:id/assets/:file",
    source: "untyped",
    group: "plugins",
  },
  {
    operationName: "plugins.logs",
    method: "GET",
    pattern: "/plugins/:id/logs",
    source: "untyped",
    group: "plugins",
  },
  {
    operationName: "plugins.updatesCheck",
    method: "POST",
    pattern: "/plugins/updates/check",
    source: "untyped",
    group: "plugins",
  },
  {
    operationName: "plugins.updates",
    method: "GET",
    pattern: "/plugins/updates",
    source: "untyped",
    group: "plugins",
  },
  {
    operationName: "plugins.update",
    method: "POST",
    pattern: "/plugins/:id/update",
    source: "untyped",
    group: "plugins",
  },
  {
    operationName: "plugins.install",
    method: "POST",
    pattern: "/plugins/install",
    source: "untyped",
    group: "plugins",
  },
  {
    operationName: "plugins.source",
    method: "GET",
    pattern: "/plugins/:id/source",
    source: "untyped",
    group: "plugins",
  },
  {
    operationName: "plugins.reload",
    method: "POST",
    pattern: "/plugins/reload",
    source: "untyped",
    group: "plugins",
  },
  {
    operationName: "plugins.enable",
    method: "POST",
    pattern: "/plugins/:id/enable",
    source: "untyped",
    group: "plugins",
  },
  {
    operationName: "plugins.disable",
    method: "POST",
    pattern: "/plugins/:id/disable",
    source: "untyped",
    group: "plugins",
  },
  {
    operationName: "plugins.settingsGet",
    method: "GET",
    pattern: "/plugins/:id/settings",
    source: "untyped",
    group: "plugins",
  },
  {
    operationName: "plugins.settingsPut",
    method: "PUT",
    pattern: "/plugins/:id/settings",
    source: "untyped",
    group: "plugins",
  },
  {
    operationName: "plugins.delete",
    method: "DELETE",
    pattern: "/plugins/:id",
    source: "untyped",
    group: "plugins",
  },
  {
    operationName: "plugins.token",
    method: "POST",
    pattern: "/plugins/:id/token",
    source: "untyped",
    group: "plugins",
  },
  {
    operationName: "plugins.http",
    method: "ALL",
    pattern: "/plugins/:id/http/*",
    source: "untyped",
    group: "plugins",
  },
  {
    operationName: "plugins.rpc",
    method: "POST",
    pattern: "/plugins/:id/rpc/:method",
    source: "untyped",
    group: "plugins",
  },
  {
    operationName: "pluginCatalog.list",
    method: "GET",
    pattern: "/plugin-catalog",
    source: "untyped",
    group: "pluginCatalog",
  },
  {
    operationName: "pluginCatalog.search",
    method: "GET",
    pattern: "/plugin-catalog/search",
    source: "untyped",
    group: "pluginCatalog",
  },
  {
    operationName: "pluginCatalog.install",
    method: "POST",
    pattern: "/plugin-catalog/install",
    source: "untyped",
    group: "pluginCatalog",
  },
  {
    operationName: "skillsRegistry.list",
    method: "GET",
    pattern: "/skills-registry",
    source: "untyped",
    group: "skillsRegistry",
  },
  {
    operationName: "skillsRegistry.entry",
    method: "GET",
    pattern: "/skills-registry/entry",
    source: "untyped",
    group: "skillsRegistry",
  },
  {
    operationName: "skillsRegistry.repositoryStars",
    method: "GET",
    pattern: "/skills-registry/repository-stars",
    source: "untyped",
    group: "skillsRegistry",
  },
  {
    operationName: "skillsRegistry.detail",
    method: "GET",
    pattern: "/skills-registry/detail",
    source: "untyped",
    group: "skillsRegistry",
  },
  {
    operationName: "skillsRegistry.install",
    method: "POST",
    pattern: "/skills-registry/install",
    source: "untyped",
    group: "skillsRegistry",
  },
] as const satisfies readonly PublicHttpInventoryEntry[]);

/**
 * Conservative workspace-member allowlist (typed operations only). All untyped
 * plugin/catalog/skills operations stay outside both signed role allowlists.
 */
export const PUBLIC_HTTP_MEMBER_OPERATION_NAMES = Object.freeze([
  "projects.get",
  "projects.defaultExecutionOptions",
  "projects.promptHistory",
  "projects.files",
  "projects.fileContent",
  "projects.paths",
  "projects.commands",
  "projects.skills",
  "projects.skillContent",
  "projects.skillFiles",
  "projects.branches",
  "projects.uploadAttachment",
  "projects.attachmentContent",
  "filePreviews.content",
  "environments.get",
  "environments.status",
  "environments.pullRequest",
  "environments.diff",
  "environments.diffFiles",
  "environments.diffPatch",
  "environments.diffFile",
  "environments.diffBranches",
  "environments.paths",
  "threads.get",
  "threads.childSummary",
  "threads.send",
  "threads.composerBootstrap",
  "threads.queuedMessages",
  "threads.createQueuedMessage",
  "threads.updateQueuedMessage",
  "threads.sendQueuedMessage",
  "threads.reorderQueuedMessage",
  "threads.setQueuedMessageGroupBoundary",
  "threads.promptHistory",
  "threads.deleteQueuedMessage",
  "threads.tabs",
  "threads.updateTabs",
  "threads.interactions",
  "threads.interaction",
  "threads.respondToInteraction",
  "threads.read",
  "threads.unread",
  "threads.timeline",
  "threads.conversationOutline",
  "threads.timelineTurnSummaryDetails",
  "threads.output",
  "threads.events",
  "threads.eventWait",
  "threads.defaultExecutionOptions",
  "threads.storageFiles",
  "threads.storageFile",
  "threads.storagePaths",
  "threads.storageContent",
  "threads.worktreeFile",
  "system.executionOptions",
  "system.providers",
  "system.providerLogo",
  "system.voiceTranscription",
  "system.version",
]);

const PUBLIC_HTTP_MEMBER_ALLOWLIST = new Set<string>(
  PUBLIC_HTTP_MEMBER_OPERATION_NAMES,
);

/**
 * Work Together owners receive only the extra Room capabilities that require
 * owner authority. Stock local-owner mode remains independently allow-all.
 */
export const PUBLIC_HTTP_WORK_TOGETHER_OWNER_OPERATION_NAMES = Object.freeze([
  ...PUBLIC_HTTP_MEMBER_OPERATION_NAMES,
  "threads.stop",
  "threads.resolveInteraction",
]);

const PUBLIC_HTTP_WORK_TOGETHER_OWNER_ALLOWLIST = new Set<string>(
  PUBLIC_HTTP_WORK_TOGETHER_OWNER_OPERATION_NAMES,
);

const UNMAPPED_ACTION: PolicyAction = Object.freeze({
  name: PUBLIC_HTTP_UNMAPPED_ACTION_NAME,
});
const UNMAPPED_RESOURCE: PolicyResource = Object.freeze({
  kind: "route",
  id: null,
});

function isRouteDefinition(
  value: unknown,
): value is { path: string; method: string } {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as { path?: unknown }).path === "string" &&
    typeof (value as { method?: unknown }).method === "string" &&
    "request" in value &&
    "response" in value
  );
}

function flattenTypedPublicApiRoutes(): PublicHttpInventoryEntry[] {
  const entries: PublicHttpInventoryEntry[] = [];
  for (const [group, groupRoutes] of Object.entries(publicApiRoutes)) {
    if (groupRoutes === null || typeof groupRoutes !== "object") {
      continue;
    }
    for (const [operation, descriptor] of Object.entries(groupRoutes)) {
      if (!isRouteDefinition(descriptor)) {
        continue;
      }
      entries.push(
        Object.freeze({
          operationName: `${group}.${operation}`,
          method: descriptor.method.toUpperCase(),
          pattern: descriptor.path,
          source: "typed",
          group,
        }),
      );
    }
  }
  return entries;
}

function resourceKindForGroup(group: string): string {
  switch (group) {
    case "projects":
      return "project";
    case "files":
      return "file";
    case "filePreviews":
      return "filePreview";
    case "hosts":
      return "host";
    case "terminals":
      return "terminal";
    case "environments":
      return "environment";
    case "threadSections":
      return "threadSection";
    case "threads":
      return "thread";
    case "system":
      return "systemSettings";
    case "plugins":
    case "pluginCatalog":
    case "skillsRegistry":
      return "plugin";
    default:
      return "route";
  }
}

function idParamForEntry(
  group: string,
  pattern: string,
  segments: readonly PathSegment[],
): string | null {
  if (group === "threadSections" || group === "files") {
    return null;
  }
  if (group === "terminals") {
    return segments.some(
      (segment) => segment.type === "param" && segment.name === "terminalId",
    )
      ? "terminalId"
      : null;
  }
  if (group === "system") {
    return pattern.includes("/providers/:id/") ? "id" : null;
  }
  if (
    group === "projects" ||
    group === "hosts" ||
    group === "environments" ||
    group === "threads" ||
    group === "filePreviews" ||
    group === "plugins"
  ) {
    return segments.some(
      (segment) => segment.type === "param" && segment.name === "id",
    )
      ? "id"
      : null;
  }
  return null;
}

function parsePatternSegments(pattern: string): PathSegment[] | null {
  if (typeof pattern !== "string" || !pattern.startsWith("/")) {
    return null;
  }
  if (
    pattern.includes("//") ||
    pattern.includes("?") ||
    pattern.includes("#")
  ) {
    return null;
  }
  const rawParts = pattern.split("/");
  if (rawParts[0] !== "") {
    return null;
  }
  const segments: PathSegment[] = [];
  for (let index = 1; index < rawParts.length; index += 1) {
    const part = rawParts[index]!;
    if (part.length === 0) {
      return null;
    }
    if (part === "*") {
      if (index !== rawParts.length - 1) {
        return null;
      }
      segments.push({ type: "greedy", name: null });
      continue;
    }
    const greedy = /^:([A-Za-z_][A-Za-z0-9_]*)\{\.\+\}$/u.exec(part);
    if (greedy) {
      if (index !== rawParts.length - 1) {
        return null;
      }
      segments.push({ type: "greedy", name: greedy[1]! });
      continue;
    }
    const param = /^:([A-Za-z_][A-Za-z0-9_]*)$/u.exec(part);
    if (param) {
      segments.push({ type: "param", name: param[1]! });
      continue;
    }
    if (part.includes(":") || part.includes("*") || part.includes("{")) {
      return null;
    }
    segments.push({ type: "static", value: part });
  }
  return segments;
}

function specificityOf(
  segments: readonly PathSegment[],
): readonly [number, number, number] {
  let staticCount = 0;
  let paramCount = 0;
  let greedyCount = 0;
  for (const segment of segments) {
    if (segment.type === "static") {
      staticCount += 1;
    } else if (segment.type === "param") {
      paramCount += 1;
    } else {
      greedyCount += 1;
    }
  }
  return [staticCount, paramCount, -greedyCount];
}

function compareSpecificity(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
): number {
  for (let index = 0; index < 3; index += 1) {
    const delta = left[index]! - right[index]!;
    if (delta !== 0) {
      return delta;
    }
  }
  return 0;
}

function compileEntry(entry: PublicHttpInventoryEntry): CompiledInventoryEntry {
  const relativeSegments = parsePatternSegments(entry.pattern);
  if (relativeSegments === null) {
    throw new Error("Invalid public HTTP inventory pattern");
  }
  const segments: PathSegment[] = [
    { type: "static", value: "api" },
    { type: "static", value: "v1" },
    ...relativeSegments,
  ];
  return Object.freeze({
    ...entry,
    segments,
    resourceKind: resourceKindForGroup(entry.group),
    idParam: idParamForEntry(entry.group, entry.pattern, relativeSegments),
    specificity: specificityOf(segments),
  });
}

function buildInventory(): {
  readonly entries: readonly PublicHttpInventoryEntry[];
  readonly compiled: readonly CompiledInventoryEntry[];
  readonly byOperationName: ReadonlyMap<string, CompiledInventoryEntry>;
} {
  const typed = flattenTypedPublicApiRoutes();
  const untyped = UNTYPED_PUBLIC_HTTP_INVENTORY.map((entry) =>
    Object.freeze({ ...entry }),
  );
  const entries = Object.freeze([...typed, ...untyped]);
  const operationNames = new Set<string>();
  const methodPatterns = new Set<string>();
  for (const entry of entries) {
    if (operationNames.has(entry.operationName)) {
      throw new Error("Duplicate public HTTP operation name");
    }
    operationNames.add(entry.operationName);
    const key = `${entry.method} ${entry.pattern}`;
    if (methodPatterns.has(key)) {
      throw new Error("Duplicate public HTTP method/pattern pair");
    }
    methodPatterns.add(key);
  }
  const compiled = Object.freeze(entries.map(compileEntry));
  const byOperationName = new Map<string, CompiledInventoryEntry>();
  for (const entry of compiled) {
    byOperationName.set(entry.operationName, entry);
  }
  return {
    entries,
    compiled,
    byOperationName,
  };
}

const INVENTORY = buildInventory();

/** Closed public HTTP operation inventory (typed + untyped). */
export const PUBLIC_HTTP_INVENTORY: readonly PublicHttpInventoryEntry[] =
  INVENTORY.entries;

function unauthorizedPrincipalResponse(): Response {
  return new Response(
    JSON.stringify({ code: "unauthorized", message: "Unauthorized" }),
    {
      status: 401,
      headers: { "content-type": "application/json" },
    },
  );
}

function unmappedResult(): ResolvedPublicHttpOperation {
  return {
    kind: "unmapped",
    action: UNMAPPED_ACTION,
    resource: UNMAPPED_RESOURCE,
  };
}

function scopePublicHttpOperationToStandardProject(
  db: DbConnection,
  resolved: ResolvedPublicHttpOperation,
): ResolvedPublicHttpOperation {
  if (resolved.kind !== "mapped" || resolved.resource.id === null) {
    return resolved;
  }

  let projectId: string | null = null;
  if (resolved.resource.kind === "thread") {
    const thread = getThread(db, resolved.resource.id);
    if (thread === null) {
      return resolved;
    }
    projectId = thread.projectId;
  } else if (resolved.resource.kind === "environment") {
    const environment = getEnvironment(db, resolved.resource.id);
    if (environment === null) {
      return resolved;
    }
    projectId = environment.projectId;
  } else if (resolved.resource.kind === "project") {
    const project = getProject(db, resolved.resource.id);
    if (project === null) {
      return resolved;
    }
    return project.kind === "standard" ? resolved : unmappedResult();
  } else {
    return resolved;
  }

  const project = getProject(db, projectId);
  if (project === null || project.kind !== "standard") {
    return unmappedResult();
  }
  return resolved;
}

function isSafeHttpMethod(method: string): boolean {
  return /^[A-Z][A-Z0-9-]{0,15}$/u.test(method);
}

/**
 * Validate pathname shape for auth matching without echoing the input.
 * Does not decode or canonicalize differently from the request target.
 */
function isSafePathname(pathname: string): boolean {
  if (typeof pathname !== "string" || pathname.length < 1) {
    return false;
  }
  if (pathname.charCodeAt(0) !== 0x2f) {
    return false;
  }
  if (pathname.charCodeAt(1) === 0x2f) {
    return false;
  }
  if (
    pathname.includes("?") ||
    pathname.includes("#") ||
    pathname.includes("\\") ||
    pathname.includes("//")
  ) {
    return false;
  }
  try {
    return canonicalizeInternalRequestTarget(pathname) === pathname;
  } catch {
    return false;
  }
}

function matchSegments(
  segments: readonly PathSegment[],
  pathSegments: readonly string[],
): Record<string, string> | null {
  const params: Record<string, string> = {};
  let pathIndex = 0;
  for (
    let segmentIndex = 0;
    segmentIndex < segments.length;
    segmentIndex += 1
  ) {
    const segment = segments[segmentIndex]!;
    if (segment.type === "static") {
      if (
        pathIndex >= pathSegments.length ||
        pathSegments[pathIndex] !== segment.value
      ) {
        return null;
      }
      pathIndex += 1;
      continue;
    }
    if (segment.type === "param") {
      const value = pathSegments[pathIndex];
      if (value === undefined || value.length === 0) {
        return null;
      }
      params[segment.name] = value;
      pathIndex += 1;
      continue;
    }
    if (segmentIndex !== segments.length - 1) {
      return null;
    }
    if (pathIndex >= pathSegments.length) {
      return null;
    }
    const rest = pathSegments.slice(pathIndex).join("/");
    if (rest.length === 0) {
      return null;
    }
    if (segment.name !== null) {
      params[segment.name] = rest;
    }
    return params;
  }
  if (pathIndex !== pathSegments.length) {
    return null;
  }
  return params;
}

function buildResource(
  entry: CompiledInventoryEntry,
  params: Record<string, string>,
): PolicyResource | null {
  if (entry.idParam === null) {
    return Object.freeze({ kind: entry.resourceKind, id: null });
  }
  const id = params[entry.idParam];
  if (typeof id !== "string" || id.length === 0) {
    return null;
  }
  return Object.freeze({ kind: entry.resourceKind, id });
}

function actionForOperation(operationName: string): PolicyAction {
  return Object.freeze({
    name: `${PUBLIC_HTTP_ACTION_PREFIX}${operationName}`,
  });
}

/**
 * Resolve an uppercase HTTP method + pathname to exactly one inventory
 * operation and a server-extracted PolicyResource, or unmapped.
 */
export function resolvePublicHttpOperation(
  method: string,
  pathname: string,
): ResolvedPublicHttpOperation {
  if (typeof method !== "string" || typeof pathname !== "string") {
    return unmappedResult();
  }
  if (!isSafeHttpMethod(method) || !isSafePathname(pathname)) {
    return unmappedResult();
  }
  if (!pathname.startsWith(`${API_V1_PREFIX}/`) && pathname !== API_V1_PREFIX) {
    return unmappedResult();
  }

  const pathSegments = pathname.split("/").slice(1);
  if (pathSegments.some((segment) => segment.length === 0)) {
    return unmappedResult();
  }

  const matches: Array<{
    entry: CompiledInventoryEntry;
    params: Record<string, string>;
  }> = [];
  for (const entry of INVENTORY.compiled) {
    if (entry.method !== "ALL" && entry.method !== method) {
      continue;
    }
    const params = matchSegments(entry.segments, pathSegments);
    if (params === null) {
      continue;
    }
    matches.push({ entry, params });
  }

  if (matches.length === 0) {
    return unmappedResult();
  }

  let best = matches[0]!;
  let ambiguous = false;
  for (let index = 1; index < matches.length; index += 1) {
    const candidate = matches[index]!;
    const comparison = compareSpecificity(
      candidate.entry.specificity,
      best.entry.specificity,
    );
    if (comparison > 0) {
      best = candidate;
      ambiguous = false;
    } else if (comparison === 0) {
      ambiguous = true;
    }
  }
  if (ambiguous) {
    return unmappedResult();
  }

  const resource = buildResource(best.entry, best.params);
  if (resource === null) {
    return unmappedResult();
  }

  return {
    kind: "mapped",
    operationName: best.entry.operationName,
    action: actionForOperation(best.entry.operationName),
    resource,
    entry: best.entry,
  };
}

function readActionOperationName(action: PolicyAction): string | null {
  if (
    action === null ||
    typeof action !== "object" ||
    typeof action.name !== "string"
  ) {
    return null;
  }
  if (!action.name.startsWith(PUBLIC_HTTP_ACTION_PREFIX)) {
    return null;
  }
  const operationName = action.name.slice(PUBLIC_HTTP_ACTION_PREFIX.length);
  if (operationName.length === 0 || operationName === "unmapped") {
    return null;
  }
  return operationName;
}

function isWellFormedResource(resource: PolicyResource): boolean {
  if (resource === null || typeof resource !== "object") {
    return false;
  }
  if (typeof resource.kind !== "string" || resource.kind.length === 0) {
    return false;
  }
  if (resource.id !== null && typeof resource.id !== "string") {
    return false;
  }
  if (typeof resource.id === "string" && resource.id.length === 0) {
    return false;
  }
  const keys = Object.keys(resource).sort();
  if (keys.length !== 2 || keys[0] !== "id" || keys[1] !== "kind") {
    return false;
  }
  return true;
}

function isWellFormedAction(action: PolicyAction): boolean {
  if (
    action === null ||
    typeof action !== "object" ||
    typeof action.name !== "string"
  ) {
    return false;
  }
  const keys = Object.keys(action);
  return keys.length === 1 && keys[0] === "name";
}

function isCanonicalPathResourceId(value: string): boolean {
  if (
    value.includes("/") ||
    value.includes("?") ||
    value.includes("#") ||
    value.includes("\\")
  ) {
    return false;
  }
  try {
    return canonicalizeInternalRequestTarget(`/${value}`) === `/${value}`;
  } catch {
    return false;
  }
}

/**
 * True when action/resource is a registry-issued known public HTTP operation
 * with a resource shape matching that operation (kind + id presence).
 */
export function isRegistryIssuedPublicHttpAuthorization(
  action: PolicyAction,
  resource: PolicyResource,
): boolean {
  if (!isWellFormedAction(action)) {
    return false;
  }
  const operationName = readActionOperationName(action);
  if (operationName === null || !isWellFormedResource(resource)) {
    return false;
  }
  const entry = INVENTORY.byOperationName.get(operationName);
  if (entry === undefined) {
    return false;
  }
  if (resource.kind !== entry.resourceKind) {
    return false;
  }
  if (entry.idParam === null) {
    return resource.id === null;
  }
  return resource.id !== null && isCanonicalPathResourceId(resource.id);
}

/**
 * True when a workspace member may perform this registry-issued public HTTP
 * action/resource pair. Forged action/resource mismatches return false.
 */
export function isMemberAllowedPublicHttpAuthorization(
  action: PolicyAction,
  resource: PolicyResource,
): boolean {
  if (!isRegistryIssuedPublicHttpAuthorization(action, resource)) {
    return false;
  }
  const operationName = readActionOperationName(action);
  if (operationName === null) {
    return false;
  }
  return PUBLIC_HTTP_MEMBER_ALLOWLIST.has(operationName);
}

/**
 * Authorize a resolved public HTTP operation via the request-scoped session.
 * Used by the signed adapter and tests.
 */
export function decidePublicHttpAuthorization(args: {
  readonly role: "owner" | "member";
  readonly action: PolicyAction;
  readonly resource: PolicyResource;
}): PolicyDecision {
  if (!isRegistryIssuedPublicHttpAuthorization(args.action, args.resource)) {
    return { allowed: false, reason: "forbidden" };
  }
  const operationName = readActionOperationName(args.action);
  if (operationName === null) {
    return { allowed: false, reason: "forbidden" };
  }
  if (
    args.role === "owner" &&
    PUBLIC_HTTP_WORK_TOGETHER_OWNER_ALLOWLIST.has(operationName)
  ) {
    return { allowed: true };
  }
  if (isMemberAllowedPublicHttpAuthorization(args.action, args.resource)) {
    return { allowed: true };
  }
  return { allowed: false, reason: "forbidden" };
}

/**
 * `/api/v1/*` middleware: authorize before any route handler. Denial is
 * generic/non-enumerating and never invokes the next handler.
 */
export function createPublicHttpAuthorizationMiddleware(args: {
  readonly db: DbConnection;
}): MiddlewareHandler {
  return async (context: Context, next: Next) => {
    const pathname = context.req.path;
    const resolved = scopePublicHttpOperationToStandardProject(
      args.db,
      resolvePublicHttpOperation(context.req.method, pathname),
    );
    const decision = await authorize(
      context,
      resolved.action,
      resolved.resource,
    );
    if (!decision.allowed) {
      if (decision.reason === "unauthenticated") {
        return unauthorizedPrincipalResponse();
      }
      throw new ApiError(404, "not_found", "Not found");
    }
    return next();
  };
}
