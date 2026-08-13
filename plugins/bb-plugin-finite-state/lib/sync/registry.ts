/**
 * The finite-state entity registry is deliberately a compile-time inventory.
 *
 * A key is an opaque, versioned sequence of NFC UTF-8 segments.  The `fs1`
 * prefix identifies this encoding; each following segment is base64url and is
 * therefore safe to delimit with a dot.  Project scope intentionally does not
 * participate in an entity's stable business key: callers carry it in the
 * separate `EntityScope` fields used for every remote and SQLite operation.
 */

import {
  CACHE_STORAGE_NAMES,
  type CacheStorageName,
} from "../store/schema.js";

export { CACHE_STORAGE_NAMES };
export type { CacheStorageName };

export type EntityClass = "VERSIONED" | "CACHED" | "OVERLAY" | "ACTION-ONLY";
export type RemoteTarget = "platform" | "assurance-studio" | "none";
export type KeyFn = (value: Readonly<Record<string, unknown>>) => string;

export interface EntityScope {
  readonly projectId: string;
  readonly projectVersionId: string;
}

type RemoteFileEntry = {
  readonly class: "VERSIONED" | "OVERLAY";
  readonly server: "platform" | "assurance-studio";
  readonly localOnly?: false;
  readonly dir: string;
  readonly key: KeyFn;
};

type LocalFileEntry = {
  readonly class: "VERSIONED" | "OVERLAY";
  readonly server: "none";
  readonly localOnly?: boolean;
  readonly dir: string;
  readonly key: KeyFn;
};

type LocalSingleFileEntry = {
  readonly class: "VERSIONED" | "OVERLAY";
  readonly server: "none";
  readonly localOnly: true;
  readonly file: string;
  readonly aggregate?: false;
};

type RemoteInlineEntry = {
  readonly class: "OVERLAY";
  readonly server: "platform" | "assurance-studio";
  readonly localOnly?: false;
  readonly inline: string;
  readonly key: KeyFn;
};

type LocalInlineEntry = {
  readonly class: "OVERLAY";
  readonly server: "none";
  readonly localOnly?: boolean;
  readonly inline: string;
  readonly key: KeyFn;
};

type AggregateFileEntry = {
  readonly class: "VERSIONED";
  readonly server: "none";
  readonly localOnly?: false;
  readonly file: string;
  readonly key: KeyFn;
  readonly aggregate: true;
};

type CacheEntry = {
  readonly class: "CACHED";
  readonly table: CacheStorageName;
  readonly storageKind?: "table" | "view";
};

type ActionEntry = {
  readonly class: "ACTION-ONLY";
};

export type EntityEntry =
  | RemoteFileEntry
  | LocalFileEntry
  | LocalSingleFileEntry
  | RemoteInlineEntry
  | LocalInlineEntry
  | AggregateFileEntry
  | CacheEntry
  | ActionEntry;

const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;
const PATH_SEPARATOR = /[\\/]/u;
const BASE64URL_SEGMENT = /^[A-Za-z0-9_-]+$/u;
const KEY_PREFIX = "fs1";
const MISSING_GROUP = "\u0000";

export class InvalidEntityKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidEntityKeyError";
  }
}

export class UnknownEntityKindError extends Error {
  constructor(readonly kind: string) {
    super(`Unknown Finite State entity kind: ${kind}`);
    this.name = "UnknownEntityKindError";
  }
}

function normalizeSegment(value: string, label: string, allowPathSeparator = false): string {
  const normalized = value.normalize("NFC").trim();
  if (!normalized) {
    throw new InvalidEntityKeyError(`${label} must not be empty`);
  }
  if (CONTROL_CHARACTER.test(normalized)) {
    throw new InvalidEntityKeyError(`${label} must not contain control characters`);
  }
  if (!allowPathSeparator && PATH_SEPARATOR.test(normalized)) {
    throw new InvalidEntityKeyError(`${label} must not contain a path separator`);
  }
  return normalized;
}

function valueString(value: Readonly<Record<string, unknown>>, field: string): string {
  const candidate = value[field];
  if (typeof candidate !== "string") {
    throw new InvalidEntityKeyError(`${field} must be a string`);
  }
  return normalizeSegment(candidate, field);
}

function optionalValueString(
  value: Readonly<Record<string, unknown>>,
  field: string,
  allowPathSeparator = false,
): string | null {
  const candidate = value[field];
  if (candidate === undefined || candidate === null) {
    return null;
  }
  if (typeof candidate !== "string") {
    throw new InvalidEntityKeyError(`${field} must be a string when supplied`);
  }
  return normalizeSegment(candidate, field, allowPathSeparator);
}

function encodeSegments(segments: readonly string[]): string {
  return [KEY_PREFIX, ...segments.map((segment) => Buffer.from(segment, "utf8").toString("base64url"))].join(".");
}

/** Encodes non-empty, path-safe segments into the canonical opaque key form. */
export function encodeKey(...segments: readonly string[]): string {
  return encodeSegments(segments.map((segment, index) => normalizeSegment(segment, `segment ${index + 1}`)));
}

/** Decodes and validates canonical key framing without assigning domain meaning. */
export function parseKey(key: string): readonly string[] {
  const parts = key.split(".");
  if (parts[0] !== KEY_PREFIX || parts.length < 2 || parts.some((part) => !part)) {
    throw new InvalidEntityKeyError("key must use the fs1 dot-delimited base64url format");
  }

  return parts.slice(1).map((segment) => {
    if (!BASE64URL_SEGMENT.test(segment)) {
      throw new InvalidEntityKeyError("key contains a non-base64url segment");
    }
    const decoded = Buffer.from(segment, "base64url").toString("utf8");
    if (Buffer.from(decoded, "utf8").toString("base64url") !== segment) {
      throw new InvalidEntityKeyError("key contains a non-canonical UTF-8 segment");
    }
    if (decoded !== decoded.normalize("NFC")) {
      throw new InvalidEntityKeyError("key contains a non-NFC segment");
    }
    return decoded;
  });
}

export function slugKey(value: Readonly<Record<string, unknown>>): string {
  return encodeKey("slug", valueString(value, "slug"));
}

export function reqIdKey(value: Readonly<Record<string, unknown>>): string {
  return encodeKey("requirement", valueString(value, "reqId"));
}

export function hbomIdKey(value: Readonly<Record<string, unknown>>): string {
  return encodeKey("hbom-part", valueString(value, "id"));
}

export function checkCodeKey(value: Readonly<Record<string, unknown>>): string {
  return encodeKey("check", valueString(value, "code"));
}

export function componentSlugKey(value: Readonly<Record<string, unknown>>): string {
  return encodeKey("component", valueString(value, "componentSlug"));
}

export function referenceDesignatorKey(value: Readonly<Record<string, unknown>>): string {
  return encodeKey("hardware-reference", valueString(value, "reference"));
}

export function sourcePathKey(value: Readonly<Record<string, unknown>>): string {
  const sourcePath = value.file;
  if (typeof sourcePath !== "string") {
    throw new InvalidEntityKeyError("file must be a string");
  }
  return encodeSegments([
    "citation-file",
    normalizeSegment(sourcePath, "file", true),
  ]);
}

export function routeSignatureKey(value: Readonly<Record<string, unknown>>): string {
  return encodeKey("route", valueString(value, "routeSignature"));
}

export interface FindingIdentity {
  readonly cve: string;
  readonly purl?: string | null;
  readonly name: string;
  readonly group?: string | null;
  readonly version?: string | null;
}

export type FindingKeyTier = "purl" | "name-group-version" | "name-group-any-version";

export type ParsedFindingStableKey = Readonly<{
  cve: string;
  tier: FindingKeyTier;
  component: Readonly<
    | { readonly purl: string }
    | { readonly name: string; readonly group: string | null; readonly version: string | null }
  >;
}>;

function caseFold(value: string): string {
  return normalizeSegment(value, "finding component").toLocaleLowerCase("en-US");
}

function findingSegments(value: Readonly<Record<string, unknown>>, tier?: FindingKeyTier): readonly string[] {
  const cve = valueString(value, "cve");
  const purl = optionalValueString(value, "purl", true);
  const name = caseFold(valueString(value, "name"));
  const group = optionalValueString(value, "group");
  const version = optionalValueString(value, "version");
  const selectedTier = tier ?? (purl ? "purl" : version ? "name-group-version" : "name-group-any-version");

  if (selectedTier === "purl") {
    if (!purl) {
      throw new InvalidEntityKeyError("purl tier requires purl");
    }
    return ["finding", selectedTier, cve, purl];
  }
  if (selectedTier === "name-group-version") {
    if (!version) {
      throw new InvalidEntityKeyError("name-group-version tier requires version");
    }
    return ["finding", selectedTier, cve, name, group ? caseFold(group) : MISSING_GROUP, caseFold(version)];
  }
  if (selectedTier === "name-group-any-version") {
    return ["finding", selectedTier, cve, name, group ? caseFold(group) : MISSING_GROUP];
  }
  throw new InvalidEntityKeyError(`Unsupported finding key tier: ${selectedTier}`);
}

export function findingStableKey(value: Readonly<Record<string, unknown>>, tier?: FindingKeyTier): string {
  return encodeSegments(findingSegments(value, tier));
}

export function parseFindingStableKey(key: string): ParsedFindingStableKey {
  const segments = parseKey(key);
  const [kind, tier, cve, ...component] = segments;
  if (kind !== "finding" || !cve) {
    throw new InvalidEntityKeyError("key is not a finding key");
  }
  if (tier === "purl" && component.length === 1) {
    return { cve, tier, component: { purl: component[0] } };
  }
  if (tier === "name-group-version" && component.length === 3) {
    return {
      cve,
      tier,
      component: { name: component[0], group: component[1] === MISSING_GROUP ? null : component[1], version: component[2] },
    };
  }
  if (tier === "name-group-any-version" && component.length === 2) {
    return {
      cve,
      tier,
      component: { name: component[0], group: component[1] === MISSING_GROUP ? null : component[1], version: null },
    };
  }
  throw new InvalidEntityKeyError("finding key has an invalid tier or segment count");
}

export const ENTITIES = {
  component: { class: "VERSIONED", server: "assurance-studio", dir: "product-security/architecture/components", key: slugKey },
  zone: { class: "VERSIONED", server: "assurance-studio", dir: "product-security/architecture/zones", key: slugKey },
  dataflow: { class: "VERSIONED", server: "assurance-studio", dir: "product-security/architecture/dataflows", key: slugKey },
  asset: { class: "VERSIONED", server: "assurance-studio", dir: "product-security/architecture/assets", key: slugKey },
  threat: { class: "VERSIONED", server: "assurance-studio", dir: "product-security/threats", key: slugKey },
  mitigation: { class: "VERSIONED", server: "assurance-studio", dir: "product-security/mitigations", key: slugKey },
  requirement: { class: "VERSIONED", server: "assurance-studio", dir: "product-security/requirements", key: reqIdKey },
  hbomPart: { class: "VERSIONED", server: "none", file: "product-security/hbom/hbom.yaml", key: hbomIdKey, aggregate: true },

  vexDecision: { class: "OVERLAY", server: "platform", dir: ".fs/triage", key: findingStableKey },
  reqCheckMap: { class: "OVERLAY", server: "assurance-studio", inline: "requirement", key: reqIdKey },
  checkParams: { class: "OVERLAY", server: "assurance-studio", dir: ".fs/verification/checks", key: checkCodeKey },
  attackPath: { class: "OVERLAY", server: "assurance-studio", dir: ".fs/attack-paths", key: routeSignatureKey },
  sbomLink: { class: "OVERLAY", server: "assurance-studio", dir: ".fs/links", key: componentSlugKey },
  firmwareLink: { class: "OVERLAY", server: "none", localOnly: true, dir: ".fs/links", key: componentSlugKey },
  canvasLayout: { class: "VERSIONED", server: "none", localOnly: true, file: "product-security/layout/canvas.json" },
  hardwareLink: { class: "OVERLAY", server: "none", localOnly: true, dir: "product-security/links", key: referenceDesignatorKey },
  citationFile: { class: "OVERLAY", server: "none", localOnly: true, dir: ".fs/authoring/citations", key: sourcePathKey },
  authoringGate: { class: "VERSIONED", server: "none", localOnly: true, file: ".fs/workflows/authoring-gate.yaml" },

  finding: { class: "CACHED", table: "findings" },
  sbomComponent: { class: "CACHED", table: "sbom_components" },
  standardClause: { class: "CACHED", table: "standards_clauses" },
  attackPathBody: { class: "CACHED", table: "attack_paths" },
  verificationRun: { class: "CACHED", table: "verification_runs" },
  verificationResult: { class: "CACHED", table: "verification_results" },
  firmwareMount: { class: "CACHED", table: "firmware_mounts" },
  document: { class: "CACHED", table: "document" },
  hbomDoc: { class: "CACHED", table: "hbom_docs", storageKind: "view" },
  hardwareProject: { class: "CACHED", table: "hw_project" },
  hardwareArtifact: { class: "CACHED", table: "hw_artifact" },
  hardwareSymbol: { class: "CACHED", table: "hw_symbol" },
  hardwareNet: { class: "CACHED", table: "hw_net" },
  hardwareViolation: { class: "CACHED", table: "hw_violation" },
  groundingSource: { class: "CACHED", table: "ground_source" },
  groundingChunk: { class: "CACHED", table: "ground_chunk" },
  benchDevice: { class: "CACHED", table: "bench_device" },
  probeRun: { class: "CACHED", table: "probe_run" },
  buildRun: { class: "CACHED", table: "build_run" },

  reviewTransition: { class: "ACTION-ONLY" },
  verificationDispatch: { class: "ACTION-ONLY" },
  benchDispatch: { class: "ACTION-ONLY" },
  firmwareMaterialize: { class: "ACTION-ONLY" },
} as const satisfies Readonly<Record<string, EntityEntry>>;

export type EntityKind = keyof typeof ENTITIES;
type EntityAt<K extends EntityKind> = (typeof ENTITIES)[K];
export type SemanticPlanEntityKind = {
  [K in EntityKind]: EntityAt<K> extends { readonly class: "VERSIONED" | "OVERLAY"; readonly localOnly: true } ? never
    : EntityAt<K> extends { readonly class: "VERSIONED" | "OVERLAY" } ? K
      : never;
}[EntityKind];
export type RemotePushableEntityKind = {
  [K in EntityKind]: EntityAt<K> extends { readonly server: "platform" | "assurance-studio" } ? K : never;
}[EntityKind];

export function entryFor(kind: string): (typeof ENTITIES)[EntityKind] {
  if (!isEntityKind(kind)) {
    throw new UnknownEntityKindError(kind);
  }
  return ENTITIES[kind];
}

function isEntityKind(kind: string): kind is EntityKind {
  return Object.hasOwn(ENTITIES, kind);
}

/** Local semantic plans include authored server:none files such as HBOM. */
export function isSemanticPlanEntity(kind: EntityKind): kind is SemanticPlanEntityKind {
  const entry = ENTITIES[kind];
  return (entry.class === "VERSIONED" || entry.class === "OVERLAY") &&
    (!("localOnly" in entry) || entry.localOnly !== true);
}

/** Only semantic entries with an explicit remote system of record can push. */
export function isRemotePushable(kind: EntityKind): kind is RemotePushableEntityKind {
  const entry = ENTITIES[kind];
  return isSemanticPlanEntity(kind) && "server" in entry && entry.server !== "none";
}

function validateRegistry(): void {
  const cacheNames = new Set<string>(CACHE_STORAGE_NAMES);
  const filePaths = new Set<string>();

  for (const [kind, entry] of Object.entries(ENTITIES)) {
    if (entry.class === "CACHED" && !cacheNames.has(entry.table)) {
      throw new Error(`CACHED entity ${kind} names unknown storage ${entry.table}`);
    }
    if ("file" in entry) {
      if (filePaths.has(entry.file)) {
        throw new Error(`Multiple entities claim file destination ${entry.file}`);
      }
      filePaths.add(entry.file);
    }
    if ("inline" in entry && !Object.hasOwn(ENTITIES, entry.inline)) {
      throw new Error(`Inline entity ${kind} has unknown parent ${entry.inline}`);
    }
    if ("localOnly" in entry && entry.localOnly === true &&
      (!("server" in entry) || entry.server !== "none" || (entry.class !== "VERSIONED" && entry.class !== "OVERLAY"))) {
      throw new Error(`local-only entity ${kind} must be a server:none VERSIONED or OVERLAY entry`);
    }
  }
}

validateRegistry();
