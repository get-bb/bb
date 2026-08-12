import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

import {
  ASSURANCE_STUDIO_ROUTE_PATCHES,
  handlerAuditRoute,
  type AssuranceStudioRoutePatch,
} from "./as-route-patches.js";
import type { MockRoute, MockService } from "./types.js";

export const ROUTE_GENERATOR_VERSION = "1";

const MOCK_ROOT = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REFERENCE_ROOT = resolve(
  MOCK_ROOT,
  "../../docs/Implementation/api-reference",
);
const DEFAULT_OUTPUT_ROOT = resolve(MOCK_ROOT, "generated");
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

const REQUIRED_SOURCES = [
  "finite-state-api-v0.3.0.openapi.yaml",
  "finite-state-api-v0.3.0.reference.md",
  "finite-state-api-v0.3.0.endpoint-audit.md",
  "assurance-studio-openapi-2026-05-12.json",
  "assurance-studio-openapi-notes.md",
  "assurance-studio-api-gaps.md",
] as const;

/** Deliberate HTTP intersection for the named methods frozen by WP-06. */
const WP06_PLATFORM_CALLABLE_KEYS = new Set([
  "GET /public/v0/projects",
  "GET /public/v0/projects/{projectId}/versions",
  "GET /public/v0/findings",
  "GET /public/v0/versions/{projectVersionId}/findings",
  "GET /public/v0/projects/{projectId}/findings/activity",
  "PUT /public/v0/findings/{projectVersionId}/{findingId}/status",
  "PUT /public/v0/findings/{projectVersionId}/status/set/bulk",
  "PUT /public/v0/findings/{projectVersionId}/status/clear/bulk",
  "GET /public/v0/sboms/cyclonedx/{projectVersionId}",
  "GET /public/v0/sboms/spdx/{projectVersionId}",
  "GET /public/v0/components",
  "GET /public/v0/components/search",
  "GET /public/v0/projects/versions/{projectVersionId}/filesystem/tree",
  "GET /public/v0/projects/versions/{projectVersionId}/filesystem/file",
  "GET /public/v0/projects/versions/{projectVersionId}/filesystem/overview",
  "GET /public/v0/projects/versions/{projectVersionId}/filesystem/content",
  "GET /public/v0/projects/versions/{projectVersionId}/security-assessment/configs/list",
  "GET /public/v0/projects/versions/{projectVersionId}/security-assessment/configs/details",
  "GET /public/v0/projects/versions/{projectVersionId}/security-assessment/binaries/info",
  "GET /public/v0/projects/versions/{projectVersionId}/security-assessment/binaries/imports",
  "GET /public/v0/projects/versions/{projectVersionId}/security-assessment/binaries/exports",
  "GET /public/v0/projects/versions/{projectVersionId}/security-assessment/binaries/file-details",
  "GET /public/v0/projects/versions/{projectVersionId}/security-assessment/binaries/has-imports",
  "GET /public/v0/projects/versions/{projectVersionId}/security-assessment/binaries/has-exports",
  "GET /public/v0/projects/versions/{projectVersionId}/security-assessment/dependencies/loads",
  "GET /public/v0/projects/versions/{projectVersionId}/security-assessment/dependencies/loaded-by",
  "GET /public/v0/projects/versions/{projectVersionId}/security-assessment/callgraph/callers",
  "GET /public/v0/projects/versions/{projectVersionId}/security-assessment/callgraph/callees",
  "GET /public/v0/projects/versions/{projectVersionId}/security-assessment/services/list",
  "GET /public/v0/projects/versions/{projectVersionId}/security-assessment/services/details",
  "GET /public/v0/projects/versions/{projectVersionId}/security-assessment/services/systemd-units",
  "GET /public/v0/projects/versions/{projectVersionId}/security-assessment/processing-errors",
  "GET /public/v0/projects/versions/{projectVersionId}/security-assessment/crypto/list",
  "GET /public/v0/projects/versions/{projectVersionId}/security-assessment/crypto/details",
  "GET /public/v0/projects/versions/{projectVersionId}/security-assessment/kernel/config",
  "GET /public/v0/projects/versions/{projectVersionId}/security-assessment/architecture",
  "GET /public/v0/projects/versions/{projectVersionId}/security-assessment/architecture-breakdown",
]);

/** Deliberate HTTP intersection for the named methods frozen by WP-06. */
const WP06_ASSURANCE_STUDIO_CALLABLE_KEYS = new Set([
  ...["threats", "risks", "mitigations", "zones", "data-flows", "components", "requirements"].flatMap(
    (collection) => [
      `GET /api/projects/{projectId}/${collection}`,
      `POST /api/projects/{projectId}/${collection}`,
    ],
  ),
  "GET /api/projects/{projectId}/attack-paths",
  ...[
    ["threats", "threatId"],
    ["mitigations", "mitigationId"],
    ["assets", "assetId"],
    ["zones", "zoneId"],
    ["data-flows", "dataFlowId"],
    ["components", "componentId"],
    ["requirements", "requirementId"],
    ["attack-paths", "pathId"],
  ].flatMap(([collection, id]) =>
    HTTP_METHODS.filter((method) => method === "GET" || method === "PATCH" || method === "DELETE").map(
      (method) => `${method} /api/projects/{projectId}/${collection}/{${id}}`,
    ),
  ),
  "GET /api/projects/{id}/sbom",
  "GET /api/projects/{projectId}/verification/checks",
  "GET /api/projects/{projectId}/verification/checks/{checkId}",
  "POST /api/projects/{projectId}/verification/run",
]);

interface OpenApiInventory {
  routes: MockRoute[];
  pathCount: number;
  operationCount: number;
}

interface GeneratedArtifacts {
  readonly files: Readonly<Record<string, string>>;
  readonly platformRoutes: readonly MockRoute[];
  readonly assuranceStudioRoutes: readonly MockRoute[];
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return Object.fromEntries(Object.entries(value));
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function routeKey(route: Pick<MockRoute, "method" | "pathTemplate">): string {
  return `${route.method} ${route.pathTemplate}`;
}

function routeSort(left: MockRoute, right: MockRoute): number {
  return (
    left.service.localeCompare(right.service) ||
    left.pathTemplate.localeCompare(right.pathTemplate) ||
    left.method.localeCompare(right.method)
  );
}

function responseStatuses(operation: Record<string, unknown>): number[] {
  const responses = record(operation.responses ?? {}, "operation.responses");
  return Object.keys(responses)
    .filter((status) => /^[1-5][0-9][0-9]$/.test(status))
    .map(Number)
    .sort((left, right) => left - right);
}

function requestMediaTypes(operation: Record<string, unknown>): string[] {
  if (operation.requestBody === undefined) return [];
  const requestBody = record(operation.requestBody, "operation.requestBody");
  if (requestBody.content === undefined) return [];
  return Object.keys(record(requestBody.content, "operation.requestBody.content")).sort();
}

function normalizeOpenApi(
  input: unknown,
  service: MockService,
): OpenApiInventory {
  const document = record(input, `${service} OpenAPI`);
  const paths = record(document.paths, `${service} OpenAPI paths`);
  const routes: MockRoute[] = [];

  for (const [pathTemplate, pathValue] of Object.entries(paths)) {
    const path = record(pathValue, `${service} path ${pathTemplate}`);
    for (const method of HTTP_METHODS) {
      const operationValue = path[method.toLowerCase()];
      if (operationValue === undefined) continue;
      const operation = record(
        operationValue,
        `${service} ${method} ${pathTemplate}`,
      );
      const operationId = operation.operationId;
      if (operationId !== undefined && typeof operationId !== "string") {
        throw new Error(`${service} ${method} ${pathTemplate} has invalid operationId`);
      }
      routes.push({
        routeId: `${service}:${method}:${pathTemplate}`,
        service,
        method,
        pathTemplate,
        operationId: operationId ?? null,
        auth: service === "platform" ? "X-Authorization" : "X-API-Key",
        requestMediaTypes: requestMediaTypes(operation),
        responseStatuses: responseStatuses(operation),
        source: "openapi",
      });
    }
  }

  routes.sort(routeSort);
  return {
    routes,
    pathCount: Object.keys(paths).length,
    operationCount: routes.length,
  };
}

function indexHashes(index: string): Map<string, string> {
  const hashes = new Map<string, string>();
  for (const line of index.split(/\r?\n/)) {
    const match = /^\| `([^`]+)` \| .* \| `([0-9a-f]{64})` \|/.exec(line);
    if (match) hashes.set(match[1], match[2]);
  }
  return hashes;
}

async function verifiedSources(referenceRoot: string): Promise<Map<string, string>> {
  const index = await readFile(resolve(referenceRoot, "README.md"), "utf8");
  const expected = indexHashes(index);
  const sources = new Map<string, string>();

  for (const name of REQUIRED_SOURCES) {
    const expectedHash = expected.get(name);
    if (expectedHash === undefined) {
      throw new Error(`Vendored source is missing from API-reference index: ${name}`);
    }
    const contents = await readFile(resolve(referenceRoot, name), "utf8");
    const actualHash = sha256(contents);
    if (actualHash !== expectedHash) {
      throw new Error(
        `Vendored source checksum mismatch for ${name}: expected ${expectedHash}, received ${actualHash}`,
      );
    }
    sources.set(name, contents);
  }
  return sources;
}

function markdownSection(markdown: string, section: string): string | null {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith(`## ${section}.`));
  if (start < 0) return null;
  const endOffset = lines.slice(start + 1).findIndex((line) => line.startsWith("## "));
  const end = endOffset < 0 ? lines.length : start + 1 + endOffset;
  return lines.slice(start, end).join("\n");
}

export function validateAssuranceStudioRoutePatches(
  patches: readonly (Partial<AssuranceStudioRoutePatch> &
    Pick<AssuranceStudioRoutePatch, "method" | "pathTemplate">)[],
  evidenceFiles: ReadonlyMap<string, string>,
): void {
  const seen = new Set<string>();
  for (const patch of patches) {
    if (!patch.evidenceFile || !patch.evidenceSection) {
      throw new Error(`Handler-audit patch lacks evidence: ${patch.method} ${patch.pathTemplate}`);
    }
    const markdown = evidenceFiles.get(patch.evidenceFile);
    const section = markdown && markdownSection(markdown, patch.evidenceSection);
    const evidenceLine = section
      ?.split(/\r?\n/)
      .find((line) => line.includes(patch.pathTemplate));
    if (evidenceLine === undefined || !evidenceLine.includes(patch.method)) {
      throw new Error(
        `Handler-audit evidence not found for ${patch.method} ${patch.pathTemplate} in ${patch.evidenceFile} §${patch.evidenceSection}`,
      );
    }
    const key = `${patch.method} ${patch.pathTemplate}`;
    if (seen.has(key)) throw new Error(`Duplicate handler-audit patch: ${key}`);
    seen.add(key);
  }
}

function mergeAssuranceStudioRoutes(
  openApiRoutes: readonly MockRoute[],
  patches: readonly AssuranceStudioRoutePatch[],
): MockRoute[] {
  const routes = new Map(openApiRoutes.map((route) => [routeKey(route), route]));
  for (const patch of patches) {
    const route = handlerAuditRoute(patch);
    routes.set(routeKey(route), route);
  }
  return [...routes.values()].sort(routeSort);
}

function renderRoutes(
  service: MockService,
  referenceRoutes: readonly MockRoute[],
  callableKeys: ReadonlySet<string>,
): string {
  const prefix = service === "platform" ? "PLATFORM" : "ASSURANCE_STUDIO";
  const callableRouteIds = referenceRoutes
    .filter((route) => callableKeys.has(routeKey(route)))
    .map((route) => route.routeId);
  return [
    "// Generated by generate-routes.ts. Do not edit.",
    'import type { MockRoute } from "../types.js";',
    "",
    `export const ${prefix}_REFERENCE_ROUTES = ${JSON.stringify(referenceRoutes, null, 2)} as const satisfies readonly MockRoute[];`,
    "",
    `export const ${prefix}_CALLABLE_ROUTE_IDS = ${JSON.stringify(callableRouteIds, null, 2)} as const;`,
    "",
    `const callableRouteIds = new Set<string>(${prefix}_CALLABLE_ROUTE_IDS);`,
    `export const ${prefix}_ROUTES: readonly MockRoute[] = ${prefix}_REFERENCE_ROUTES.filter((route) => callableRouteIds.has(route.routeId));`,
    "",
  ].join("\n");
}

function requiredSource(
  sources: ReadonlyMap<string, string>,
  name: string,
): string {
  const source = sources.get(name);
  if (source === undefined) throw new Error(`Verified source unavailable: ${name}`);
  return source;
}

export async function generateRouteArtifacts(
  referenceRoot = DEFAULT_REFERENCE_ROOT,
): Promise<GeneratedArtifacts> {
  const sources = await verifiedSources(referenceRoot);
  const platformSource = requiredSource(
    sources,
    "finite-state-api-v0.3.0.openapi.yaml",
  );
  const assuranceStudioSource = requiredSource(
    sources,
    "assurance-studio-openapi-2026-05-12.json",
  );
  const platformParsed: unknown = parseYaml(platformSource);
  const assuranceStudioParsed: unknown = JSON.parse(assuranceStudioSource);
  const platform = normalizeOpenApi(platformParsed, "platform");
  const assuranceStudioOpenApi = normalizeOpenApi(
    assuranceStudioParsed,
    "assurance-studio",
  );

  validateAssuranceStudioRoutePatches(ASSURANCE_STUDIO_ROUTE_PATCHES, sources);
  const assuranceStudioReferenceRoutes = mergeAssuranceStudioRoutes(
    assuranceStudioOpenApi.routes,
    ASSURANCE_STUDIO_ROUTE_PATCHES,
  );
  const platformOutput = renderRoutes(
    "platform",
    platform.routes,
    WP06_PLATFORM_CALLABLE_KEYS,
  );
  const assuranceStudioOutput = renderRoutes(
    "assurance-studio",
    assuranceStudioReferenceRoutes,
    WP06_ASSURANCE_STUDIO_CALLABLE_KEYS,
  );
  const sourceRows = [
    {
      name: "finite-state-api-v0.3.0.openapi.yaml",
      sha256: sha256(platformSource),
      pathCount: platform.pathCount,
      operationCount: platform.operationCount,
    },
    {
      name: "assurance-studio-openapi-2026-05-12.json",
      sha256: sha256(assuranceStudioSource),
      pathCount: assuranceStudioOpenApi.pathCount,
      operationCount: assuranceStudioOpenApi.operationCount,
    },
  ];
  const evidenceRows = [
    "finite-state-api-v0.3.0.reference.md",
    "finite-state-api-v0.3.0.endpoint-audit.md",
    "assurance-studio-openapi-notes.md",
    "assurance-studio-api-gaps.md",
  ].map((name) => ({ name, sha256: sha256(requiredSource(sources, name)) }));
  const manifest = `${JSON.stringify(
    {
      generatorVersion: ROUTE_GENERATOR_VERSION,
      sources: sourceRows,
      evidenceSources: evidenceRows,
      outputs: [
        { name: "platform-routes.ts", sha256: sha256(platformOutput) },
        {
          name: "assurance-studio-routes.ts",
          sha256: sha256(assuranceStudioOutput),
        },
      ],
    },
    null,
    2,
  )}\n`;
  const files = {
    "platform-routes.ts": platformOutput,
    "assurance-studio-routes.ts": assuranceStudioOutput,
    "source-manifest.json": manifest,
  };

  return {
    files,
    platformRoutes: platform.routes.filter((route) =>
      WP06_PLATFORM_CALLABLE_KEYS.has(routeKey(route)),
    ),
    assuranceStudioRoutes: assuranceStudioReferenceRoutes.filter((route) =>
      WP06_ASSURANCE_STUDIO_CALLABLE_KEYS.has(routeKey(route)),
    ),
  };
}

export async function runRouteGeneration(options: {
  readonly check: boolean;
  readonly referenceRoot?: string;
  readonly outputRoot?: string;
}): Promise<void> {
  const outputRoot = options.outputRoot ?? DEFAULT_OUTPUT_ROOT;
  const generated = await generateRouteArtifacts(options.referenceRoot);
  if (options.check) {
    // Materialize in a private location first so check mode exercises complete output
    // generation without mutating the checked-in directory.
    const isolatedRoot = await mkdtemp(resolve(tmpdir(), "fs-mock-routes-"));
    try {
      for (const [name, contents] of Object.entries(generated.files)) {
        await writeFile(resolve(isolatedRoot, name), contents, "utf8");
        let checkedIn: string;
        try {
          checkedIn = await readFile(resolve(outputRoot, name), "utf8");
        } catch {
          throw new Error(`Generated route output is missing: ${name}`);
        }
        if (checkedIn !== contents) {
          throw new Error(`Generated route output drift detected: ${name}`);
        }
      }
    } finally {
      await rm(isolatedRoot, { recursive: true, force: true });
    }
    return;
  }

  await mkdir(outputRoot, { recursive: true });
  for (const [name, contents] of Object.entries(generated.files)) {
    await writeFile(resolve(outputRoot, name), contents, "utf8");
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--check")) {
    throw new Error("Usage: generate-routes [--check]");
  }
  await runRouteGeneration({ check: args.includes("--check") });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
