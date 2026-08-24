/**
 * Test-only structural introspection over zod 4 schemas, for the contract
 * guardrail tests (grammar snapshot, contract purity). Walks the schema
 * definition tree through objects, unions, intersections, wrappers, arrays,
 * records, tuples, pipes and lazies; nothing here runs at product time.
 *
 * Zod's internal definition objects are typed per class, so this reads them
 * through `Reflect.get` with runtime checks — the one place an unknown-shaped
 * value is acceptable, because the library is the boundary.
 */
import type { z } from "zod";

type ZodDef = z.core.$ZodTypeDef;

function defOf(schema: z.ZodType): ZodDef {
  return schema._zod.def;
}

function isZodType(value: unknown): value is z.ZodType {
  return (
    typeof value === "object" &&
    value !== null &&
    "_zod" in value &&
    typeof (value as { _zod?: unknown })._zod === "object"
  );
}

function zodChild(def: ZodDef, key: string): z.ZodType | undefined {
  const value = Reflect.get(def, key);
  return isZodType(value) ? value : undefined;
}

function zodChildren(def: ZodDef, key: string): z.ZodType[] {
  const value = Reflect.get(def, key);
  if (!Array.isArray(value)) return [];
  return value.filter(isZodType);
}

function zodShape(def: ZodDef): Record<string, z.ZodType> | undefined {
  const shape = Reflect.get(def, "shape");
  if (typeof shape !== "object" || shape === null) return undefined;
  const entries = Object.entries(shape).filter(
    (entry): entry is [string, z.ZodType] => isZodType(entry[1]),
  );
  return Object.fromEntries(entries);
}

/** The field schemas of an object schema (empty for non-objects). */
export function zodObjectShape(schema: z.ZodType): Record<string, z.ZodType> {
  const def = defOf(schema);
  return def.type === "object" ? (zodShape(def) ?? {}) : {};
}

export type ZodFieldPresence = "required" | "optional" | "default";

/** Whether a field accepts omission, and whether omission fills a default. */
export function zodFieldPresence(schema: z.ZodType): ZodFieldPresence {
  const type = defOf(schema).type;
  if (type === "default") return "default";
  if (type === "optional") return "optional";
  if (type === "nullable") {
    const inner = zodChild(defOf(schema), "innerType");
    return inner ? zodFieldPresence(inner) : "required";
  }
  return "required";
}

/**
 * Field name → presence for one object schema. Wrappers (optional, nullable,
 * default, pipe) are looked through to find the object; a non-object schema
 * yields no fields.
 */
export function zodObjectFields(
  schema: z.ZodType,
): Record<string, ZodFieldPresence> {
  const def = defOf(schema);
  switch (def.type) {
    case "object": {
      const shape = zodShape(def) ?? {};
      return Object.fromEntries(
        Object.entries(shape).map(([key, field]) => [
          key,
          zodFieldPresence(field),
        ]),
      );
    }
    case "optional":
    case "nullable":
    case "default":
    case "readonly": {
      const inner = zodChild(def, "innerType");
      return inner ? zodObjectFields(inner) : {};
    }
    case "pipe": {
      const out = zodChild(def, "out");
      return out ? zodObjectFields(out) : {};
    }
    case "lazy": {
      const getter = Reflect.get(def, "getter");
      const inner = typeof getter === "function" ? getter() : undefined;
      return isZodType(inner) ? zodObjectFields(inner) : {};
    }
    default:
      return {};
  }
}

/** The `options` of a union, or the schema itself when it is not a union. */
export function zodUnionOptions(schema: z.ZodType): z.ZodType[] {
  const def = defOf(schema);
  if (def.type === "union") return zodChildren(def, "options");
  return [schema];
}

/** Literal value of a `z.literal()` field, when the schema is one. */
export function zodLiteralValue(schema: z.ZodType): unknown {
  const def = defOf(schema);
  if (def.type !== "literal") return undefined;
  const values = Reflect.get(def, "values");
  return Array.isArray(values) ? values[0] : undefined;
}

/**
 * Every object key reachable anywhere in the schema tree, as
 * `"<path>.<key>"` entries rooted at `rootName`. Lazies are entered once
 * (recursive JSON values terminate), so the walk always ends.
 */
export function collectZodKeyPaths(
  schema: z.ZodType,
  rootName: string,
): string[] {
  const out = new Set<string>();
  const enteredLazies = new Set<ZodDef>();

  function visit(current: z.ZodType, path: string): void {
    const def = defOf(current);
    switch (def.type) {
      case "object": {
        const shape = zodShape(def) ?? {};
        for (const [key, field] of Object.entries(shape)) {
          out.add(`${path}.${key}`);
          visit(field, `${path}.${key}`);
        }
        return;
      }
      case "union":
        for (const option of zodChildren(def, "options")) visit(option, path);
        return;
      case "intersection": {
        const left = zodChild(def, "left");
        const right = zodChild(def, "right");
        if (left) visit(left, path);
        if (right) visit(right, path);
        return;
      }
      case "optional":
      case "nullable":
      case "default":
      case "readonly":
      case "nonoptional": {
        const inner = zodChild(def, "innerType");
        if (inner) visit(inner, path);
        return;
      }
      case "array": {
        const element = zodChild(def, "element");
        if (element) visit(element, `${path}[]`);
        return;
      }
      case "record": {
        const valueType = zodChild(def, "valueType");
        if (valueType) visit(valueType, `${path}[*]`);
        return;
      }
      case "tuple":
        for (const item of zodChildren(def, "items")) visit(item, `${path}[]`);
        return;
      case "pipe": {
        const input = zodChild(def, "in");
        const output = zodChild(def, "out");
        if (input) visit(input, path);
        if (output) visit(output, path);
        return;
      }
      case "lazy": {
        if (enteredLazies.has(def)) return;
        enteredLazies.add(def);
        const getter = Reflect.get(def, "getter");
        const inner = typeof getter === "function" ? getter() : undefined;
        if (isZodType(inner)) visit(inner, path);
        return;
      }
      default:
        return;
    }
  }

  visit(schema, rootName);
  return [...out].sort();
}
