import { createHash } from "node:crypto";
import { isUtf8 } from "node:buffer";
import { z } from "zod";
import {
  documentSchema,
  htmlAnswerSchema,
  parseDocument,
  type Answer,
  type AnswerDocument,
} from "./model.js";

export const PACKAGE_FORMAT = "bb.playground-app/1";
export const RENDERER_VERSION = 2;
export const ASSETS_RENDERER_VERSION = 2;
export const MAX_ASSET_BYTES = 2.5 * 1024 * 1024;
const MAX_ASSET_FILES = 8;
const MAX_ASSET_IMPORTS = 32;
export const MAX_PACKAGE_BYTES = 4 * 1024 * 1024;
const MAX_SCHEMA_DEPTH = 6;

const actionName = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z][\w.-]*$/);
const scalar = z.union([
  z.string().max(200),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);
export type ArgSchema = {
  type:
    | "string"
    | "number"
    | "integer"
    | "boolean"
    | "null"
    | "array"
    | "object"
    | "any";
  description?: string;
  enum?: (string | number | boolean | null)[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  items?: ArgSchema;
  properties?: Record<string, ArgSchema>;
  required?: string[];
  additionalProperties?: boolean;
};
const count = z.number().int().min(0).max(1_000_000);
export const argSchema: z.ZodType<ArgSchema> = z.lazy(() =>
  z
    .object({
      type: z.enum([
        "string",
        "number",
        "integer",
        "boolean",
        "null",
        "array",
        "object",
        "any",
      ]),
      description: z.string().max(400).optional(),
      enum: z.array(scalar).min(1).max(40).optional(),
      minimum: z.number().finite().optional(),
      maximum: z.number().finite().optional(),
      minLength: count.optional(),
      maxLength: count.optional(),
      minItems: count.optional(),
      maxItems: count.optional(),
      items: argSchema.optional(),
      properties: z
        .record(z.string().regex(/^[A-Za-z_][\w-]{0,63}$/), argSchema)
        .refine(
          (value) => Object.keys(value).length <= 40,
          "Too many properties",
        )
        .optional(),
      required: z.array(z.string().max(64)).max(40).optional(),
      additionalProperties: z.boolean().optional(),
    })
    .strict(),
);
const example = z
  .object({
    args: z.array(z.unknown()).max(8),
    note: z.string().max(200).optional(),
  })
  .strict();
const documentedAction = z
  .object({
    name: actionName,
    description: z.string().min(1).max(400),
    args: z.array(argSchema).max(8).default([]),
    required: z.number().int().min(0).max(8).optional(),
    result: argSchema.optional(),
    examples: z.array(example).max(3).optional(),
  })
  .strict();
export const manifestSchema = z.discriminatedUnion("mode", [
  z
    .object({
      mode: z.literal("documented"),
      purpose: z.string().min(1).max(400),
      actions: z.array(documentedAction).min(1).max(30),
    })
    .strict(),
  z.object({ mode: z.literal("manual") }).strict(),
  z.object({ mode: z.literal("undocumented") }).strict(),
]);
export type Manifest = z.infer<typeof manifestSchema>;
export type DocumentedAction = z.infer<typeof documentedAction>;

export const versionLabel = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[\w][\w.+-]*$/);
const author = z
  .object({
    name: z.string().trim().min(1).max(80),
    url: z.string().url().startsWith("https://").max(300).optional(),
  })
  .strict();
const origin = z
  .object({
    kind: z.enum(["remix", "catalog"]),
    appId: z.string().max(100),
    version: versionLabel,
    digest: z.string().regex(/^[0-9a-f]{64}$/),
    title: z.string().max(160),
    author: author.optional(),
    license: z.string().max(64).optional(),
  })
  .strict();
const assetName = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9._-]*\.m?js$/);
const assetFile = z
  .object({
    type: z.literal("text/javascript"),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    bytes: z.number().int().min(1).max(MAX_ASSET_BYTES),
    source: z
      .object({
        package: z.string().min(1).max(100),
        license: z.string().min(1).max(64),
        url: z.string().url().startsWith("https://").max(300).optional(),
      })
      .strict(),
    data: z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/),
  })
  .strict();
export const assetsSchema = z
  .object({
    imports: z
      .record(
        z
          .string()
          .min(1)
          .max(120)
          .regex(/^[A-Za-z@][\w@./-]*$/),
        assetName,
      )
      .refine(
        (value) =>
          Object.keys(value).length >= 1 &&
          Object.keys(value).length <= MAX_ASSET_IMPORTS,
        `Declare 1 to ${MAX_ASSET_IMPORTS} imports.`,
      ),
    files: z
      .record(assetName, assetFile)
      .refine(
        (value) =>
          Object.keys(value).length >= 1 &&
          Object.keys(value).length <= MAX_ASSET_FILES,
        `Include 1 to ${MAX_ASSET_FILES} files.`,
      ),
  })
  .strict();
export type PackageAssets = z.infer<typeof assetsSchema>;
const content = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("html"), playground: htmlAnswerSchema }).strict(),
  z.object({ kind: z.literal("document"), document: z.unknown() }).strict(),
]);
export const packageSchema = z
  .object({
    format: z.literal(PACKAGE_FORMAT),
    version: versionLabel,
    title: z.string().trim().min(1).max(160),
    summary: z.string().max(400).default(""),
    content,
    actions: manifestSchema,
    requires: z
      .object({ renderer: z.number().int().min(1) })
      .strict()
      .refine(
        (value) => value.renderer <= RENDERER_VERSION,
        "This app needs a newer Playgrounds renderer.",
      ),
    author: author.optional(),
    license: z.string().trim().min(1).max(64).optional(),
    origin: origin.optional(),
    assets: assetsSchema.optional(),
  })
  .strict();
export type AppPackage = Omit<z.infer<typeof packageSchema>, "content"> & {
  content:
    | { kind: "html"; playground: z.infer<typeof htmlAnswerSchema> }
    | { kind: "document"; document: AnswerDocument };
};

function schemaDepth(schema: ArgSchema, depth = 1): number {
  const children = [
    ...(schema.items ? [schema.items] : []),
    ...Object.values(schema.properties ?? {}),
  ];
  return Math.max(depth, ...children.map((c) => schemaDepth(c, depth + 1)));
}

export function documentActions(doc: AnswerDocument): Manifest {
  return {
    mode: "documented",
    purpose: `Native playground "${doc.title}". Change its inputs or restore defaults.`,
    actions: [
      {
        name: "set",
        description:
          "Change one or more inputs. Returns the inputs and every metric as displayed.",
        args: [
          {
            type: "object",
            additionalProperties: false,
            properties: Object.fromEntries(
              doc.controls.map((c) => [
                c.id,
                c.type === "select"
                  ? {
                      type: "string" as const,
                      description: c.label,
                      enum: c.options.map((o) => o.value),
                    }
                  : {
                      type: "number" as const,
                      description: `${c.label} (step ${c.step})`,
                      minimum: c.min,
                      maximum: c.max,
                    },
              ]),
            ),
          },
        ],
        required: 1,
      },
      {
        name: "reset",
        description: "Restore every input to its default.",
        args: [],
      },
    ],
  };
}

function checkAssets(assets: PackageAssets, renderer: number) {
  if (renderer < ASSETS_RENDERER_VERSION)
    throw new Error(
      `Packages with assets must require renderer ${ASSETS_RENDERER_VERSION} or newer.`,
    );
  let total = 0;
  for (const [specifier, name] of Object.entries(assets.imports))
    if (!Object.hasOwn(assets.files, name))
      throw new Error(`Import ${specifier} names a missing asset ${name}.`);
  for (const [name, file] of Object.entries(assets.files)) {
    const bytes = Buffer.from(file.data, "base64");
    if (bytes.toString("base64") !== file.data)
      throw new Error(`Asset ${name} is not canonical base64.`);
    if (bytes.byteLength !== file.bytes)
      throw new Error(
        `Asset ${name} is ${bytes.byteLength} bytes, not ${file.bytes}.`,
      );
    if (createHash("sha256").update(bytes).digest("hex") !== file.sha256)
      throw new Error(`Asset ${name} does not match its SHA-256.`);
    if (!isUtf8(bytes)) throw new Error(`Asset ${name} is not UTF-8 text.`);
    total += bytes.byteLength;
  }
  if (total > MAX_ASSET_BYTES)
    throw new Error(
      `Assets are limited to ${MAX_ASSET_BYTES} bytes in total; these are ${total}.`,
    );
}

export function parsePackage(text: string): {
  pkg: AppPackage;
  bytes: number;
} {
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > MAX_PACKAGE_BYTES)
    throw new Error(
      `App packages are limited to ${MAX_PACKAGE_BYTES} bytes; this one is ${bytes}.`,
    );
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("The app package is not valid JSON.");
  }
  const parsed = packageSchema.safeParse(raw);
  if (!parsed.success)
    throw new Error(
      `The app package is invalid: ${parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join(".") || "package"}: ${i.message}`)
        .join("; ")}`,
    );
  const value = parsed.data;
  if (value.assets) checkAssets(value.assets, value.requires.renderer);
  if (value.actions.mode === "documented") {
    const names = new Set<string>();
    for (const action of value.actions.actions) {
      if (names.has(action.name))
        throw new Error(`Duplicate action: ${action.name}`);
      names.add(action.name);
      for (const schema of [
        ...action.args,
        ...(action.result ? [action.result] : []),
      ])
        if (schemaDepth(schema) > MAX_SCHEMA_DEPTH)
          throw new Error(
            `Action ${action.name} has a schema nested too deeply.`,
          );
    }
  }
  const pkg: AppPackage =
    value.content.kind === "document"
      ? {
          ...value,
          content: {
            kind: "document",
            document: parseDocument(JSON.stringify(value.content.document)),
          },
        }
      : { ...value, content: value.content };
  if (pkg.content.kind === "document")
    documentSchema.parse(pkg.content.document);
  return { pkg, bytes };
}

export function serializePackage(pkg: AppPackage): string {
  const text = JSON.stringify(pkg);
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > MAX_PACKAGE_BYTES)
    throw new Error(
      `App packages are limited to ${MAX_PACKAGE_BYTES} bytes; this one is ${bytes}.`,
    );
  return text;
}

export function packageFromAnswer(
  answer: Answer,
  meta: { title: string; summary: string; version: string },
  assets?: PackageAssets | null,
): AppPackage {
  if (answer.kind === "document")
    return {
      format: PACKAGE_FORMAT,
      version: meta.version,
      title: meta.title,
      summary: meta.summary,
      content: { kind: "document", document: answer.document },
      actions: documentActions(answer.document),
      requires: { renderer: 1 },
    };
  return {
    format: PACKAGE_FORMAT,
    version: meta.version,
    title: meta.title,
    summary: meta.summary,
    content: { kind: "html", playground: answer.widget },
    actions: { mode: "undocumented" },
    requires: { renderer: assets ? ASSETS_RENDERER_VERSION : 1 },
    ...(assets ? { assets } : {}),
  };
}

function describeType(value: unknown) {
  return value === null
    ? "null"
    : Array.isArray(value)
      ? "array"
      : typeof value;
}

export function checkArg(
  schema: ArgSchema,
  value: unknown,
  path: string,
): string | null {
  if (schema.enum && !schema.enum.some((option) => option === value))
    return `${path} must be one of ${schema.enum.map((v) => JSON.stringify(v)).join(", ")}.`;
  switch (schema.type) {
    case "any":
      return null;
    case "null":
      return value === null ? null : `${path} must be null.`;
    case "boolean":
      return typeof value === "boolean" ? null : `${path} must be a boolean.`;
    case "string":
      if (typeof value !== "string") return `${path} must be a string.`;
      if (schema.minLength !== undefined && value.length < schema.minLength)
        return `${path} is too short.`;
      if (schema.maxLength !== undefined && value.length > schema.maxLength)
        return `${path} is too long.`;
      return null;
    case "number":
    case "integer":
      if (typeof value !== "number" || !Number.isFinite(value))
        return `${path} must be a number.`;
      if (schema.type === "integer" && !Number.isInteger(value))
        return `${path} must be an integer.`;
      if (schema.minimum !== undefined && value < schema.minimum)
        return `${path} must be at least ${schema.minimum}.`;
      if (schema.maximum !== undefined && value > schema.maximum)
        return `${path} must be at most ${schema.maximum}.`;
      return null;
    case "array": {
      if (!Array.isArray(value)) return `${path} must be an array.`;
      if (schema.minItems !== undefined && value.length < schema.minItems)
        return `${path} needs at least ${schema.minItems} items.`;
      if (schema.maxItems !== undefined && value.length > schema.maxItems)
        return `${path} allows at most ${schema.maxItems} items.`;
      if (!schema.items) return null;
      for (let i = 0; i < value.length; i++) {
        const error = checkArg(schema.items, value[i], `${path}[${i}]`);
        if (error) return error;
      }
      return null;
    }
    case "object": {
      if (!value || typeof value !== "object" || Array.isArray(value))
        return `${path} must be an object, not ${describeType(value)}.`;
      const record = value as Record<string, unknown>;
      for (const key of schema.required ?? [])
        if (!Object.hasOwn(record, key)) return `${path}.${key} is required.`;
      for (const [key, child] of Object.entries(record)) {
        const property = schema.properties?.[key];
        if (!property) {
          if (schema.additionalProperties === false)
            return `${path}.${key} is not a known field.`;
          continue;
        }
        const error = checkArg(property, child, `${path}.${key}`);
        if (error) return error;
      }
      return null;
    }
  }
}

export function checkActionArgs(
  action: DocumentedAction,
  args: unknown[],
): string | null {
  const required = action.required ?? action.args.length;
  if (args.length < required)
    return `${action.name} needs ${required} argument${required === 1 ? "" : "s"}.`;
  if (args.length > action.args.length)
    return `${action.name} takes at most ${action.args.length} argument${action.args.length === 1 ? "" : "s"}.`;
  for (let i = 0; i < args.length; i++) {
    const error = checkArg(action.args[i]!, args[i], `args[${i}]`);
    if (error) return error;
  }
  return null;
}

export function answerFromPackage(
  pkg: AppPackage,
): { kind: "html"; content: string } | { kind: "document"; content: string } {
  return pkg.content.kind === "html"
    ? { kind: "html", content: JSON.stringify(pkg.content.playground) }
    : { kind: "document", content: JSON.stringify(pkg.content.document) };
}
