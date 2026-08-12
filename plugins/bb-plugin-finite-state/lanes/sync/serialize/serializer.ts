import { ENTITIES, type EntityKind } from "../../../lib/sync/registry.js";
import { contentHash as canonicalContentHash } from "./canonical.js";
import { serverOwnedFields } from "./exclusions.js";
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
  contentHash(payload: Record<string, unknown>): string;
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

const IDENTIFIER_FIELD = /(?:^id$|_id$|_ids$)/u;
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu;

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

function isIdentifierField(key: string): boolean {
  return IDENTIFIER_FIELD.test(key) || key === "edges" || key === "zones_traversed";
}

function replaceReferences(
  value: unknown,
  context: ReplacementContext,
  identifierContext: boolean,
  path: string,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item, index) => replaceReferences(
      item,
      context,
      identifierContext && typeof item === "string",
      `${path}[${index}]`,
    ));
  }
  if (typeof value === "object" && value !== null) {
    const entries: Array<[string, unknown]> = [];
    for (const [key, item] of Object.entries(value)) {
      entries.push([key, replaceReferences(
        item,
        context,
        identifierContext || isIdentifierField(key),
        `${path}[${JSON.stringify(key)}]`,
      )]);
    }
    return Object.fromEntries(entries);
  }
  if (identifierContext && typeof value === "string") {
    const replacement = context.resolve(value);
    if (replacement !== null) {
      return replacement;
    }
    if (UUID.test(value)) {
      context.warn({ code: "UNRESOLVED_ID", remoteId: value, path });
    }
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
  return buildSemanticPayload(entityType, raw, idReplacements, true);
}

function buildSemanticPayload(
  entityType: string,
  raw: Record<string, unknown>,
  idReplacements: IdReplacements,
  stripServerOwned: boolean,
): Record<string, unknown> {
  const excluded = stripServerOwned ? serverOwnedFields(serverEntityType(entityType)) : new Set<string>();
  const entries: Array<[string, unknown]> = [];
  for (const [key, value] of Object.entries(raw)) {
    if (!excluded.has(key)) {
      entries.push([key, value]);
    }
  }
  const stripped = Object.fromEntries(entries);
  const replaced = replaceReferences(stripped, replacementContext(idReplacements), false, "$");
  if (!isRecord(replaced)) {
    throw new Error("Semantic payload replacement must preserve the root object");
  }
  return replaced;
}

function assertYamlEntity(kind: EntityKind): void {
  const entry = ENTITIES[kind];
  if ((entry.class !== "VERSIONED" && entry.class !== "OVERLAY") || kind === "canvasLayout") {
    throw new UnsupportedEntitySerializerError(kind);
  }
}

export function createSerializer(kind: EntityKind): EntitySerializer {
  assertYamlEntity(kind);
  const entry = ENTITIES[kind];
  const entityType = serverEntityType(kind);
  const stripServerOwned = "server" in entry && entry.server !== "none";

  return {
    entityKind: kind,
    semanticPayload(raw) {
      return buildSemanticPayload(entityType, raw, {}, stripServerOwned);
    },
    toYaml(payload, opts) {
      return emitYaml(buildSemanticPayload(entityType, payload, opts, stripServerOwned));
    },
    fromYaml(text, file) {
      return parseYaml(text, file);
    },
    contentHash(payload) {
      return canonicalContentHash(buildSemanticPayload(entityType, payload, {}, stripServerOwned));
    },
  };
}
