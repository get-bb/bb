// JSON Schema → per-provider output-format shapes + client-side validation, ported from
// omegacode/src/worker/schema.ts.
//   Codex:  turn/start.outputSchema = <strictified json schema>
//   Claude: options.outputFormat = { type: "json_schema", schema: <json schema> }
// We always re-validate the returned value client-side regardless of provider enforcement.
// Schemas are authored in untyped workflow JS, so their nodes walk as `unknown` (the genuinely
// unknowable boundary); structured output values are @bb/domain JsonValue.

import { Ajv } from "ajv";
import type { ValidateFunction } from "ajv";
import type { JsonObject, JsonValue } from "@bb/domain";
import type { JSONSchema } from "./dsl-types.js";

const ajv = new Ajv({ allErrors: true, strict: false });
const compileCache = new WeakMap<JSONSchema, ValidateFunction>();

function compile(schema: JSONSchema): ValidateFunction {
  const existing = compileCache.get(schema);
  if (existing) return existing;
  const fn = ajv.compile(schema);
  compileCache.set(schema, fn);
  return fn;
}

/**
 * Eagerly compile a schema so author errors (bad $ref, typo'd type) surface at spec resolution
 * instead of after a full paid turn. Throws the ajv compile error verbatim.
 */
export function assertValidSchema(schema: JSONSchema): void {
  compile(schema);
}

export type SchemaValidationResult =
  | { ok: true }
  | { ok: false; errors: string };

export function validate(
  schema: JSONSchema,
  value: unknown,
): SchemaValidationResult {
  const fn = compile(schema);
  if (fn(value)) return { ok: true };
  const errors = (fn.errors ?? [])
    .map(
      (error) =>
        `${error.instancePath || "root"}: ${error.message ?? "invalid"}`,
    )
    .join("; ");
  return { ok: false, errors };
}

/** OpenAI/Codex strict json_schema requires additionalProperties:false + all keys required. */
export function toCodexOutputSchema(schema: JSONSchema): JSONSchema {
  return strictifyObject(schema);
}

export interface ClaudeOutputFormat {
  type: "json_schema";
  schema: JSONSchema;
}

export function toClaudeOutputFormat(schema: JSONSchema): ClaudeOutputFormat {
  return { type: "json_schema", schema };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Valid `required` arrays hold strings; anything else can never match a property name. */
function toStringSet(value: unknown): Set<string> {
  if (!Array.isArray(value)) return new Set();
  const entries: unknown[] = value;
  return new Set(
    entries.filter((entry): entry is string => typeof entry === "string"),
  );
}

/**
 * Recurse a schema node by JSON Schema *keyword*, not by blindly walking every object value. This
 * keeps `properties` (a map of names→schemas, where a key could literally be "properties") and
 * other keyword maps from being treated as schemas themselves. Returns a copy; the input schema is
 * never mutated.
 */
function strictify(node: unknown): unknown {
  if (Array.isArray(node)) {
    const items: unknown[] = node;
    return items.map(strictify);
  }
  if (!isRecord(node)) return node;
  return strictifyObject(node);
}

function strictifyObject(
  node: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    out[key] = strictifyKeyword(key, value);
  }

  const properties = out.properties;
  if (isRecord(properties)) {
    const keys = Object.keys(properties);
    const originalRequired = toStringSet(out.required);
    out.additionalProperties = false;
    // OpenAI strict mode requires EVERY property in `required`. Keep originally-optional
    // properties semantically optional by giving them a real null escape — the model returns
    // `null` to mean "absent" (restored by stripNullOptionals).
    out.required = keys;
    for (const key of keys) {
      if (!originalRequired.has(key))
        properties[key] = makeNullable(properties[key]);
    }
  }
  return out;
}

/** Copy scalars/passthroughs verbatim; recurse only into known schema-bearing positions. */
function strictifyKeyword(key: string, value: unknown): unknown {
  switch (key) {
    // Name→schema maps where keys are data: strictify each member, never the map itself.
    case "properties":
    case "$defs":
    case "definitions":
      return isRecord(value) ? strictifySchemaMap(value) : value;
    case "patternProperties":
      return isRecord(value) ? strictifySchemaMap(value) : strictify(value);
    // Schema-bearing keywords: a single schema, a boolean, or a list of schemas.
    case "items":
    case "additionalProperties":
    case "anyOf":
    case "oneOf":
    case "allOf":
    case "not":
    case "if":
    case "then":
    case "else":
      return strictify(value);
    default:
      return value;
  }
}

function strictifySchemaMap(
  map: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, sub] of Object.entries(map)) out[name] = strictify(sub);
  return out;
}

/**
 * Widen a schema so `null` is an accepted value, regardless of shape:
 *   - typed (`type: "string"` / `["string","number"]`)  → append "null" to the type list
 *   - enum                                               → append null to the enum
 *   - const                                              → wrap in anyOf:[orig, {type:"null"}]
 *   - anyOf/oneOf/$ref/typeless/other                    → wrap in anyOf:[orig, {type:"null"}]
 */
function makeNullable(schema: unknown): unknown {
  // Bare scalar or tuple schema (rare) — wrap it.
  if (!isRecord(schema)) return { anyOf: [schema, { type: "null" }] };

  const type = schema.type;
  if (typeof type === "string") {
    if (type === "null") return schema;
    return withNullEnumMember({ ...schema, type: [type, "null"] });
  }
  if (Array.isArray(type)) {
    const types: unknown[] = type;
    return withNullEnumMember(
      types.includes("null")
        ? { ...schema }
        : { ...schema, type: [...types, "null"] },
    );
  }
  // Typeless: an enum without a type still gets a null member.
  if (Array.isArray(schema.enum)) return withNullEnumMember({ ...schema });
  // const / $ref / anyOf / oneOf / allOf / typeless object → wrap so null is a valid alternative.
  return { anyOf: [schema, { type: "null" }] };
}

/** Append null to a copy of `node`'s enum when it declares an enum lacking one. */
function withNullEnumMember(
  node: Record<string, unknown>,
): Record<string, unknown> {
  if (!Array.isArray(node.enum)) return node;
  const members: unknown[] = node.enum;
  if (members.includes(null)) return node;
  return { ...node, enum: [...members, null] };
}

/**
 * Normalize structured output before validation: drop `null` values for properties that are NOT
 * required AND whose author schema does NOT itself permit null. Codex's strict `outputSchema`
 * forces every key to be present, so we express optional fields as nullable — the model returns
 * `null` to mean "absent". This restores that semantics so the value validates against the
 * author's original (optional) schema, while preserving author-declared explicit nulls. Harmless
 * for Claude.
 */
export function stripNullOptionals(
  value: JsonValue,
  schema: JSONSchema,
): JsonValue {
  if (Array.isArray(value)) {
    const itemSchema = isRecord(schema.items) ? schema.items : {};
    return value.map((item) => stripNullOptionals(item, itemSchema));
  }
  if (!isRecord(value)) return value;
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const required = toStringSet(schema.required);
  const out: JsonObject = {};
  for (const [key, propValue] of Object.entries(value)) {
    const propSchema = properties[key];
    // Only treat null as "absent" when the field is optional AND the author didn't declare it
    // nullable. A field the author made nullable keeps its explicit null.
    if (propValue === null && !required.has(key) && !allowsNull(propSchema))
      continue;
    out[key] = stripNullOptionals(
      propValue,
      isRecord(propSchema) ? propSchema : {},
    );
  }
  return out;
}

/** Does the author's original schema permit a literal null at this node? */
function allowsNull(schema: unknown): boolean {
  if (!isRecord(schema)) return false;
  if (schema.type === "null") return true;
  if (Array.isArray(schema.type) && schema.type.includes("null")) return true;
  if (Array.isArray(schema.enum) && schema.enum.includes(null)) return true;
  for (const key of ["anyOf", "oneOf", "allOf"]) {
    const branch = schema[key];
    if (Array.isArray(branch) && branch.some((member) => allowsNull(member)))
      return true;
  }
  return false;
}

/** Best-effort: parse a model's text output as JSON (handles ```json fences and prose prefixes). */
export function parseJsonLoose(text: string): JsonValue {
  const trimmed = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
  const candidate = fence?.[1] ?? trimmed;
  // JSON.parse is typed `any`, but its output is JsonValue by construction.
  const parsed: JsonValue = JSON.parse(candidate);
  return parsed;
}
