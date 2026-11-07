import type {
  ExperimentalPluginRpcHandlerContext,
  JsonValue,
  PluginRpcError,
  StandardSchemaV1,
} from "@get-bb/plugin-sdk";
import {
  normalizeRpcJsonResult,
  readPluginRpcRefusal,
  validateRpcValue,
} from "@get-bb/plugin-sdk/internal/host-policy";
import {
  rpcResponseTags,
  type ContractTagDeclarations,
} from "@get-bb/plugin-sdk/internal/rpc-tags";

export class PluginRpcBoundaryError extends Error {
  constructor(readonly rpcError: PluginRpcError) {
    const issues = rpcError.issues
      ?.slice(0, 3)
      .map((issue) =>
        issue.path
          ? `${issue.path.join(".")}: ${issue.message}`
          : issue.message,
      )
      .join("; ");
    const summary =
      issues && issues.length > 300 ? `${issues.slice(0, 299)}…` : issues;
    super(summary ? `${rpcError.message} (${summary})` : rpcError.message);
    this.name = "PluginRpcBoundaryError";
  }
}

export function throwRpcBoundaryError(error: PluginRpcError): never {
  throw new PluginRpcBoundaryError(error);
}

export interface PluginRpcMethodRecord {
  declarations: ContractTagDeclarations<unknown, unknown>;
  inputSchema: StandardSchemaV1;
  outputSchema: StandardSchemaV1;
  handler: (
    input: unknown,
    context: ExperimentalPluginRpcHandlerContext,
  ) => unknown;
}

export type PluginRpcMethodOutcome =
  | { ok: true; result: JsonValue; invalidated: string[] }
  | { ok: false; error: PluginRpcError };

export async function runPluginRpcMethod(
  record: PluginRpcMethodRecord,
  input: unknown,
  context: ExperimentalPluginRpcHandlerContext,
): Promise<PluginRpcMethodOutcome> {
  const parsedInput = await validateRpcValue(
    record.inputSchema,
    input,
    "input",
    throwRpcBoundaryError,
  );
  let result: unknown;
  try {
    result = await record.handler(parsedInput, context);
  } catch (error) {
    const refusal = readPluginRpcRefusal(error);
    if (refusal === null) throw error;
    return { ok: false, error: refusal };
  }
  const parsedOutput = await validateRpcValue(
    record.outputSchema,
    result,
    "output",
    throwRpcBoundaryError,
  );
  const resultValue = normalizeRpcJsonResult(
    parsedOutput,
    throwRpcBoundaryError,
  );
  const { invalidated } = rpcResponseTags(
    record.declarations,
    parsedInput,
    parsedOutput,
  );
  return { ok: true, result: resultValue, invalidated };
}
