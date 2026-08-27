/**
 * The consumer half of `bb.experimental_aiServices`: one structured helper
 * completion on behalf of a plugin.
 *
 * `bb.experimental_aiServices.register` lets a plugin *serve* inference to bb.
 * This is the other direction — a plugin asking bb's own configured helper
 * model a question — and it deliberately reuses `inferenceComplete` rather
 * than opening a second path to a provider, so a plugin's call routes through
 * exactly the same `BB_INFERENCE` setting, server-direct/plugin-service
 * decision, and structured-output validation as a thread title does.
 *
 * Two deliberate narrowings against bb's own helper calls:
 *
 * - **One attempt.** bb's internal callers wrap `inferenceComplete` in
 *   `inferenceCompleteWithFallback`, which retries onto `BB_INFERENCE_FALLBACK`
 *   and can therefore take twice the stated budget. The only caller this API
 *   exists for is a dispatch gate, which is itself boxed at 10s and fails its
 *   dispatch when the box expires — so a hidden second attempt would turn a
 *   plugin's honest 7s budget into a 14s dispatch failure. `timeoutMs` here is
 *   the whole budget.
 * - **Failures reject with a named cause.** A plugin needs to tell "nothing is
 *   configured" (report it to the user) apart from "the model was slow this
 *   time" (shrug and proceed), which a null return cannot express.
 */
import type { PluginAiCompletionError as PluginAiCompletionErrorContract } from "@get-bb/plugin-sdk";
import type { PluginAiCompletionFailure } from "@get-bb/plugin-sdk";
import { validatePluginAiCompletionRequest } from "@get-bb/plugin-sdk/internal/host-policy";
import { jsonObjectSchema, type JsonObject } from "@bb/domain";
import type { LoggedWorkSessionDeps } from "../../types.js";
import { ApiError } from "../../errors.js";
import { AiServiceCallError } from "./ai-service-call.js";
import {
  inferenceComplete,
  InferenceTimeoutError,
  resolveInferenceAvailability,
} from "./inference.js";

/**
 * The rejection `bb.experimental_aiServices.complete` produces. Like
 * `NeedsConfigurationError`, plugin code matches it by `name` rather than by
 * `instanceof` — a plugin bundle and the server do not share a class.
 */
export class PluginAiCompletionError
  extends Error
  implements PluginAiCompletionErrorContract
{
  override readonly name = "PluginAiCompletionError" as const;
  readonly failure: PluginAiCompletionFailure;

  constructor(failure: PluginAiCompletionFailure, message: string) {
    super(message);
    this.failure = failure;
  }
}

/**
 * Which named cause an inference failure is.
 *
 * `invalid_response` is the one upstream code that means the service answered
 * with something that does not satisfy the schema, so it joins the local
 * validation failure rather than the generic upstream bucket.
 */
function failureFor(error: unknown): PluginAiCompletionFailure {
  if (error instanceof InferenceTimeoutError) return "timeout";
  if (error instanceof AiServiceCallError) {
    return error.code === "invalid_response"
      ? "validation-failed"
      : "request-failed";
  }
  if (error instanceof ApiError && error.body.code === "not_configured") {
    return "no-service-configured";
  }
  return "request-failed";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface PluginAiCompletionArgs {
  pluginId: string;
  prompt: string;
  outputSchema: Record<string, unknown>;
  timeoutMs?: number;
}

/**
 * Run one structured completion for a plugin, or throw a
 * {@link PluginAiCompletionError} naming why not.
 *
 * Availability is resolved before anything is sent so that "BB_INFERENCE names
 * a service nothing serves" is reported as itself. After that, the only way to
 * learn that a model produced no usable answer is the null return, which is
 * what `validation-failed` means here.
 */
export async function completePluginAiRequest(
  deps: LoggedWorkSessionDeps,
  args: PluginAiCompletionArgs,
): Promise<JsonObject> {
  const request = validatePluginAiCompletionRequest({
    prompt: args.prompt,
    outputSchema: args.outputSchema,
    ...(args.timeoutMs === undefined ? {} : { timeoutMs: args.timeoutMs }),
  });

  if (!resolveInferenceAvailability(deps)) {
    throw new PluginAiCompletionError(
      "no-service-configured",
      `bb has no usable inference service: BB_INFERENCE is "${deps.config.inferenceModel}"`,
    );
  }

  const startedAt = Date.now();
  let value: unknown;
  try {
    // A plain JSON Schema object is already a TypeBox `TSchema` — TypeBox 1.x
    // types it as an empty interface, and pi-ai's `validateToolCall` detects
    // an unbranded schema and coerces before checking it. So there is nothing
    // to convert at this boundary: the plugin's schema is handed straight to
    // the same validator bb's own helper completions use.
    value = await inferenceComplete(deps, {
      prompt: request.prompt,
      schema: request.outputSchema,
      timeoutMs: request.timeoutMs,
    });
  } catch (error) {
    const failure = failureFor(error);
    deps.logger.debug(
      {
        durationMs: Date.now() - startedAt,
        failure,
        pluginId: args.pluginId,
        timeoutMs: request.timeoutMs,
      },
      "Plugin AI completion failed",
    );
    throw new PluginAiCompletionError(failure, errorMessage(error));
  }

  if (value === null || value === undefined) {
    throw new PluginAiCompletionError(
      "validation-failed",
      "the inference model returned no value satisfying outputSchema",
    );
  }
  const parsed = jsonObjectSchema.safeParse(value);
  if (!parsed.success) {
    throw new PluginAiCompletionError(
      "validation-failed",
      "the inference model returned a value that is not a JSON object",
    );
  }
  return parsed.data;
}
