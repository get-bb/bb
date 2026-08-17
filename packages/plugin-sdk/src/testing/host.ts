import type {
  ExperimentalHostEntry,
  PluginRpcContract,
  StandardSchemaV1,
  StandardSchemaV1InferInput,
  StandardSchemaV1InferOutput,
} from "@get-bb/plugin-sdk";

const RESULT_MAX_BYTES = 8 * 1024 * 1024;

type HostMethodName<Contract extends PluginRpcContract> =
  keyof Contract & string;

export interface ExperimentalHostEntryHarness<
  Contract extends PluginRpcContract,
> {
  /** Invoke one handler through the same validation boundaries as the daemon. */
  experimental_call<MethodName extends HostMethodName<Contract>>(
    method: MethodName,
    input: StandardSchemaV1InferInput<Contract[MethodName]["input"]>,
    options?: { readonly signal?: AbortSignal },
  ): Promise<StandardSchemaV1InferOutput<Contract[MethodName]["output"]>>;
  /** Aborted before the entry's dispose hook runs. */
  readonly experimental_lifecycleSignal: AbortSignal;
  /** Abort active calls and run the entry's dispose hook once. */
  experimental_dispose(): Promise<void>;
}

async function validate<Schema extends StandardSchemaV1>(
  schema: Schema,
  value: unknown,
): Promise<StandardSchemaV1InferOutput<Schema>> {
  const result = await schema["~standard"].validate(value);
  if (result.issues !== undefined) {
    throw new Error(result.issues.map((issue) => issue.message).join("; "));
  }
  return result.value;
}

function normalizeJson<Value>(value: Value, label: string): Value {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    serialized = undefined;
  }
  if (serialized === undefined) {
    throw new Error(`${label} is not JSON-serializable`);
  }
  if (Buffer.byteLength(serialized) > RESULT_MAX_BYTES) {
    throw new Error(`${label} exceeds ${RESULT_MAX_BYTES} bytes`);
  }
  return JSON.parse(serialized) as Value;
}

/**
 * Test one host entry in-process with the same validation, JSON transport,
 * cancellation, lifecycle, and output-size boundaries as the daemon worker.
 * Process crashes remain an integration concern for PluginHostManager tests.
 */
export function experimental_createHostEntryHarness<
  Contract extends PluginRpcContract,
>(
  entry: ExperimentalHostEntry<Contract>,
): ExperimentalHostEntryHarness<Contract> {
  const lifecycleController = new AbortController();
  const activeCalls = new Set<AbortController>();
  let disposePromise: Promise<void> | null = null;

  return {
    get experimental_lifecycleSignal() {
      return lifecycleController.signal;
    },

    async experimental_call(methodName, input, options = {}) {
      if (disposePromise !== null) {
        throw new Error("host entry harness is disposed");
      }
      const method = entry.contract[methodName];
      const handler = entry.handlers[methodName];
      if (method === undefined || handler === undefined) {
        throw new Error(`unknown host method "${String(methodName)}"`);
      }

      const controller = new AbortController();
      activeCalls.add(controller);
      const abort = (): void => controller.abort();
      lifecycleController.signal.addEventListener("abort", abort, {
        once: true,
      });
      options.signal?.addEventListener("abort", abort, { once: true });
      if (lifecycleController.signal.aborted || options.signal?.aborted === true) {
        controller.abort();
      }

      try {
        const serverInput = await validate(method.input, input);
        const workerInput = await validate(
          method.input,
          normalizeJson(serverInput, `host input for ${methodName}`),
        );
        const rawOutput = await handler(workerInput, {
          signal: controller.signal,
          lifecycle: { signal: lifecycleController.signal },
        });
        const workerOutput = await validate(method.output, rawOutput);
        return await validate(
          method.output,
          normalizeJson(workerOutput, `host output for ${methodName}`),
        );
      } finally {
        activeCalls.delete(controller);
        lifecycleController.signal.removeEventListener("abort", abort);
        options.signal?.removeEventListener("abort", abort);
      }
    },

    experimental_dispose() {
      disposePromise ??= (async () => {
        lifecycleController.abort();
        for (const call of activeCalls) call.abort();
        activeCalls.clear();
        await entry.dispose?.();
      })();
      return disposePromise;
    },
  };
}
