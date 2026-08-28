import { createHash } from "node:crypto";
import type { JsonSchema, JsonValue } from "./types.js";

export const WORKFLOW_CALL_CACHE_VERSION: "workflow-call-cache-v1" =
  "workflow-call-cache-v1";

export interface ResolvedWorkflowExecutionSelection {
  providerId: string;
  model: string;
  reasoningLevel: string;
  permissionMode: string;
}

interface WorkflowCallExecutionSemantics {
  workerPromptVersion: string;
  resultProtocolVersion: string;
  maxRepairAttempts: number;
}

export interface WorkflowCallCacheInput {
  version: typeof WORKFLOW_CALL_CACHE_VERSION;
  previousCacheKey: string | null;
  prompt: string;
  selection: ResolvedWorkflowExecutionSelection;
  outputSchema: JsonSchema | null;
  executionSemantics: WorkflowCallExecutionSemantics;
}

export type WorkflowCallResultStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "incomplete";

type NonNullJsonValue = Exclude<JsonValue, null>;
type CanonicalizeInput = JsonValue | object | bigint | symbol | undefined;

interface WorkflowCallResultCandidate<Result extends NonNullJsonValue> {
  status: WorkflowCallResultStatus;
  result: Result | null;
}

type WorkflowCallReuseDecision<Result extends NonNullJsonValue> =
  | { reusable: false }
  | { reusable: true; result: Result };

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function quoted(value: string): string {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) {
    throw new Error("Could not encode a JSON string");
  }
  return encoded;
}

function pathForKey(path: string, key: string): string {
  return `${path}[${quoted(key)}]`;
}

function isSymbolKey(key: PropertyKey): key is symbol {
  return Object.prototype.toString.call(key) === "[object Symbol]";
}

function isObjectValue<Value extends CanonicalizeInput>(
  value: Value,
): value is Value & object {
  return value !== null && Object(value) === value;
}

function canonicalizeValue<Value extends CanonicalizeInput>(
  value: Value,
  path: string,
  ancestors: WeakSet<object>,
): string {
  if (value === null) return "null";
  const tag = Object.prototype.toString.call(value);
  const isPrimitive = Object(value) !== value;
  if (isPrimitive && tag === "[object String]") return quoted(String(value));
  if (isPrimitive && tag === "[object Boolean]") {
    return value === true ? "true" : "false";
  }
  if (isPrimitive && tag === "[object Number]") {
    if (!Number.isFinite(value)) {
      throw new Error(`${path} contains a non-finite number`);
    }
    return Object.is(value, -0) ? "0" : String(value);
  }
  if (isPrimitive && tag === "[object Symbol]") {
    throw new Error(`${path} is not JSON-compatible (symbol)`);
  }
  if (!isObjectValue(value)) {
    throw new Error(
      `${path} is not JSON-compatible (${Object.prototype.toString.call(value)})`,
    );
  }
  if (ancestors.has(value)) throw new Error(`${path} contains a cycle`);

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) {
        throw new Error(`${path} must use the standard Array prototype`);
      }
      for (const key of Reflect.ownKeys(value)) {
        if (isSymbolKey(key)) {
          throw new Error(`${path} contains a symbol property`);
        }
        if (key === "length") continue;
        const index = Number(key);
        if (
          !Number.isSafeInteger(index) ||
          index < 0 ||
          String(index) !== key ||
          index >= value.length
        ) {
          throw new Error(
            `${path} contains non-index array property ${quoted(key)}`,
          );
        }
      }

      const entries: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(
          value,
          String(index),
        );
        if (descriptor === undefined) {
          throw new Error(`${path} contains a sparse array`);
        }
        if (!("value" in descriptor)) {
          throw new Error(`${path}[${index}] must be a data property`);
        }
        if (!descriptor.enumerable) {
          throw new Error(`${path}[${index}] must be enumerable`);
        }
        entries.push(
          canonicalizeValue(descriptor.value, `${path}[${index}]`, ancestors),
        );
      }
      return `[${entries.join(",")}]`;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`${path} must contain only plain objects and arrays`);
    }

    const keys: string[] = [];
    for (const key of Reflect.ownKeys(value)) {
      if (isSymbolKey(key)) {
        throw new Error(`${path} contains a symbol property`);
      }
      if (FORBIDDEN_KEYS.has(key)) {
        throw new Error(`${path} contains forbidden key ${quoted(key)}`);
      }
      keys.push(key);
    }
    keys.sort();

    const entries: string[] = [];
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor)) {
        throw new Error(`${pathForKey(path, key)} must be a data property`);
      }
      if (!descriptor.enumerable) {
        throw new Error(`${pathForKey(path, key)} must be enumerable`);
      }
      entries.push(
        `${quoted(key)}:${canonicalizeValue(
          descriptor.value,
          pathForKey(path, key),
          ancestors,
        )}`,
      );
    }
    return `{${entries.join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

export function canonicalizeJson<Value extends CanonicalizeInput>(
  value: Value,
): string {
  return canonicalizeValue(value, "$", new WeakSet<object>());
}

export function computeWorkflowCallCacheKey(
  input: WorkflowCallCacheInput,
): string {
  const semanticInput: WorkflowCallCacheInput = {
    version: input.version,
    previousCacheKey: input.previousCacheKey,
    prompt: input.prompt,
    selection: {
      providerId: input.selection.providerId,
      model: input.selection.model,
      reasoningLevel: input.selection.reasoningLevel,
      permissionMode: input.selection.permissionMode,
    },
    outputSchema: input.outputSchema,
    executionSemantics: {
      workerPromptVersion: input.executionSemantics.workerPromptVersion,
      resultProtocolVersion: input.executionSemantics.resultProtocolVersion,
      maxRepairAttempts: input.executionSemantics.maxRepairAttempts,
    },
  };
  return createHash("sha256")
    .update(canonicalizeJson(semanticInput), "utf8")
    .digest("hex");
}

export function reusableSuccessfulResult<Result extends NonNullJsonValue>(
  candidate: WorkflowCallResultCandidate<Result> | null,
): WorkflowCallReuseDecision<Result> {
  if (candidate?.status !== "succeeded" || candidate.result === null) {
    return { reusable: false };
  }
  return { reusable: true, result: candidate.result };
}
