import { setTimeout as delay } from "node:timers/promises";
import { jsonObjectSchema, type JsonObject, type JsonValue } from "@bb/domain";
import {
  parseProviderModelConfig,
  type ProviderModelInfo,
} from "@bb/config/inference-model";
import { validateToolCall } from "@earendil-works/pi-ai";
import type { Static, TSchema, Tool, ToolCall } from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import type { AppDeps, LoggedWorkSessionDeps } from "../../types.js";
import { ApiError } from "../../errors.js";
import { runLiveCommandAndWait } from "../hosts/live-command-wait.js";
import { requireConnectedPrimaryHostId } from "../hosts/primary-host.js";
import { runtimeErrorLogFields } from "../lib/error-log-fields.js";
import { backsHostDaemonAiServices } from "./host-daemon-ai-provider.js";

type BaseInferenceDeps = Pick<AppDeps, "config" | "logger">;
type InferenceCompleteDeps = LoggedWorkSessionDeps;

type InferenceModels = ReturnType<typeof builtinModels>;

// Built lazily: constructing the registry at module scope would turn any
// failure inside it into a server import failure rather than a failure of the
// one inference call that needed it.
let inferenceModelsInstance: InferenceModels | undefined;

function getInferenceModels(): InferenceModels {
  inferenceModelsInstance ??= builtinModels();
  return inferenceModelsInstance;
}

function getInferenceModel(
  deps: BaseInferenceDeps,
  modelInfo: ProviderModelInfo,
): ReturnType<InferenceModels["getModel"]> | null {
  const model = getInferenceModels().getModel(
    modelInfo.provider,
    modelInfo.modelId,
  );
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

export const INFERENCE_POLICY = {
  // The command timeout is enforced by the daemon around the provider request.
  // Leave enough time for its settled response to cross the host RPC boundary
  // so the server does not discard a useful timeout or completion as stale.
  hostRpcGraceMs: 1_000,
  commitMessage: { maxAttempts: 2, retryDelayMs: 0, timeoutMs: 5_000 },
  threadMetadata: { maxAttempts: 2, retryDelayMs: 250, timeoutMs: 5_000 },
  voiceTranscription: { maxAttempts: 2, retryDelayMs: 250, timeoutMs: 10_000 },
} as const;

interface InferenceCompleteArgs<T extends TSchema> {
  model?: string;
  prompt: string;
  schema: T;
  timeoutMs?: number;
}

interface InferenceTimeoutErrorArgs {
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

function isTransientInferenceError(error: Error): boolean {
  return (
    error instanceof InferenceTimeoutError ||
    (error instanceof ApiError &&
      (error.body.code === "codex_rate_limited" ||
        error.body.code === "codex_service_unavailable" ||
        error.body.code === "codex_request_timeout" ||
        error.body.code === "command_timeout"))
  );
}

interface InferenceCompleteWithFallbackArgs<T extends TSchema> {
  complete?: (
    model: string,
    prompt: string,
    timeoutMs: number,
  ) => Promise<Static<T> | null>;
  fallbackModel?: string;
  label: string;
  logContext?: JsonObject;
  maxAttempts: number;
  primaryModel?: string;
  prompt: string;
  retryDelayMs: number;
  schema: T;
  timeoutMs: number;
}

/**
 * Complete with the primary model, switching to the configured fallback only
 * after a transient failure.
 */
export async function inferenceCompleteWithFallback<T extends TSchema>(
  deps: InferenceCompleteDeps,
  args: InferenceCompleteWithFallbackArgs<T>,
): Promise<Static<T> | null> {
  const startedAt = Date.now();
  const maxAttempts = Math.max(1, args.maxAttempts);
  const primaryModel = args.primaryModel ?? deps.config.inferenceModel;
  const fallbackModel =
    args.fallbackModel ?? deps.config.inferenceFallbackModel;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const model = attempt === 1 ? primaryModel : fallbackModel;
    try {
      const value = args.complete
        ? await args.complete(model, args.prompt, args.timeoutMs)
        : await inferenceComplete(deps, {
            model,
            prompt: args.prompt,
            schema: args.schema,
            timeoutMs: args.timeoutMs,
          });
      if (attempt > 1) {
        deps.logger.info(
          {
            attempts: attempt,
            durationMs: Date.now() - startedAt,
            maxAttempts,
            model,
            reason: "transient-failure",
            timeoutMs: args.timeoutMs,
            ...args.logContext,
          },
          `${args.label} completed with fallback model`,
        );
      }
      if (value === null) {
        deps.logger.warn(
          {
            attempts: attempt,
            durationMs: Date.now() - startedAt,
            reason: "no-result",
            ...args.logContext,
          },
          `${args.label} returned no result`,
        );
      }
      return value;
    } catch (error) {
      const err =
        error instanceof Error
          ? error
          : new Error(`Non-Error thrown during ${args.label.toLowerCase()}`);
      const transient = isTransientInferenceError(err);
      if (transient && attempt < maxAttempts) {
        deps.logger.info(
          {
            attempt,
            errorCode: err instanceof ApiError ? err.body.code : "timeout",
            fallbackModel,
            maxAttempts,
            model,
            reason: "transient-failure",
            ...(err instanceof InferenceTimeoutError
              ? { timeoutMs: err.timeoutMs }
              : {}),
            ...args.logContext,
          },
          `${args.label} failed transiently; using fallback model`,
        );
        if (args.retryDelayMs > 0) {
          await delay(args.retryDelayMs);
        }
        continue;
      }
      const fields = {
        attempts: attempt,
        durationMs: Date.now() - startedAt,
        maxAttempts,
        model,
        ...args.logContext,
      };
      if (err instanceof InferenceTimeoutError) {
        deps.logger.info(
          { ...fields, reason: "timeout", timeoutMs: err.timeoutMs },
          `${args.label} timed out`,
        );
      } else {
        deps.logger.warn(
          {
            ...fields,
            ...runtimeErrorLogFields(deps.config, err),
            reason: "failed",
          },
          `${args.label} failed`,
        );
      }
      throw err;
    }
  }

  throw new Error("Inference fallback loop completed without an outcome");
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
      timeoutMs: timeoutMs + INFERENCE_POLICY.hostRpcGraceMs,
      command: {
        type: "codex.inference.complete",
        model: modelInfo.modelId,
        // Helper inference is limited to short titles and commit subjects;
        // preserve the previous no-reasoning latency and cost profile.
        reasoningEffort: "none",
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
  const configuredModel = args.model ?? deps.config.inferenceModel;
  const modelInfo = parseProviderModelConfig({
    name:
      args.model === undefined ? "BB_INFERENCE" : "inference model override",
    value: configuredModel,
  });
  if (backsHostDaemonAiServices(modelInfo.provider)) {
    return completeWithCodexHostDaemon(deps, modelInfo, args);
  }

  const model = getInferenceModel(deps, modelInfo);
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
  const completionPromise = getInferenceModels().complete(
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
