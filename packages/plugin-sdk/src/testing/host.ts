import type {
  ExperimentalHostCallOptions,
  ExperimentalHostEntry,
  ExperimentalHostRpcContract,
  ExperimentalHostRpcMethodContract,
  ExperimentalHostResolvedTarget,
  ExperimentalHostRpcContext,
  ExperimentalHostSignalEvent,
  ExperimentalHostSignalPublisher,
  ExperimentalHostWatchListener,
  ExperimentalHostWatchOptions,
  ExperimentalHostWatchSubscription,
  StandardSchemaV1,
  StandardSchemaV1InferInput,
  StandardSchemaV1InferOutput,
} from "@get-bb/plugin-sdk";

const RESULT_MAX_BYTES = 8 * 1024 * 1024;

type HostMethodName<Contract extends ExperimentalHostRpcContract> =
  keyof Contract["methods"] & string;

type HostSignalName<Contract extends ExperimentalHostRpcContract> =
  keyof NonNullable<Contract["signals"]> & string;

export type ExperimentalHostHarnessSignal<
  Contract extends ExperimentalHostRpcContract,
> = {
  [SignalName in HostSignalName<Contract>]: ExperimentalHostSignalEvent<
    Contract,
    SignalName
  > & { readonly signal: SignalName };
}[HostSignalName<Contract>];

export interface ExperimentalCreateHostEntryHarnessOptions {
  /** Host id used when resolving environment-targeted calls. */
  readonly hostId?: string;
  /** Resolve an environment id to its absolute workspace root. */
  readonly resolveEnvironmentCwd?: (
    environmentId: string,
  ) => string | null | Promise<string | null>;
  /** Stable fake paths passed to every invocation. */
  readonly paths?: {
    readonly dataDir: string;
    readonly tempDir: string;
  };
  /** Deterministic replacement for the daemon's native watch service. */
  readonly experimental_watch?: (
    options: ExperimentalHostWatchOptions,
    listener: ExperimentalHostWatchListener,
  ) =>
    | ExperimentalHostWatchSubscription
    | Promise<ExperimentalHostWatchSubscription>;
}

export interface ExperimentalHostEntryHarness<
  Contract extends ExperimentalHostRpcContract,
> {
  /** Invoke one handler through contract validation and a daemon-shaped context. */
  experimental_call<MethodName extends HostMethodName<Contract>>(
    method: MethodName,
    input: StandardSchemaV1InferInput<Contract["methods"][MethodName]["input"]>,
    options: ExperimentalHostCallOptions<Contract["methods"][MethodName]>,
  ): Promise<
    StandardSchemaV1InferOutput<Contract["methods"][MethodName]["output"]>
  >;
  /** Validated signals published by handlers, in publication order. */
  experimental_getSignals(): Promise<
    readonly ExperimentalHostHarnessSignal<Contract>[]
  >;
  /** Aborted before the entry's dispose hook runs. */
  readonly experimental_lifecycleSignal: AbortSignal;
  /** Abort active calls and run the entry's dispose hook once. */
  experimental_dispose(): Promise<void>;
}

interface CapturedSignal {
  readonly payload: unknown;
  readonly signal: string;
  readonly target: ExperimentalHostResolvedTarget;
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

function targetKind(
  target: { readonly hostId: string } | { readonly environmentId: string },
): "host" | "environment" {
  return "hostId" in target ? "host" : "environment";
}

function requireTargetKind(
  methodName: string,
  method: ExperimentalHostRpcMethodContract,
  target: { readonly hostId: string } | { readonly environmentId: string },
): void {
  if (method.target.kind !== targetKind(target)) {
    const article = method.target.kind === "environment" ? "an" : "a";
    throw new Error(
      `host method "${methodName}" requires ${article} ${method.target.kind} target`,
    );
  }
}

/**
 * Test one host entry in-process with the same schemas, targets, paths,
 * cancellation, lifecycle signal, output cap, and signal validation as the
 * daemon worker. Process crashes and environment scheduling remain integration
 * concerns for PluginHostManager tests.
 */
export function experimental_createHostEntryHarness<
  Contract extends ExperimentalHostRpcContract,
>(
  entry: ExperimentalHostEntry<Contract>,
  options: ExperimentalCreateHostEntryHarnessOptions = {},
): ExperimentalHostEntryHarness<Contract> {
  const lifecycleController = new AbortController();
  const activeCalls = new Set<AbortController>();
  const capturedSignals: CapturedSignal[] = [];
  const pendingSignalValidations = new Set<Promise<void>>();
  const signalErrors: unknown[] = [];
  const watchSubscriptions = new Set<ExperimentalHostWatchSubscription>();
  const paths = options.paths ?? {
    dataDir: "/test/plugin-data",
    tempDir: "/test/plugin-temp",
  };
  let disposePromise: Promise<void> | null = null;

  async function resolvedTarget(
    target: { readonly hostId: string } | { readonly environmentId: string },
  ): Promise<{
    cwd: string | null;
    target: ExperimentalHostResolvedTarget;
  }> {
    if ("hostId" in target) {
      return {
        cwd: null,
        target: { kind: "host", hostId: target.hostId },
      };
    }
    const cwd =
      (await options.resolveEnvironmentCwd?.(target.environmentId)) ?? null;
    if (cwd === null) {
      throw new Error(
        `no workspace is configured for environment "${target.environmentId}"`,
      );
    }
    return {
      cwd,
      target: {
        kind: "environment",
        environmentId: target.environmentId,
        hostId: options.hostId ?? "test-host",
      },
    };
  }

  return {
    get experimental_lifecycleSignal() {
      return lifecycleController.signal;
    },

    async experimental_call(methodName, input, callOptions) {
      if (disposePromise !== null) {
        throw new Error("host entry harness is disposed");
      }
      const method = entry.contract.methods[methodName];
      const handler = entry.handlers[methodName];
      if (method === undefined || handler === undefined) {
        throw new Error(`unknown host method "${String(methodName)}"`);
      }
      requireTargetKind(methodName, method, callOptions.target);
      const invocation = await resolvedTarget(callOptions.target);
      const controller = new AbortController();
      activeCalls.add(controller);
      const abort = (): void => controller.abort();
      lifecycleController.signal.addEventListener("abort", abort, {
        once: true,
      });
      callOptions.signal?.addEventListener("abort", abort, { once: true });
      if (
        lifecycleController.signal.aborted ||
        callOptions.signal?.aborted === true
      ) {
        controller.abort();
      }
      const signals: ExperimentalHostSignalPublisher<Contract> = {
        publish(signalName, payload) {
          const signal = entry.contract.signals?.[signalName];
          if (signal === undefined) {
            throw new Error(`unknown host signal "${String(signalName)}"`);
          }
          if (signal.target !== invocation.target.kind) {
            throw new Error(
              `host signal "${String(signalName)}" cannot be published for a ${invocation.target.kind} target`,
            );
          }
          const pending = validate(signal.payload, payload)
            .then((validated) =>
              normalizeJson(validated, "host signal payload"),
            )
            .then((wirePayload) => validate(signal.payload, wirePayload))
            .then((serverPayload) => {
              capturedSignals.push({
                payload: serverPayload,
                signal: String(signalName),
                target: invocation.target,
              });
            })
            .catch((error: unknown) => {
              signalErrors.push(error);
            });
          pendingSignalValidations.add(pending);
          void pending.finally(() => pendingSignalValidations.delete(pending));
        },
      };
      const context: ExperimentalHostRpcContext<Contract> = {
        cwd: invocation.cwd,
        lifecycle: { signal: lifecycleController.signal },
        paths,
        signal: controller.signal,
        signals,
        target: invocation.target,
        async experimental_watch(watchOptions, listener) {
          if (lifecycleController.signal.aborted) {
            throw new Error("host entry harness is disposed");
          }
          const subscription = await (options.experimental_watch?.(
            watchOptions,
            listener,
          ) ?? { dispose: async () => undefined });
          let disposed = false;
          const tracked: ExperimentalHostWatchSubscription = {
            async dispose() {
              if (disposed) return;
              disposed = true;
              watchSubscriptions.delete(tracked);
              await subscription.dispose();
            },
          };
          watchSubscriptions.add(tracked);
          return tracked;
        },
      };
      try {
        // Mirror both contract boundaries: server validation, a JSON wire
        // round-trip, then worker validation before the handler runs.
        const wireInput = normalizeJson(
          await validate(method.input, input),
          "host rpc input",
        );
        const parsedInput = await validate(method.input, wireInput);
        const output = await handler(parsedInput, context);
        const wireOutput = normalizeJson(
          await validate(method.output, output),
          "host handler result",
        );
        // The server validates the daemon's JSON result once more and returns
        // the schema output without serializing away typed transformations.
        return validate(method.output, wireOutput);
      } finally {
        lifecycleController.signal.removeEventListener("abort", abort);
        callOptions.signal?.removeEventListener("abort", abort);
        activeCalls.delete(controller);
      }
    },

    async experimental_getSignals() {
      await Promise.all([...pendingSignalValidations]);
      const error = signalErrors.shift();
      if (error !== undefined) throw error;
      return capturedSignals as ExperimentalHostHarnessSignal<Contract>[];
    },

    experimental_dispose() {
      disposePromise ??= (async () => {
        lifecycleController.abort();
        for (const controller of activeCalls) controller.abort();
        await Promise.all(
          [...watchSubscriptions].map((subscription) => subscription.dispose()),
        );
        await entry.dispose?.();
      })();
      return disposePromise;
    },
  };
}
