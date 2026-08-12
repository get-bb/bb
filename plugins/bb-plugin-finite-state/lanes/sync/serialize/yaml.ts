import { parseDocument, stringify } from "yaml";

import { canonicalJson } from "./canonical.js";

export class SerializeError extends Error {
  constructor(
    readonly file: string,
    readonly line: number | null,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "SerializeError";
  }
}

const IDENTITY_FIELDS = new Set([
  "code",
  "componentSlug",
  "component_slug",
  "key",
  "reqId",
  "req_id",
  "routeSignature",
  "route_signature",
  "slug",
]);

const RELATION_FIELD = /(?:^id$|_id$|_ids$|Id$|Ids$)/u;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function fieldGroup(key: string): number {
  if (IDENTITY_FIELDS.has(key)) {
    return 0;
  }
  if (RELATION_FIELD.test(key) || key === "edges" || key === "zones_traversed" || key === "zonesTraversed") {
    return 2;
  }
  return 1;
}

function compareFields(left: string, right: string): number {
  return fieldGroup(left) - fieldGroup(right) || compareText(left, right);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function orderFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => orderFields(item));
  }
  if (!isPlainRecord(value)) {
    return value;
  }

  const entries: Array<[string, unknown]> = [];
  for (const key of Object.keys(value).sort(compareFields)) {
    if (value[key] !== undefined) {
      entries.push([key, orderFields(value[key])]);
    }
  }
  return Object.fromEntries(entries);
}

function errorLine(error: unknown): number | null {
  if (typeof error !== "object" || error === null || !("linePos" in error)) {
    return null;
  }
  const linePositions = error.linePos;
  if (!Array.isArray(linePositions)) {
    return null;
  }
  const first = linePositions[0];
  if (typeof first !== "object" || first === null || !("line" in first) || typeof first.line !== "number") {
    return null;
  }
  return first.line;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function emitYaml(value: Record<string, unknown>): string {
  canonicalJson(value);
  return stringify(orderFields(value), {
    aliasDuplicateObjects: false,
    collectionStyle: "block",
    indent: 2,
    lineWidth: 0,
  });
}

export function parseYaml(text: string, file: string): Record<string, unknown> {
  try {
    const document = parseDocument(text, {
      prettyErrors: true,
      uniqueKeys: true,
    });
    const parseError = document.errors[0];
    if (parseError) {
      throw new SerializeError(file, errorLine(parseError), parseError.message, { cause: parseError });
    }

    const value: unknown = document.toJS({ mapAsMap: false, maxAliasCount: 0 });
    if (!isPlainRecord(value)) {
      throw new SerializeError(file, text.length === 0 ? null : 1, "YAML document root must be a mapping");
    }
    return value;
  } catch (error) {
    if (error instanceof SerializeError) {
      throw error;
    }
    throw new SerializeError(file, errorLine(error), errorMessage(error), { cause: error });
  }
}
