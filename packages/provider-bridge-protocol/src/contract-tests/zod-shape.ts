import type { z } from "zod";

type ZodDef = z.core.$ZodTypeDef;
type HandledZodType =
  | "object"
  | "union"
  | "intersection"
  | "array"
  | "record"
  | "tuple"
  | "pipe"
  | "literal"
  | "lazy"
  | "optional"
  | "nullable"
  | "default"
  | "readonly"
  | "nonoptional";

type ZodDefinition =
  | {
      type: "object";
      ["shape"]: Readonly<Record<string, z.ZodType>>;
    }
  | { type: "union"; options: readonly z.ZodType[] }
  | { type: "intersection"; left: z.ZodType; right: z.ZodType }
  | { type: "array"; element: z.ZodType }
  | { type: "record"; valueType: z.ZodType }
  | { type: "tuple"; items: readonly z.ZodType[] }
  | { type: "pipe"; in: z.ZodType; out: z.ZodType }
  | { type: "literal"; values: z.core.util.Literal[] }
  | { type: "lazy"; getter: () => z.ZodType }
  | {
      type: "optional" | "nullable" | "default" | "readonly" | "nonoptional";
      innerType: z.ZodType;
    }
  | { type: Exclude<ZodDef["type"], HandledZodType> };

function defOf(schema: z.ZodType): ZodDefinition {
  // SAFETY: Zod's definition discriminator matches the fields that Zod stores for each definition.
  return schema._zod.def as ZodDefinition;
}

type ZodChildKey =
  | "innerType"
  | "left"
  | "right"
  | "element"
  | "valueType"
  | "in"
  | "out";

function zodChild(def: ZodDefinition, key: ZodChildKey): z.ZodType | undefined {
  if (key === "innerType" && "innerType" in def) return def.innerType;
  if (key === "left" && "left" in def) return def.left;
  if (key === "right" && "right" in def) return def.right;
  if (key === "element" && "element" in def) return def.element;
  if (key === "valueType" && "valueType" in def) return def.valueType;
  if (key === "in" && "in" in def) return def.in;
  if (key === "out" && "out" in def) return def.out;
  return undefined;
}

function zodChildren(
  def: ZodDefinition,
  key: "options" | "items",
): z.ZodType[] {
  if (key === "options" && def.type === "union") return [...def.options];
  if (key === "items" && def.type === "tuple") return [...def.items];
  return [];
}

function readObjectFields(
  def: ZodDefinition,
): Record<string, z.ZodType> | undefined {
  if (def.type !== "object") return undefined;
  return Object.fromEntries(Object.entries(def["shape"]));
}

function zodObjectFieldMap(schema: z.ZodType): Record<string, z.ZodType> {
  const def = defOf(schema);
  return readObjectFields(def) ?? {};
}

export { zodObjectFieldMap as "zodObjectShape" };

export type ZodFieldPresence = "required" | "optional" | "default";

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

export function zodObjectFields(
  schema: z.ZodType,
): Record<string, ZodFieldPresence> {
  const def = defOf(schema);
  switch (def.type) {
    case "object": {
      const fields = readObjectFields(def) ?? {};
      return Object.fromEntries(
        Object.entries(fields).map(([key, field]) => [
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
      return zodObjectFields(def.getter());
    }
    default:
      return {};
  }
}

export function zodUnionOptions(schema: z.ZodType): z.ZodType[] {
  const def = defOf(schema);
  if (def.type === "union") return zodChildren(def, "options");
  return [schema];
}

export function zodLiteralValue(
  schema: z.ZodType,
): z.core.util.Literal | undefined {
  const def = defOf(schema);
  if (def.type !== "literal") return undefined;
  return def.values[0];
}

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
        const fields = readObjectFields(def) ?? {};
        for (const [key, field] of Object.entries(fields)) {
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
        visit(def.getter(), path);
        return;
      }
      default:
        return;
    }
  }

  visit(schema, rootName);
  return [...out].sort();
}
