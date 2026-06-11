import { jsonObjectSchema, type JsonObject, type JsonValue } from "@bb/domain";
import {
  parseProviderModelConfig,
  type ProviderModelInfo,
} from "@bb/config/inference-model";
import { complete, getModel, validateToolCall } from "@mariozechner/pi-ai";
import type { Static, TSchema, Tool, ToolCall } from "@mariozechner/pi-ai";
import type { AppDeps, LoggedWorkSessionDeps } from "../../types.js";
import { ApiError } from "../../errors.js";
import { runLiveCommandAndWait } from "../hosts/live-command-wait.js";
import { requireConnectedPrimaryHostId } from "../hosts/primary-host.js";
import { backsHostDaemonAiServices } from "./host-daemon-ai-provider.js";

type BaseInferenceDeps = Pick<AppDeps, "config" | "logger">;
type InferenceCompleteDeps = LoggedWorkSessionDeps;

function getInferenceModel(
  deps: BaseInferenceDeps,
): ReturnType<typeof getModel> | null {
  const modelInfo = parseProviderModelConfig({
    name: "BB_INFERENCE",
    value: deps.config.inferenceModel,
  });
  // @ts-expect-error — pi-ai overloads getModel per provider; our provider string is dynamic
  const model = getModel(modelInfo.provider, modelInfo.modelId);
  if (!model) {
    deps.logger.warn(
      { provider: modelInfo.provider },
      "Unsupported inference provider",
    );
    return null;
  }
  return model;
}

const RESULT_TOOL_NAME = "result";
const DEFAULT_INFERENCE_TIMEOUT_MS = 30_000;

interface InferenceCompleteArgs<T extends TSchema> {
  prompt: string;
  schema: T;
  timeoutMs?: number;
}

export interface InferenceTimeoutErrorArgs {
  timeoutMs: number;
}

/**
 * Raised when an inference request exceeds its configured timeout budget.
 */
export class InferenceTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(args: InferenceTimeoutErrorArgs) {
    super(`Inference request timed out after ${args.timeoutMs}ms`);
    this.name = "InferenceTimeoutError";
    this.timeoutMs = args.timeoutMs;
  }
}

function toToolCallArguments(value: JsonValue): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Structured inference result must be a JSON object");
  }
  return value;
}

function validateStructuredResult<T extends TSchema>(
  schema: T,
  value: JsonValue,
): Static<T> {
  const tools: Tool<T>[] = [
    {
      name: RESULT_TOOL_NAME,
      description: "Return the result as structured JSON.",
      parameters: schema,
    },
  ];
  const toolCall: ToolCall = {
    type: "toolCall",
    id: "codex_result",
    name: RESULT_TOOL_NAME,
    arguments: toToolCallArguments(value),
  };

  // validateToolCall validates arguments against the TypeBox schema and
  // returns the validated data. Its return type is `any` so the cast is needed.
  return validateToolCall(tools, toolCall) as Static<T>;
}

function parseInferenceSchema(schema: TSchema): JsonObject {
  return jsonObjectSchema.parse(schema);
}

function shouldTreatAsInferenceTimeout(error: Error): boolean {
  return (
    error instanceof ApiError &&
    (error.body.code === "command_timeout" ||
      error.body.code === "codex_request_timeout")
  );
}

async function completeWithCodexHostDaemon<T extends TSchema>(
  deps: InferenceCompleteDeps,
  modelInfo: ProviderModelInfo,
  args: InferenceCompleteArgs<T>,
): Promise<Static<T> | null> {
  const hostId = requireConnectedPrimaryHostId(deps);
  const timeoutMs = args.timeoutMs ?? DEFAULT_INFERENCE_TIMEOUT_MS;
  try {
    const result = await runLiveCommandAndWait(deps, {
      hostId,
      timeoutMs,
      command: {
        type: "codex.inference.complete",
        model: modelInfo.modelId,
        prompt: args.prompt,
        outputSchema: parseInferenceSchema(args.schema),
        timeoutMs,
      },
    });

    return validateStructuredResult(args.schema, result.value);
  } catch (error) {
    const err =
      error instanceof Error
        ? error
        : new Error("Non-Error thrown during Codex inference");
    if (shouldTreatAsInferenceTimeout(err)) {
      throw new InferenceTimeoutError({ timeoutMs });
    }
    throw err;
  }
}

/**
 * Send a prompt to the configured inference model and return structured
 * output validated via a tool call. The model is given a single tool whose
 * parameters match the provided TypeBox schema; the tool call arguments
 * are validated against the schema and returned. Returns `null` if the
 * model is not configured or does not produce a valid tool call.
 */
export async function inferenceComplete<T extends TSchema>(
  deps: InferenceCompleteDeps,
  args: InferenceCompleteArgs<T>,
): Promise<Static<T> | null> {
  const modelInfo = parseProviderModelConfig({
    name: "BB_INFERENCE",
    value: deps.config.inferenceModel,
  });
  if (backsHostDaemonAiServices(modelInfo.provider)) {
    return completeWithCodexHostDaemon(deps, modelInfo, args);
  }

  const model = getInferenceModel(deps);
  if (!model) {
    return null;
  }

  const tools: Tool<T>[] = [
    {
      name: RESULT_TOOL_NAME,
      description: "Return the result as structured JSON.",
      parameters: args.schema,
    },
  ];

  const timeoutMs = args.timeoutMs;
  const abortController = timeoutMs ? new AbortController() : null;
  const completionPromise = complete(
    model,
    {
      messages: [
        {
          role: "user",
          content: args.prompt,
          timestamp: Date.now(),
        },
      ],
      tools,
    },
    abortController ? { signal: abortController.signal } : undefined,
  );

  let timer: ReturnType<typeof setTimeout> | null = null;
  const response = timeoutMs
    ? await Promise.race([
        completionPromise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(new InferenceTimeoutError({ timeoutMs }));
            abortController?.abort();
          }, timeoutMs);
          timer.unref();
        }),
      ]).finally(() => {
        if (timer) {
          clearTimeout(timer);
        }
      })
    : await completionPromise;

  const toolCall = response.content.find(
    (item) => item.type === "toolCall" && item.name === RESULT_TOOL_NAME,
  );
  if (!toolCall || toolCall.type !== "toolCall") {
    return null;
  }

  // validateToolCall validates arguments against the TypeBox schema and
  // returns the validated data. Its return type is `any` so the cast is needed.
  return validateToolCall(tools, toolCall) as Static<T>;
}
