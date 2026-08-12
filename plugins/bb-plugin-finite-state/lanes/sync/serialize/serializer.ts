import { ENTITIES, type EntityKind, type KeyFn } from "../../../lib/sync/registry.js";
import { contentHash as canonicalContentHash } from "./canonical.js";
import { isServerOwnedField } from "./exclusions.js";
import { emitYaml, parseYaml } from "./yaml.js";

export interface SerializeWarning {
  code: "UNRESOLVED_ID";
  remoteId: string;
  path: string;
}

export interface SerializeOptions {
  idToSlug(remoteId: string): string | null;
  onWarning?(warning: SerializeWarning): void;
}

export interface EntitySerializer<T = Record<string, unknown>> {
  entityKind: EntityKind;
  semanticPayload(raw: Record<string, unknown>): Record<string, unknown>;
  toYaml(payload: T, opts: SerializeOptions): string;
  fromYaml(text: string, file: string): T;
  contentHash(payload: Record<string, unknown>, opts: SerializeOptions): string;
}

export type IdReplacements =
  | Readonly<Record<string, string>>
  | SerializeOptions["idToSlug"]
  | SerializeOptions;

export class UnsupportedEntitySerializerError extends Error {
  constructor(readonly entityKind: EntityKind) {
    super(`Entity kind ${entityKind} is not represented as entity YAML`);
    this.name = "UnsupportedEntitySerializerError";
  }
}

export class InvalidEntityEnvelopeError extends Error {
  constructor(
    readonly entityType: string,
    readonly reason: string,
  ) {
    super(`Invalid Assurance Studio envelope for ${entityType}: ${reason}`);
    this.name = "InvalidEntityEnvelopeError";
  }
}

const IDENTIFIER_FIELD = /(?:^id$|_id$|_ids$|Id$|Ids$)/u;
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu;
const DECIMAL_TOKEN = /^[0-9]+$/u;
const AS_ENVELOPE_KEYS = new Set([
  "fields",
  "humanEdited",
  "id",
  "kind",
  "projectId",
  "reviewStatus",
  "reviewVersion",
]);
const AS_ENVELOPE_MARKERS = ["humanEdited", "projectId", "reviewStatus", "reviewVersion"] as const;
const AS_ENTITY_KINDS = new Set([
  "asset",
  "attack-path",
  "component",
  "dataflow",
  "mitigation",
  "requirement",
  "risk",
  "threat",
  "zone",
]);
const AS_REVIEW_STATUSES = new Set([
  "ai_approved",
  "ai_flagged",
  "human_approved",
  "human_rejected",
  "pending",
]);

type EntityService = "assurance-studio" | "none" | "platform";
type RegistryKeyedYamlEntityKind = {
  [K in EntityKind]: (typeof ENTITIES)[K] extends {
    readonly class: "VERSIONED" | "OVERLAY";
    readonly key: KeyFn;
  } ? K : never;
}[EntityKind];

const REGISTRY_KEY_FIELDS = {
  asset: ["slug"],
  attackPath: ["routeSignature"],
  checkParams: ["code"],
  component: ["slug"],
  dataflow: ["slug"],
  firmwareLink: ["componentSlug"],
  hbomPart: ["id"],
  mitigation: ["slug"],
  reqCheckMap: ["reqId"],
  requirement: ["reqId"],
  sbomLink: ["componentSlug"],
  threat: ["slug"],
  vexDecision: ["cve", "purl", "name", "group", "version"],
  zone: ["slug"],
} as const satisfies Readonly<Record<RegistryKeyedYamlEntityKind, readonly string[]>>;

interface ReplacementContext {
  resolve(remoteId: string): string | null;
  warn(warning: SerializeWarning): void;
}

function defaultWarning(warning: SerializeWarning): void {
  process.emitWarning(`Keeping unresolved remote ID ${warning.remoteId} at ${warning.path}`, {
    code: warning.code,
    type: "SerializeWarning",
  });
}

function replacementContext(idReplacements: IdReplacements): ReplacementContext {
  if (typeof idReplacements === "function") {
    return { resolve: idReplacements, warn: defaultWarning };
  }
  if ("idToSlug" in idReplacements && typeof idReplacements.idToSlug === "function") {
    const onWarning = idReplacements.onWarning;
    return {
      resolve: idReplacements.idToSlug,
      warn: typeof onWarning === "function" ? onWarning : defaultWarning,
    };
  }
  const replacements = new Map(
    Object.entries(idReplacements).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  return {
    resolve: (remoteId) => replacements.get(remoteId) ?? null,
    warn: () => undefined,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonValue(value: unknown): boolean {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every((item) => isJsonValue(item));
  }
  return isRecord(value) && Object.values(value).every((item) => isJsonValue(item));
}

function isIdentifierField(key: string): boolean {
  return IDENTIFIER_FIELD.test(key)
    || key === "zones_traversed"
    || key === "zonesTraversed";
}

function expectedAsEntityKind(entityType: string): string | null {
  switch (serverEntityType(entityType)) {
    case "asset":
    case "component":
    case "dataflow":
    case "mitigation":
    case "requirement":
    case "threat":
    case "zone":
      return serverEntityType(entityType);
    case "attack_path":
      return "attack-path";
    default:
      return null;
  }
}

function hasAsEnvelopeMarker(value: Record<string, unknown>): boolean {
  return AS_ENVELOPE_MARKERS.some((key) => Object.hasOwn(value, key));
}

function invalidEnvelope(entityType: string, reason: string): never {
  throw new InvalidEntityEnvelopeError(entityType, reason);
}

function authoredPayload(
  entityType: string,
  raw: Record<string, unknown>,
  service: EntityService | null,
  requireEnvelope: boolean,
): Record<string, unknown> {
  if (service !== "assurance-studio") {
    return raw;
  }

  if (!requireEnvelope && !hasAsEnvelopeMarker(raw)) {
    return raw;
  }

  for (const key of AS_ENVELOPE_KEYS) {
    if (!Object.hasOwn(raw, key)) {
      invalidEnvelope(entityType, `missing ${key}`);
    }
  }
  const unexpectedKey = Object.keys(raw).find((key) => !AS_ENVELOPE_KEYS.has(key));
  if (unexpectedKey !== undefined) {
    invalidEnvelope(entityType, `unexpected ${unexpectedKey}`);
  }

  if (typeof raw["id"] !== "string") {
    invalidEnvelope(entityType, "id must be a string");
  }
  if (typeof raw["projectId"] !== "string") {
    invalidEnvelope(entityType, "projectId must be a string");
  }
  const kind = raw["kind"];
  if (typeof kind !== "string" || !AS_ENTITY_KINDS.has(kind)) {
    invalidEnvelope(entityType, "kind is not a frozen AsEntityKind");
  }
  const expectedKind = expectedAsEntityKind(entityType);
  if (expectedKind !== null && kind !== expectedKind) {
    invalidEnvelope(entityType, `kind ${kind} does not match ${expectedKind}`);
  }
  const reviewVersion = raw["reviewVersion"];
  if (reviewVersion !== null && (typeof reviewVersion !== "string" || !DECIMAL_TOKEN.test(reviewVersion))) {
    invalidEnvelope(entityType, "reviewVersion must be a decimal string or null");
  }
  const reviewStatus = raw["reviewStatus"];
  if (reviewStatus !== null && (typeof reviewStatus !== "string" || !AS_REVIEW_STATUSES.has(reviewStatus))) {
    invalidEnvelope(entityType, "reviewStatus is not a frozen AsReviewStatus or null");
  }
  const humanEdited = raw["humanEdited"];
  if (humanEdited !== null && typeof humanEdited !== "boolean") {
    invalidEnvelope(entityType, "humanEdited must be a boolean or null");
  }
  const fields = raw["fields"];
  if (!isRecord(fields) || !Object.values(fields).every((value) => isJsonValue(value))) {
    invalidEnvelope(entityType, "fields must be a JSON object");
  }
  return fields;
}

function replaceReferenceValue(
  value: unknown,
  context: ReplacementContext,
  path: string,
): unknown {
  if (typeof value === "string") {
    const replacement = context.resolve(value);
    if (replacement !== null) {
      return replacement;
    }
    if (UUID.test(value)) {
      context.warn({ code: "UNRESOLVED_ID", remoteId: value, path });
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => replaceReferenceValue(
      item,
      context,
      `${path}[${index}]`,
    ));
  }
  return replaceReferences(value, context, path);
}

function replaceEdgeReferences(
  value: unknown,
  context: ReplacementContext,
  path: string,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item, index) => replaceEdgeReferences(item, context, `${path}[${index}]`));
  }
  if (isRecord(value)) {
    const entries: Array<[string, unknown]> = [];
    for (const [key, item] of Object.entries(value)) {
      const childPath = `${path}[${JSON.stringify(key)}]`;
      const replaced = key === "from" || key === "to" || isIdentifierField(key)
        ? replaceReferenceValue(item, context, childPath)
        : replaceReferences(item, context, childPath);
      entries.push([key, replaced]);
    }
    return Object.fromEntries(entries);
  }
  return replaceReferenceValue(value, context, path);
}

function replaceReferences(
  value: unknown,
  context: ReplacementContext,
  path: string,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item, index) => replaceReferences(item, context, `${path}[${index}]`));
  }
  if (isRecord(value)) {
    const entries: Array<[string, unknown]> = [];
    for (const [key, item] of Object.entries(value)) {
      const childPath = `${path}[${JSON.stringify(key)}]`;
      const replaced = key === "edges"
        ? replaceEdgeReferences(item, context, childPath)
        : isIdentifierField(key)
          ? replaceReferenceValue(item, context, childPath)
          : replaceReferences(item, context, childPath);
      entries.push([key, replaced]);
    }
    return Object.fromEntries(entries);
  }
  return value;
}

function serverEntityType(entityType: string): string {
  return entityType
    .replaceAll("-", "_")
    .replace(/([a-z0-9])([A-Z])/gu, "$1_$2")
    .toLowerCase();
}

export function semanticPayload(
  entityType: string,
  raw: Record<string, unknown>,
  idReplacements: IdReplacements = {},
): Record<string, unknown> {
  const service = entityService(entityType);
  return buildSemanticPayload(entityType, raw, idReplacements, true, service, service === "assurance-studio");
}

function entityService(entityType: string): EntityService | null {
  const normalizedType = serverEntityType(entityType);
  const entry = Object.entries(ENTITIES)
    .find(([kind]) => serverEntityType(kind) === normalizedType)?.[1];
  return entry !== undefined && "server" in entry ? entry.server : null;
}

function buildSemanticPayload(
  entityType: string,
  raw: Record<string, unknown>,
  idReplacements: IdReplacements,
  stripServerOwned: boolean,
  service: EntityService | null,
  requireEnvelope: boolean,
  preservedFields: ReadonlySet<string> = new Set(),
): Record<string, unknown> {
  const normalizedType = serverEntityType(entityType);
  const payload = authoredPayload(entityType, raw, service, requireEnvelope);
  const entries: Array<[string, unknown]> = [];
  for (const [key, value] of Object.entries(payload)) {
    if (preservedFields.has(key) || !stripServerOwned || !isServerOwnedField(normalizedType, key)) {
      entries.push([key, value]);
    }
  }
  const stripped = Object.fromEntries(entries);
  const replaced = replaceReferences(stripped, replacementContext(idReplacements), "$");
  if (!isRecord(replaced)) {
    throw new Error("Semantic payload replacement must preserve the root object");
  }
  return Object.fromEntries(Object.entries(replaced).map(([key, value]) => [
    key,
    preservedFields.has(key) ? payload[key] : value,
  ]));
}

function assertYamlEntity(kind: EntityKind): asserts kind is keyof typeof REGISTRY_KEY_FIELDS {
  const entry = ENTITIES[kind];
  if (
    (entry.class !== "VERSIONED" && entry.class !== "OVERLAY")
    || !Object.hasOwn(REGISTRY_KEY_FIELDS, kind)
  ) {
    throw new UnsupportedEntitySerializerError(kind);
  }
}

export function createSerializer(kind: EntityKind): EntitySerializer {
  assertYamlEntity(kind);
  const entry = ENTITIES[kind];
  const entityType = serverEntityType(kind);
  const stripServerOwned = "server" in entry && entry.server !== "none";
  const service = "server" in entry ? entry.server : null;
  const registryKeyFields = new Set(REGISTRY_KEY_FIELDS[kind]);

  return {
    entityKind: kind,
    semanticPayload(raw) {
      return buildSemanticPayload(entityType, raw, {}, stripServerOwned, service, service === "assurance-studio");
    },
    toYaml(payload, opts) {
      return emitYaml(buildSemanticPayload(
        entityType,
        payload,
        opts,
        stripServerOwned,
        service,
        false,
        registryKeyFields,
      ));
    },
    fromYaml(text, file) {
      return parseYaml(text, file);
    },
    contentHash(payload, opts) {
      return canonicalContentHash(buildSemanticPayload(
        entityType,
        payload,
        opts,
        stripServerOwned,
        service,
        false,
        registryKeyFields,
      ));
    },
  };
}
