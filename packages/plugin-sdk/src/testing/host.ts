import type {
  ExperimentalHostEntry,
  ExperimentalHostSignals,
  ExperimentalHostWatchListener,
  ExperimentalHostWatchOptions,
  ExperimentalHostWatchSubscription,
  ExperimentalHostWorkerLease,
  PluginRpcContract,
  StandardSchemaV1,
  StandardSchemaV1InferInput,
  StandardSchemaV1InferOutput,
} from "@get-bb/plugin-sdk";

const RESULT_MAX_BYTES = 8 * 1024 * 1024;

type HostMethodName<Contract extends PluginRpcContract> = keyof Contract &
  string;

type HostSignalName<Signals extends ExperimentalHostSignals> = keyof Signals &
  string;

export type ExperimentalHostHarnessSignal<
  Signals extends ExperimentalHostSignals,
> = {
  [SignalName in HostSignalName<Signals>]: {
    readonly signal: SignalName;
    readonly payload: StandardSchemaV1InferOutput<
      Signals[SignalName]["payload"]
    >;
  };
}[HostSignalName<Signals>];

export interface ExperimentalCreateHostEntryHarnessOptions {
  readonly experimental_paths?: {
    readonly dataDir: string;
    readonly tempDir: string;
  };
  readonly experimental_watch?: (
    options: ExperimentalHostWatchOptions,
    listener: ExperimentalHostWatchListener,
  ) =>
    | ExperimentalHostWatchSubscription
    | Promise<ExperimentalHostWatchSubscription>;
}

export interface ExperimentalHostEntryHarness<
  Contract extends PluginRpcContract,
  Signals extends ExperimentalHostSignals,
> {
  /** Invoke one handler through the same validation boundaries as the daemon. */
  experimental_call<MethodName extends HostMethodName<Contract>>(
    method: MethodName,
    input: StandardSchemaV1InferInput<Contract[MethodName]["input"]>,
    options?: { readonly signal?: AbortSignal },
  ): Promise<StandardSchemaV1InferOutput<Contract[MethodName]["output"]>>;
  /** Validated signals emitted by handlers, in emission order. */
  experimental_getSignals(): readonly ExperimentalHostHarnessSignal<Signals>[];
  /** Number of worker-retention leases currently held by the entry. */
  experimental_getRetainedWorkerLeaseCount(): number;
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
  Signals extends ExperimentalHostSignals,
>(
  entry: ExperimentalHostEntry<Contract, Signals>,
  harnessOptions: ExperimentalCreateHostEntryHarnessOptions = {},
): ExperimentalHostEntryHarness<Contract, Signals> {
  const lifecycleController = new AbortController();
  const activeCalls = new Set<AbortController>();
  const capturedSignals: Array<{ signal: string; payload: unknown }> = [];
  const watchSubscriptions = new Set<ExperimentalHostWatchSubscription>();
  const retainedWorkerLeases = new Set<ExperimentalHostWorkerLease>();
  const paths = harnessOptions.experimental_paths ?? {
    dataDir: "/test/plugin-data",
    tempDir: "/test/plugin-temp",
  };
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
      if (
        lifecycleController.signal.aborted ||
        options.signal?.aborted === true
      ) {
        controller.abort();
      }

      let contextOpen = true;
      try {
        const serverInput = await validate(method.input, input);
        const workerInput = await validate(
          method.input,
          normalizeJson(serverInput, `host input for ${methodName}`),
        );
        const rawOutput = await handler(workerInput, {
          signal: controller.signal,
          lifecycle: { signal: lifecycleController.signal },
          experimental_paths: paths,
          async experimental_emitSignal(signalName, payload) {
            const descriptor = entry.experimental_signals?.[signalName];
            if (descriptor === undefined) {
              throw new Error(`unknown host signal "${String(signalName)}"`);
            }
            const workerPayload = await validate(descriptor.payload, payload);
            const serverPayload = await validate(
              descriptor.payload,
              normalizeJson(workerPayload, `host signal ${String(signalName)}`),
            );
            capturedSignals.push({
              signal: String(signalName),
              payload: serverPayload,
            });
          },
          async experimental_watch(watchOptions, listener) {
            if (lifecycleController.signal.aborted) {
              throw new Error("host entry harness is disposed");
            }
            const resolvedWatchOptions: ExperimentalHostWatchOptions = {
              rootPath: watchOptions.rootPath,
              ignoredPaths: watchOptions.ignoredPaths ?? [],
              debounceMs: watchOptions.debounceMs ?? 75,
              maxWaitMs: watchOptions.maxWaitMs ?? 500,
            };
            const underlying = await (harnessOptions.experimental_watch?.(
              resolvedWatchOptions,
              listener,
            ) ?? { dispose: async () => undefined });
            let disposed = false;
            const subscription: ExperimentalHostWatchSubscription = {
              async dispose() {
                if (disposed) return;
                disposed = true;
                watchSubscriptions.delete(subscription);
                await underlying.dispose();
              },
            };
            watchSubscriptions.add(subscription);
            return subscription;
          },
          experimental_retainWorker() {
            if (
              !contextOpen ||
              controller.signal.aborted ||
              lifecycleController.signal.aborted
            ) {
              throw new Error("host call context is no longer active");
            }
            let disposed = false;
            const lease: ExperimentalHostWorkerLease = {
              async dispose() {
                if (disposed) return;
                disposed = true;
                retainedWorkerLeases.delete(lease);
              },
            };
            retainedWorkerLeases.add(lease);
            return lease;
          },
        });
        const workerOutput = await validate(method.output, rawOutput);
        return await validate(
          method.output,
          normalizeJson(workerOutput, `host output for ${methodName}`),
        );
      } finally {
        // Retaining a worker must be an explicit decision made by an active
        // handler, not by work that escaped the request.
        contextOpen = false;
        activeCalls.delete(controller);
        lifecycleController.signal.removeEventListener("abort", abort);
        options.signal?.removeEventListener("abort", abort);
      }
    },

    experimental_getSignals() {
      return capturedSignals as ExperimentalHostHarnessSignal<Signals>[];
    },

    experimental_getRetainedWorkerLeaseCount() {
      return retainedWorkerLeases.size;
    },

    experimental_dispose() {
      disposePromise ??= (async () => {
        lifecycleController.abort();
        for (const call of activeCalls) call.abort();
        activeCalls.clear();
        await Promise.all(
          [...watchSubscriptions].map((subscription) => subscription.dispose()),
        );
        try {
          await entry.dispose?.();
        } finally {
          retainedWorkerLeases.clear();
        }
      })();
      return disposePromise;
    },
  };
}
