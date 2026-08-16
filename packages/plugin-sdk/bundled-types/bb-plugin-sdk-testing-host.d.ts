// Portable type declarations for `@get-bb/plugin-sdk`. Unpublished BB
// workspace contracts are flattened; public subpaths may reuse the
// package root without requiring any other @bb/* package.
//
// Confused by the API, or need a symbol that isn't here? Clone the BB repo
// and read the real source: https://github.com/get-bb/bb

import { ExperimentalHostWatchOptions, ExperimentalHostWatchListener, ExperimentalHostWatchSubscription, ExperimentalHostRpcContract, StandardSchemaV1InferInput, ExperimentalHostCallOptions, StandardSchemaV1InferOutput, ExperimentalHostSignalEvent, ExperimentalHostEntry } from '@get-bb/plugin-sdk';

type HostMethodName<Contract extends ExperimentalHostRpcContract> = keyof Contract["methods"] & string;
type HostSignalName<Contract extends ExperimentalHostRpcContract> = keyof NonNullable<Contract["signals"]> & string;
type ExperimentalHostHarnessSignal<Contract extends ExperimentalHostRpcContract> = {
    [SignalName in HostSignalName<Contract>]: ExperimentalHostSignalEvent<Contract, SignalName> & {
        readonly signal: SignalName;
    };
}[HostSignalName<Contract>];
interface ExperimentalCreateHostEntryHarnessOptions {
    /** Host id used when resolving environment-targeted calls. */
    readonly hostId?: string;
    /** Resolve an environment id to its absolute workspace root. */
    readonly resolveEnvironmentCwd?: (environmentId: string) => string | null | Promise<string | null>;
    /** Stable fake paths passed to every invocation. */
    readonly paths?: {
        readonly dataDir: string;
        readonly tempDir: string;
    };
    /** Deterministic replacement for the daemon's native watch service. */
    readonly experimental_watch?: (options: ExperimentalHostWatchOptions, listener: ExperimentalHostWatchListener) => ExperimentalHostWatchSubscription | Promise<ExperimentalHostWatchSubscription>;
}
interface ExperimentalHostEntryHarness<Contract extends ExperimentalHostRpcContract> {
    /** Invoke one handler through contract validation and a daemon-shaped context. */
    experimental_call<MethodName extends HostMethodName<Contract>>(method: MethodName, input: StandardSchemaV1InferInput<Contract["methods"][MethodName]["input"]>, options: ExperimentalHostCallOptions<Contract["methods"][MethodName]>): Promise<StandardSchemaV1InferOutput<Contract["methods"][MethodName]["output"]>>;
    /** Validated signals published by handlers, in publication order. */
    experimental_getSignals(): Promise<readonly ExperimentalHostHarnessSignal<Contract>[]>;
    /** Aborted before the entry's dispose hook runs. */
    readonly experimental_lifecycleSignal: AbortSignal;
    /** Abort active calls and run the entry's dispose hook once. */
    experimental_dispose(): Promise<void>;
}
/**
 * Test one host entry in-process with the same schemas, targets, paths,
 * cancellation, lifecycle signal, output cap, and signal validation as the
 * daemon worker. Process crashes and environment scheduling remain integration
 * concerns for PluginHostManager tests.
 */
declare function experimental_createHostEntryHarness<Contract extends ExperimentalHostRpcContract>(entry: ExperimentalHostEntry<Contract>, options?: ExperimentalCreateHostEntryHarnessOptions): ExperimentalHostEntryHarness<Contract>;

export { experimental_createHostEntryHarness };
export type { ExperimentalCreateHostEntryHarnessOptions, ExperimentalHostEntryHarness, ExperimentalHostHarnessSignal };
