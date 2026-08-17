// Portable type declarations for `@get-bb/plugin-sdk`. Unpublished BB
// workspace contracts are flattened; public subpaths may reuse the
// package root without requiring any other @bb/* package.
//
// Confused by the API, or need a symbol that isn't here? Clone the BB repo
// and read the real source: https://github.com/get-bb/bb

import { PluginRpcContract, StandardSchemaV1InferInput, StandardSchemaV1InferOutput, ExperimentalHostEntry } from '@get-bb/plugin-sdk';

type HostMethodName<Contract extends PluginRpcContract> = keyof Contract & string;
interface ExperimentalHostEntryHarness<Contract extends PluginRpcContract> {
    /** Invoke one handler through the same validation boundaries as the daemon. */
    experimental_call<MethodName extends HostMethodName<Contract>>(method: MethodName, input: StandardSchemaV1InferInput<Contract[MethodName]["input"]>, options?: {
        readonly signal?: AbortSignal;
    }): Promise<StandardSchemaV1InferOutput<Contract[MethodName]["output"]>>;
    /** Aborted before the entry's dispose hook runs. */
    readonly experimental_lifecycleSignal: AbortSignal;
    /** Abort active calls and run the entry's dispose hook once. */
    experimental_dispose(): Promise<void>;
}
/**
 * Test one host entry in-process with the same validation, JSON transport,
 * cancellation, lifecycle, and output-size boundaries as the daemon worker.
 * Process crashes remain an integration concern for PluginHostManager tests.
 */
declare function experimental_createHostEntryHarness<Contract extends PluginRpcContract>(entry: ExperimentalHostEntry<Contract>): ExperimentalHostEntryHarness<Contract>;

export { experimental_createHostEntryHarness };
export type { ExperimentalHostEntryHarness };
