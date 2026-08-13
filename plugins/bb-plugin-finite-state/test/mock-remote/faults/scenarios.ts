import {
  ASSURANCE_STUDIO_CALLABLE_ROUTE_IDS,
  ASSURANCE_STUDIO_ROUTES,
} from "../generated/assurance-studio-routes.js";
import {
  PLATFORM_CALLABLE_ROUTE_IDS,
  PLATFORM_ROUTES,
} from "../generated/platform-routes.js";

export const MOCK_SCENARIOS = [
  "as-stale-tara-state",
  "platform-firmware-bytes-forbidden",
  "rate-limit-then-success",
  "rate-limit-exhausted",
  "platform-vex-partial-failure",
  "as-key-strip",
  "mid-push-reset",
  "forge-compute-unavailable",
  "forge-root-digest-mismatch",
] as const;

export type MockScenario = (typeof MOCK_SCENARIOS)[number];
export type FaultService = "platform" | "assurance-studio" | "forge-compute";

export interface ScenarioSpec {
  name: MockScenario;
  service: FaultService;
  routeIds?: string[];
  times?: number;
  afterApplied?: number;
  findingIds?: string[];
  unknownKeys?: string[];
  retryAfterSeconds?: number;
}

export const PLATFORM_BULK_VEX_ROUTE =
  "platform:PUT:/public/v0/findings/{projectVersionId}/status/set/bulk";
export const PLATFORM_FIRMWARE_BYTES_ROUTE =
  "platform:GET:/public/v0/projects/versions/{projectVersionId}/filesystem/file";
export const PLATFORM_FIRMWARE_RANGE_ROUTE =
  "platform:GET:/public/v0/projects/versions/{projectVersionId}/filesystem/content";
export const AS_COMPONENT_UPDATE_ROUTE =
  "assurance-studio:PATCH:/api/projects/{projectId}/components/{componentId}";
export const FORGE_CREATE_ROUTE = "forge-compute:POST:/jobs";
export const FORGE_PREPARE_ROUTE = "forge-compute:POST:/prepare";

const SCENARIOS = new Set<string>(MOCK_SCENARIOS);
const SERVICES = new Set<string>(["platform", "assurance-studio", "forge-compute"]);
const COMMON_FIELDS = new Set(["name", "service", "routeIds"]);
const OPTIONAL_FIELDS: Readonly<Record<MockScenario, ReadonlySet<string>>> = {
  "as-stale-tara-state": new Set(),
  "platform-firmware-bytes-forbidden": new Set(),
  "rate-limit-then-success": new Set(["times", "retryAfterSeconds"]),
  "rate-limit-exhausted": new Set(["times", "retryAfterSeconds"]),
  "platform-vex-partial-failure": new Set(["findingIds"]),
  "as-key-strip": new Set(["unknownKeys"]),
  "mid-push-reset": new Set(["afterApplied"]),
  "forge-compute-unavailable": new Set(),
  "forge-root-digest-mismatch": new Set(),
};

const DEFAULT_ROUTES: Readonly<Record<MockScenario, readonly string[]>> = {
  "as-stale-tara-state": [AS_COMPONENT_UPDATE_ROUTE],
  "platform-firmware-bytes-forbidden": [
    PLATFORM_FIRMWARE_BYTES_ROUTE,
    PLATFORM_FIRMWARE_RANGE_ROUTE,
  ],
  "rate-limit-then-success": [],
  "rate-limit-exhausted": [],
  "platform-vex-partial-failure": [PLATFORM_BULK_VEX_ROUTE],
  "as-key-strip": [AS_COMPONENT_UPDATE_ROUTE],
  "mid-push-reset": [PLATFORM_BULK_VEX_ROUTE],
  "forge-compute-unavailable": [FORGE_CREATE_ROUTE],
  "forge-root-digest-mismatch": [FORGE_PREPARE_ROUTE],
};

const SCENARIO_SERVICE: Readonly<Record<MockScenario, FaultService | "any">> = {
  "as-stale-tara-state": "assurance-studio",
  "platform-firmware-bytes-forbidden": "platform",
  "rate-limit-then-success": "any",
  "rate-limit-exhausted": "any",
  "platform-vex-partial-failure": "platform",
  "as-key-strip": "assurance-studio",
  "mid-push-reset": "platform",
  "forge-compute-unavailable": "forge-compute",
  "forge-root-digest-mismatch": "forge-compute",
};

const FAULT_RESPONSE_STATUS: Readonly<Partial<Record<MockScenario, number>>> = {
  "as-stale-tara-state": 409,
  "platform-firmware-bytes-forbidden": 403,
  "rate-limit-then-success": 429,
  "rate-limit-exhausted": 429,
  "platform-vex-partial-failure": 200,
  "as-key-strip": 200,
  "mid-push-reset": 599,
};

const TRANSPORT_STATUS_EXCEPTIONS: ReadonlySet<string> = new Set([
  // Rate limiting is injected at the gateway boundary, outside a route's
  // application response vocabulary, but remains an ordinary HTTP response.
  "rate-limit-then-success:429",
  "rate-limit-exhausted:429",
  // The in-process sentinel is converted to a thrown transport TypeError by
  // transportResetFetch and is never exposed to a production client as HTTP.
  "mid-push-reset:599",
]);

const AUDITED_STATUS_EVIDENCE: ReadonlySet<string> = new Set([
  // The Direct APIs audit registered this PATCH route without response status
  // metadata. Its current success handler and frozen stale-TARA fault fixture
  // are the reviewed evidence until the generated audit gains statuses.
  `${AS_COMPONENT_UPDATE_ROUTE}:200`,
  `${AS_COMPONENT_UPDATE_ROUTE}:409`,
]);

function fail(message: string): never {
  throw new TypeError(`Invalid mock fault scenario: ${message}`);
}

function strings(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0 ||
    value.some((item) => typeof item !== "string" || item.length === 0)) {
    fail(`${field} must be a non-empty string array`);
  }
  return [...value];
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    fail(`${field} must be a positive integer`);
  }
  return Number(value);
}

function knownRoutes(service: FaultService): ReadonlySet<string> {
  if (service === "platform") return new Set(PLATFORM_CALLABLE_ROUTE_IDS);
  if (service === "assurance-studio") return new Set(ASSURANCE_STUDIO_CALLABLE_ROUTE_IDS);
  return new Set([FORGE_CREATE_ROUTE, FORGE_PREPARE_ROUTE]);
}

function responseStatuses(service: FaultService, routeId: string): readonly number[] {
  if (service === "forge-compute") return [];
  const routes = service === "platform" ? PLATFORM_ROUTES : ASSURANCE_STUDIO_ROUTES;
  return routes.find((route) => route.routeId === routeId)?.responseStatuses ?? [];
}

export function normalizeScenarioSpec(input: ScenarioSpec): ScenarioSpec & { routeIds: string[] } {
  if (input === null || typeof input !== "object" || Array.isArray(input)) fail("spec must be an object");
  const record = input as unknown as Record<string, unknown>;
  if (typeof record.name !== "string" || !SCENARIOS.has(record.name)) fail(`unknown scenario ${String(record.name)}`);
  if (typeof record.service !== "string" || !SERVICES.has(record.service)) fail(`unknown service ${String(record.service)}`);
  const name = record.name as MockScenario;
  const service = record.service as FaultService;
  const allowedFields = new Set([...COMMON_FIELDS, ...OPTIONAL_FIELDS[name]]);
  const unknownField = Object.keys(record).find((field) => !allowedFields.has(field));
  if (unknownField !== undefined) fail(`unknown field ${unknownField}`);
  const owner = SCENARIO_SERVICE[name];
  if (owner !== "any" && owner !== service) fail(`${name} does not belong to ${service}`);

  const routeIds = record.routeIds === undefined
    ? [...DEFAULT_ROUTES[name]]
    : strings(record.routeIds, "routeIds");
  if (routeIds.length === 0) fail("routeIds are required for service-wide rate limiting");
  const known = knownRoutes(service);
  const unknownRoute = routeIds.find((routeId) => !known.has(routeId));
  if (unknownRoute !== undefined) fail(`unknown route ${unknownRoute}`);
  const faultStatus = FAULT_RESPONSE_STATUS[name];
  if (faultStatus !== undefined &&
    !TRANSPORT_STATUS_EXCEPTIONS.has(`${name}:${faultStatus}`)) {
    const incompatibleRoute = routeIds.find((routeId) =>
      !responseStatuses(service, routeId).includes(faultStatus) &&
      !AUDITED_STATUS_EVIDENCE.has(`${routeId}:${faultStatus}`),
    );
    if (incompatibleRoute !== undefined) {
      fail(`status ${faultStatus} is not declared by route ${incompatibleRoute}`);
    }
  }
  const defaults = DEFAULT_ROUTES[name];
  if (defaults.length > 0 && routeIds.some((routeId) => !defaults.includes(routeId))) {
    fail(`route is not supported by ${name}`);
  }

  const normalized: ScenarioSpec & { routeIds: string[] } = { name, service, routeIds };
  if (record.times !== undefined) normalized.times = positiveInteger(record.times, "times");
  if (record.afterApplied !== undefined) normalized.afterApplied = positiveInteger(record.afterApplied, "afterApplied");
  if (record.findingIds !== undefined) normalized.findingIds = strings(record.findingIds, "findingIds");
  if (record.unknownKeys !== undefined) normalized.unknownKeys = strings(record.unknownKeys, "unknownKeys");
  if (record.retryAfterSeconds !== undefined) {
    if (typeof record.retryAfterSeconds !== "number" || !Number.isFinite(record.retryAfterSeconds) || record.retryAfterSeconds < 0) {
      fail("retryAfterSeconds must be a non-negative finite number");
    }
    normalized.retryAfterSeconds = record.retryAfterSeconds;
  }
  if (name === "platform-vex-partial-failure" && normalized.findingIds === undefined) {
    fail("findingIds are required for platform-vex-partial-failure");
  }
  if (name === "as-key-strip" && normalized.unknownKeys === undefined) {
    fail("unknownKeys are required for as-key-strip");
  }
  return normalized;
}
