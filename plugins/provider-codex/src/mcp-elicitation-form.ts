import { z } from "zod";

const stringFormatSchema = z.enum(["email", "uri", "date", "date-time"]);
const optionSchema = z.strictObject({ value: z.string(), label: z.string() });
const fieldBase = {
  name: z.string().refine((name) => name !== "__proto__", {
    message: 'The field name "__proto__" is not supported.',
  }),
  title: z.string(),
  description: z.string().nullable(),
  required: z.boolean(),
};

export const codexMcpFormFieldSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...fieldBase,
    kind: z.literal("string"),
    defaultValue: z.string().nullable(),
    minLength: z.number().int().nonnegative().nullable(),
    maxLength: z.number().int().nonnegative().nullable(),
    format: stringFormatSchema.nullable(),
  }),
  z.strictObject({
    ...fieldBase,
    kind: z.enum(["number", "integer"]),
    defaultValue: z.number().nullable(),
    minimum: z.number().nullable(),
    maximum: z.number().nullable(),
  }),
  z.strictObject({
    ...fieldBase,
    kind: z.literal("boolean"),
    defaultValue: z.boolean().nullable(),
  }),
  z.strictObject({
    ...fieldBase,
    kind: z.literal("enum"),
    options: z.array(optionSchema).min(1),
    defaultValue: z.string().nullable(),
  }),
  z.strictObject({
    ...fieldBase,
    kind: z.literal("multi_enum"),
    options: z.array(optionSchema).min(1),
    defaultValue: z.array(z.string()).nullable(),
    minItems: z.number().int().nonnegative().nullable(),
    maxItems: z.number().int().nonnegative().nullable(),
  }),
]);
export type CodexMcpFormField = z.infer<typeof codexMcpFormFieldSchema>;

const safeDictionarySchema = z
  .unknown()
  .refine(
    (value) =>
      value === null ||
      typeof value !== "object" ||
      !Object.hasOwn(value, "__proto__"),
    { message: 'The field name "__proto__" is not supported.' },
  );

export const codexMcpFormContentSchema = safeDictionarySchema.pipe(
  z.record(
    z.string(),
    z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]),
  ),
);
export type CodexMcpFormContent = z.infer<typeof codexMcpFormContentSchema>;

const nativeBase = {
  title: z.string().optional(),
  description: z.string().optional(),
};
const nativeOptionSchema = z.strictObject({
  const: z.string(),
  title: z.string(),
});
const nativeOptionsSchema = z.array(nativeOptionSchema).min(1);
const nativeEnumSchema = z.array(z.string()).min(1);
const nativeFieldSchema = z.union([
  z.strictObject({
    ...nativeBase,
    type: z.literal("string"),
    enum: nativeEnumSchema,
    enumNames: z.array(z.string()).optional(),
    default: z.string().optional(),
  }),
  z.strictObject({
    ...nativeBase,
    type: z.literal("string"),
    oneOf: nativeOptionsSchema,
    default: z.string().optional(),
  }),
  z.strictObject({
    ...nativeBase,
    type: z.literal("string"),
    minLength: z.number().int().nonnegative().optional(),
    maxLength: z.number().int().nonnegative().optional(),
    format: stringFormatSchema.optional(),
    default: z.string().optional(),
  }),
  z.strictObject({
    ...nativeBase,
    type: z.enum(["number", "integer"]),
    minimum: z.number().optional(),
    maximum: z.number().optional(),
    default: z.number().optional(),
  }),
  z.strictObject({
    ...nativeBase,
    type: z.literal("boolean"),
    default: z.boolean().optional(),
  }),
  z.strictObject({
    ...nativeBase,
    type: z.literal("array"),
    minItems: z.number().int().nonnegative().optional(),
    maxItems: z.number().int().nonnegative().optional(),
    items: z.union([
      z.strictObject({ type: z.literal("string"), enum: nativeEnumSchema }),
      z.strictObject({ anyOf: nativeOptionsSchema }),
    ]),
    default: z.array(z.string()).optional(),
  }),
]);
const nativeFormSchema = z.strictObject({
  $schema: z.string().optional(),
  type: z.literal("object"),
  properties: safeDictionarySchema.pipe(
    z.record(z.string(), nativeFieldSchema),
  ),
  required: z.array(z.string()).optional(),
});

function validateFieldValue(
  field: CodexMcpFormField,
  value: CodexMcpFormContent[string],
): string | null {
  switch (field.kind) {
    case "string": {
      if (typeof value !== "string") return "Enter a text value.";
      const length = [...value].length;
      if (field.minLength !== null && length < field.minLength) {
        return `Enter at least ${field.minLength} characters.`;
      }
      if (field.maxLength !== null && length > field.maxLength) {
        return `Enter at most ${field.maxLength} characters.`;
      }
      if (field.format !== null) {
        const formats = {
          email: z.email(),
          uri: z.url(),
          date: z.iso.date(),
          "date-time": z.iso.datetime({ offset: true }),
        };
        if (!formats[field.format].safeParse(value).success) {
          return `Enter a valid ${field.format} value.`;
        }
      }
      return null;
    }
    case "number":
    case "integer":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return "Enter a finite number.";
      }
      if (field.kind === "integer" && !Number.isInteger(value))
        return "Enter a whole number.";
      if (field.minimum !== null && value < field.minimum)
        return `Enter a value of at least ${field.minimum}.`;
      if (field.maximum !== null && value > field.maximum)
        return `Enter a value of at most ${field.maximum}.`;
      return null;
    case "boolean":
      return typeof value === "boolean" ? null : "Choose Yes or No.";
    case "enum":
      return typeof value === "string" &&
        field.options.some((option) => option.value === value)
        ? null
        : "Choose one of the offered options.";
    case "multi_enum":
      if (
        !Array.isArray(value) ||
        value.some(
          (entry) => !field.options.some((option) => option.value === entry),
        )
      ) {
        return "Choose from the offered options.";
      }
      if (new Set(value).size !== value.length)
        return "Choose each option only once.";
      if (field.minItems !== null && value.length < field.minItems)
        return `Choose at least ${field.minItems} options.`;
      if (field.maxItems !== null && value.length > field.maxItems)
        return `Choose at most ${field.maxItems} options.`;
      return null;
  }
}

export function validateCodexMcpFormContent(
  fields: CodexMcpFormField[],
  content: unknown,
):
  | { success: true; data: CodexMcpFormContent }
  | {
      success: false;
      errors: Record<string, string>;
      formError: string | null;
    } {
  const parsed = codexMcpFormContentSchema.safeParse(content);
  if (!parsed.success) {
    const issues = parsed.error.issues;
    const fieldErrors = issues.flatMap((issue) =>
      typeof issue.path[0] === "string" &&
      fields.some((field) => field.name === issue.path[0])
        ? [[issue.path[0], issue.message]]
        : [],
    );
    return {
      success: false,
      errors: Object.fromEntries(fieldErrors),
      formError:
        fieldErrors.length === issues.length
          ? null
          : "Form values must contain only the requested fields and supported values.",
    };
  }
  const errors = new Map<string, string>();
  const names = new Set(fields.map((field) => field.name));
  const formError = Object.keys(parsed.data).some((name) => !names.has(name))
    ? "The response contains fields that were not requested."
    : null;
  for (const field of fields) {
    if (!Object.hasOwn(parsed.data, field.name)) {
      if (field.required) errors.set(field.name, "This field is required.");
      continue;
    }
    const error = validateFieldValue(field, parsed.data[field.name]);
    if (error !== null) errors.set(field.name, error);
  }
  return errors.size === 0 && formError === null
    ? { success: true, data: parsed.data }
    : { success: false, errors: Object.fromEntries(errors), formError };
}

export function normalizeCodexMcpForm(schema: unknown): CodexMcpFormField[] {
  const parsed = nativeFormSchema.parse(schema);
  const required = new Set(parsed.required ?? []);
  for (const name of required) {
    if (!Object.hasOwn(parsed.properties, name))
      throw new Error(`Required field "${name}" is not declared.`);
  }
  const fields = Object.entries(parsed.properties).map(
    ([name, field]): CodexMcpFormField => {
      const base = {
        name,
        title: field.title ?? (name || "Value"),
        description: field.description ?? null,
        required: required.has(name),
      };
      if (field.type === "string") {
        if ("enum" in field) {
          if (
            field.enumNames !== undefined &&
            field.enumNames.length !== field.enum.length
          )
            throw new Error(
              `Option labels for "${name}" do not match its values.`,
            );
          return {
            ...base,
            kind: "enum",
            options: field.enum.map((value, index) => ({
              value,
              label: field.enumNames?.[index] ?? value,
            })),
            defaultValue: field.default ?? null,
          };
        }
        if ("oneOf" in field) {
          return {
            ...base,
            kind: "enum",
            options: field.oneOf.map((option) => ({
              value: option.const,
              label: option.title,
            })),
            defaultValue: field.default ?? null,
          };
        }
        return {
          ...base,
          kind: "string",
          defaultValue: field.default ?? null,
          minLength: field.minLength ?? null,
          maxLength: field.maxLength ?? null,
          format: field.format ?? null,
        };
      }
      if (field.type === "array") {
        return {
          ...base,
          kind: "multi_enum",
          options:
            "enum" in field.items
              ? field.items.enum.map((value) => ({ value, label: value }))
              : field.items.anyOf.map((option) => ({
                  value: option.const,
                  label: option.title,
                })),
          defaultValue: field.default ?? null,
          minItems: field.minItems ?? null,
          maxItems: field.maxItems ?? null,
        };
      }
      if (field.type === "boolean")
        return {
          ...base,
          kind: "boolean",
          defaultValue: field.default ?? null,
        };
      return {
        ...base,
        kind: field.type,
        defaultValue: field.default ?? null,
        minimum: field.minimum ?? null,
        maximum: field.maximum ?? null,
      };
    },
  );
  for (const field of fields) {
    const bounds =
      field.kind === "string"
        ? [field.minLength, field.maxLength]
        : field.kind === "number" || field.kind === "integer"
          ? [field.minimum, field.maximum]
          : field.kind === "multi_enum"
            ? [field.minItems, field.maxItems]
            : null;
    if (
      bounds !== null &&
      bounds[0] !== null &&
      bounds[1] !== null &&
      bounds[0] > bounds[1]
    )
      throw new Error(`Bounds for "${field.name}" are reversed.`);
    if (
      (field.kind === "enum" || field.kind === "multi_enum") &&
      new Set(field.options.map((option) => option.value)).size !==
        field.options.length
    )
      throw new Error(`Options for "${field.name}" contain duplicate values.`);
    if (
      field.kind === "multi_enum" &&
      field.minItems !== null &&
      field.minItems > field.options.length
    )
      throw new Error(
        `Minimum selections for "${field.name}" exceed its options.`,
      );
    if (field.defaultValue !== null) {
      const error = validateFieldValue(field, field.defaultValue);
      if (error !== null)
        throw new Error(`Invalid default for "${field.name}": ${error}`);
    }
  }
  return fields;
}
