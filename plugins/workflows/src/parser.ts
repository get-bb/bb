import {
  parse,
  type Expression,
  type ObjectExpression,
  type Program,
} from "acorn";
import { ancestor } from "acorn-walk";
import type { JsonObject, JsonValue, ParsedWorkflow } from "./types.js";
import {
  assertValidJsonSchema,
  assertValidWorkflowSourceText,
} from "./validation.js";
import { canonicalizeJson } from "./cache.js";

export interface LiteralAgentSelection {
  provider: string;
  model: string;
  reasoningLevel: string;
  line: number | null;
}

interface InspectedWorkflowSource {
  workflow: ParsedWorkflow;
  literalSelections: LiteralAgentSelection[];
}

function locationSuffix(node: {
  loc?: { start: { line: number; column: number } } | null;
}): string {
  return node.loc === undefined || node.loc === null
    ? ""
    : ` at ${node.loc.start.line}:${node.loc.start.column + 1}`;
}

function literalValue(node: Expression, path: string): JsonValue {
  switch (node.type) {
    case "Literal": {
      const value = node.value;
      if (
        value === null ||
        typeof value === "string" ||
        typeof value === "boolean" ||
        (typeof value === "number" && Number.isFinite(value))
      ) {
        return value;
      }
      throw new Error(`${path} contains a non-JSON literal`);
    }
    case "ArrayExpression":
      return node.elements.map((element, index) => {
        if (element === null || element.type === "SpreadElement") {
          throw new Error(`${path}[${index}] must be a literal value`);
        }
        return literalValue(element, `${path}[${index}]`);
      });
    case "ObjectExpression": {
      const result: JsonObject = {};
      const seen = new Set<string>();
      for (const property of node.properties) {
        if (
          property.type !== "Property" ||
          property.computed ||
          property.kind !== "init" ||
          property.method ||
          property.shorthand
        ) {
          throw new Error(`${path} must use plain literal properties`);
        }
        const key =
          property.key.type === "Identifier"
            ? property.key.name
            : property.key.type === "Literal" &&
                typeof property.key.value === "string"
              ? property.key.value
              : null;
        if (key === null) throw new Error(`${path} contains an invalid key`);
        if (seen.has(key)) {
          throw new Error(
            `${path} contains duplicate key ${JSON.stringify(key)}`,
          );
        }
        seen.add(key);
        if (
          key === "__proto__" ||
          key === "constructor" ||
          key === "prototype"
        ) {
          throw new Error(
            `${path} contains forbidden key ${JSON.stringify(key)}`,
          );
        }
        result[key] = literalValue(property.value, `${path}.${key}`);
      }
      return result;
    }
    case "UnaryExpression":
      if (
        (node.operator === "+" || node.operator === "-") &&
        node.argument.type === "Literal" &&
        typeof node.argument.value === "number"
      ) {
        const value =
          node.operator === "-" ? -node.argument.value : node.argument.value;
        if (Number.isFinite(value)) return value;
      }
      throw new Error(`${path} contains a non-JSON expression`);
    default:
      throw new Error(`${path} must be a JSON-compatible literal`);
  }
}

function propertyName(
  property: ObjectExpression["properties"][number],
): string | null {
  if (property.type !== "Property" || property.computed) return null;
  if (property.key.type === "Identifier") return property.key.name;
  return property.key.type === "Literal" &&
    typeof property.key.value === "string"
    ? property.key.value
    : null;
}

function inspectAgentOptions(
  node: ObjectExpression,
  selections: LiteralAgentSelection[],
): void {
  const allowed = new Set([
    "provider",
    "model",
    "reasoningLevel",
    "outputSchema",
    "schema",
    "title",
    "label",
    "phase",
  ]);
  const properties = new Map<string, Expression>();
  for (const property of node.properties) {
    if (
      property.type !== "Property" ||
      property.kind !== "init" ||
      property.method ||
      property.computed
    ) {
      throw new Error("agent options must use plain properties");
    }
    const key = propertyName(property);
    if (key === null) throw new Error("agent options contain an invalid key");
    if (!allowed.has(key)) {
      throw new Error(`Unknown agent option ${JSON.stringify(key)}`);
    }
    if (properties.has(key)) {
      throw new Error(
        `agent options contain duplicate key ${JSON.stringify(key)}`,
      );
    }
    properties.set(key, property.value);
  }

  const selectionKeys = ["provider", "model", "reasoningLevel"] as const;
  const presentCount = selectionKeys.filter((key) =>
    properties.has(key),
  ).length;
  if (presentCount !== 0 && presentCount !== selectionKeys.length) {
    throw new Error(
      "agent options must provide provider, model, and reasoningLevel together, or omit all three",
    );
  }
  if (presentCount === selectionKeys.length) {
    const values = selectionKeys.map((key) => {
      const expression = properties.get(key)!;
      if (
        expression.type !== "Literal" ||
        typeof expression.value !== "string" ||
        expression.value.trim() === ""
      ) {
        throw new Error(
          `agent options.${key} must be a non-empty string literal when selecting a provider`,
        );
      }
      return expression.value;
    });
    selections.push({
      provider: values[0]!,
      model: values[1]!,
      reasoningLevel: values[2]!,
      line: node.loc?.start.line ?? null,
    });
  }

  const literalSchemas = new Map<"outputSchema" | "schema", JsonValue>();
  for (const key of ["outputSchema", "schema"] as const) {
    const expression = properties.get(key);
    if (expression === undefined) continue;
    let schemaValue: JsonValue | undefined;
    try {
      schemaValue = literalValue(expression, `agent options.${key}`);
    } catch {
      schemaValue = undefined;
    }
    if (schemaValue !== undefined) {
      literalSchemas.set(key, schemaValue);
      if (schemaValue !== null) {
        assertValidJsonSchema(schemaValue, `agent options.${key}`);
      }
    }
  }
  const literalOutputSchema = literalSchemas.get("outputSchema");
  const literalSchema = literalSchemas.get("schema");
  if (
    literalOutputSchema !== undefined &&
    literalSchema !== undefined &&
    canonicalizeJson(literalOutputSchema) !== canonicalizeJson(literalSchema)
  ) {
    throw new Error(
      "agent options.outputSchema and agent options.schema must be structurally identical when both are provided",
    );
  }
  for (const key of ["title", "label", "phase"] as const) {
    const expression = properties.get(key);
    if (
      expression?.type === "Literal" &&
      (typeof expression.value !== "string" || expression.value.trim() === "")
    ) {
      throw new Error(`agent options.${key} must be a non-empty string`);
    }
  }
  const title = properties.get("title");
  const label = properties.get("label");
  if (
    title?.type === "Literal" &&
    typeof title.value === "string" &&
    label?.type === "Literal" &&
    typeof label.value === "string" &&
    title.value !== label.value
  ) {
    throw new Error(
      "agent options.title and agent options.label must match when both are provided",
    );
  }
}

function readMetadata(node: ObjectExpression): ParsedWorkflow["metadata"] {
  const value = literalValue(node, "meta");
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("meta must be an object literal");
  }
  const allowed = new Set([
    "name",
    "description",
    "inputSchema",
    "outputSchema",
    "phases",
  ]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key))
      throw new Error(`Unknown meta field ${JSON.stringify(key)}`);
  }
  if (
    typeof value.name !== "string" ||
    !/^[a-z][a-z0-9-]{0,63}$/.test(value.name)
  ) {
    throw new Error(
      "meta.name must be a lowercase kebab-case name up to 64 characters",
    );
  }
  if (
    typeof value.description !== "string" ||
    value.description.trim() === ""
  ) {
    throw new Error("meta.description must be a non-empty string");
  }
  const inputSchema = value.inputSchema ?? null;
  const outputSchema = value.outputSchema ?? null;
  if (inputSchema !== null)
    assertValidJsonSchema(inputSchema, "meta.inputSchema");
  if (outputSchema !== null)
    assertValidJsonSchema(outputSchema, "meta.outputSchema");
  const phasesValue = value.phases === undefined ? [] : value.phases;
  if (!Array.isArray(phasesValue)) {
    throw new Error("meta.phases must be an array");
  }
  const phaseTitles = new Set<string>();
  const phases = phasesValue.map((phase, index) => {
    if (typeof phase !== "object" || phase === null || Array.isArray(phase)) {
      throw new Error(`meta.phases[${index}] must be an object`);
    }
    for (const key of Object.keys(phase)) {
      if (key !== "title" && key !== "detail") {
        throw new Error(
          `Unknown meta.phases[${index}] field ${JSON.stringify(key)}`,
        );
      }
    }
    if (typeof phase.title !== "string" || phase.title.trim() === "") {
      throw new Error(`meta.phases[${index}].title must be a non-empty string`);
    }
    if (phaseTitles.has(phase.title)) {
      throw new Error(
        `meta.phases contains duplicate title ${JSON.stringify(phase.title)}`,
      );
    }
    phaseTitles.add(phase.title);
    let detail: string | null;
    if (phase.detail === undefined) {
      detail = null;
    } else if (typeof phase.detail !== "string") {
      throw new Error(
        `meta.phases[${index}].detail must be a non-empty string when provided`,
      );
    } else if (phase.detail.trim() === "") {
      throw new Error(
        `meta.phases[${index}].detail must be a non-empty string when provided`,
      );
    } else {
      detail = phase.detail;
    }
    return { title: phase.title, detail };
  });
  return {
    name: value.name,
    description: value.description,
    inputSchema,
    outputSchema,
    phases,
  };
}

function rejectUnsafeSyntax(
  program: Program,
  selections: LiteralAgentSelection[],
): void {
  ancestor(program, {
    ImportDeclaration(node) {
      throw new Error(
        `Imports are unavailable in workflows${locationSuffix(node)}`,
      );
    },
    ImportExpression(node) {
      throw new Error(
        `Dynamic imports are unavailable in workflows${locationSuffix(node)}`,
      );
    },
    MetaProperty(node) {
      throw new Error(
        `Module metadata is unavailable in workflows${locationSuffix(node)}`,
      );
    },
    WithStatement(node) {
      throw new Error(
        `with statements are unavailable in workflows${locationSuffix(node)}`,
      );
    },
    DebuggerStatement(node) {
      throw new Error(
        `debugger is unavailable in workflows${locationSuffix(node)}`,
      );
    },
    NewExpression(node) {
      if (
        node.callee.type === "Identifier" &&
        ["Date", "Function"].includes(node.callee.name)
      ) {
        throw new Error(
          `${node.callee.name} is unavailable in workflows${locationSuffix(node)}`,
        );
      }
    },
    MemberExpression(node) {
      const property =
        !node.computed && node.property.type === "Identifier"
          ? node.property.name
          : node.computed && node.property.type === "Literal"
            ? node.property.value
            : null;
      if (
        ["constructor", "__proto__", "prototype"].includes(String(property))
      ) {
        throw new Error(
          `Dynamic prototype access is unavailable in workflows${locationSuffix(node)}`,
        );
      }
      if (
        node.object.type === "Identifier" &&
        node.object.name === "Math" &&
        property === "random"
      ) {
        throw new Error(
          `Math.random is unavailable in workflows${locationSuffix(node)}`,
        );
      }
    },
    CallExpression(node) {
      if (
        node.callee.type === "Identifier" &&
        ["eval", "Function", "require"].includes(node.callee.name)
      ) {
        throw new Error(
          `${node.callee.name} is unavailable in workflows${locationSuffix(node)}`,
        );
      }
      if (
        node.callee.type === "Identifier" &&
        node.callee.name === "agent" &&
        node.arguments[1]?.type === "ObjectExpression"
      ) {
        inspectAgentOptions(node.arguments[1], selections);
      }
    },
    Identifier(node, _state, ancestors) {
      const parent = ancestors.at(-2);
      const isPropertyKey =
        parent?.type === "Property" && parent.key === node && !parent.computed;
      if (
        !isPropertyKey &&
        [
          "process",
          "require",
          "module",
          "Buffer",
          "WebAssembly",
          "global",
          "globalThis",
          "Date",
        ].includes(node.name)
      ) {
        throw new Error(
          `${node.name} is unavailable in workflows${locationSuffix(node)}`,
        );
      }
    },
  });
}

export function inspectWorkflowSource(source: string): InspectedWorkflowSource {
  assertValidWorkflowSourceText(source);
  let program: Program;
  try {
    program = parse(source, {
      ecmaVersion: "latest",
      sourceType: "module",
      locations: true,
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
    });
  } catch (error) {
    throw new Error(
      `Workflow syntax error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const declaration = program.body[0];
  if (
    declaration?.type !== "ExportNamedDeclaration" ||
    declaration.declaration?.type !== "VariableDeclaration" ||
    declaration.declaration.kind !== "const" ||
    declaration.declaration.declarations.length !== 1
  ) {
    throw new Error("A workflow must begin with `export const meta = { ... }`");
  }
  const binding = declaration.declaration.declarations[0]!;
  if (
    binding.id.type !== "Identifier" ||
    binding.id.name !== "meta" ||
    binding.init?.type !== "ObjectExpression"
  ) {
    throw new Error("A workflow must begin with `export const meta = { ... }`");
  }
  for (const statement of program.body.slice(1)) {
    if (
      statement.type === "ExportNamedDeclaration" ||
      statement.type === "ExportDefaultDeclaration"
    ) {
      throw new Error(
        `Only the meta export is allowed${locationSuffix(statement)}`,
      );
    }
  }

  const literalSelections: LiteralAgentSelection[] = [];
  rejectUnsafeSyntax(program, literalSelections);
  const body = source.slice(declaration.end).trim();
  if (body === "") throw new Error("Workflow body cannot be empty");
  return {
    workflow: { metadata: readMetadata(binding.init), body },
    literalSelections,
  };
}

export function parseWorkflowSource(source: string): ParsedWorkflow {
  return inspectWorkflowSource(source).workflow;
}
