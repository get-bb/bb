import type { Project } from "@bb/domain";
import type {
  JsonValue,
  PluginMachineProviderRequirements,
  PluginMachineValidateDecision,
  StandardSchemaV1,
  StandardSchemaV1InferOutput,
} from "@get-bb/plugin-sdk";

export type PluginMachineProviderInputsSchema = StandardSchemaV1 | undefined;
type InputsValue<S> = S extends StandardSchemaV1
  ? StandardSchemaV1InferOutput<S>
  : null;
type ProjectFacts<R extends PluginMachineProviderRequirements> =
  | { project: null; gitRemote: null }
  | (R extends Record<"gitRemote", true>
      ? { project: Project; gitRemote: string }
      : { project: Project; gitRemote: string | null });

export interface PluginMachineProviderProgress {
  step(text: string): void;
  log(text: string): void;
}

export interface PluginMachineProviderAvailabilityContext {
  project: Project | null;
  gitRemote: string | null;
}

export type PluginMachineProviderAvailability =
  | { status: "available" }
  | { status: "setup-required"; message: string }
  | { status: "unavailable"; message: string };

export type PluginMachineProviderValidateContext<
  R extends PluginMachineProviderRequirements =
    PluginMachineProviderRequirements,
  S extends PluginMachineProviderInputsSchema =
    PluginMachineProviderInputsSchema,
> = ProjectFacts<R> & {
  inputs: InputsValue<S>;
};

export type PluginMachineProviderCreateContext<
  R extends PluginMachineProviderRequirements =
    PluginMachineProviderRequirements,
  S extends PluginMachineProviderInputsSchema =
    PluginMachineProviderInputsSchema,
> = PluginMachineProviderValidateContext<R, S> & {
  key: string;
  attempt: number;
  /** Persist an allocated resource after preparing enrollment, before bootstrap. Never include a bootstrap bundle. */
  checkpoint(resource: JsonValue): Promise<void>;
  report: PluginMachineProviderProgress;
  signal: AbortSignal;
};

export type PluginMachineProviderCreateResult =
  | { status: "created"; hostId: string; resource: JsonValue }
  | { status: "failed"; failure: "transient" | "terminal"; message: string };

export interface PluginMachineProviderLifecycleContext {
  hostId: string;
  resource: JsonValue;
  report: PluginMachineProviderProgress;
  signal: AbortSignal;
}

export interface PluginMachineProviderSuspendContext extends PluginMachineProviderLifecycleContext {
  checkpoint(resource: JsonValue): void;
}

export interface PluginMachineProviderResourceResult {
  resource: JsonValue;
}

export type PluginMachineProviderRemoveResult =
  | { status: "removed" }
  | { status: "failed"; message: string };

export interface PluginMachineProviderEnvironmentRow {
  displayName: string;
  environmentProviderId: string;
}

export interface PluginMachineProviderPolicy {
  idleSuspendMs: number | null;
  retire: { after: "last-thread"; graceMs: number } | { after: "never" };
  removeRetryMs: number;
}

export interface PluginMachineProviderDefinition<
  R extends PluginMachineProviderRequirements =
    PluginMachineProviderRequirements,
  S extends PluginMachineProviderInputsSchema =
    PluginMachineProviderInputsSchema,
> {
  id: string;
  displayName: string;
  /** Omit to present provider-created machines like ordinary enrolled machines. */
  icon?: string;
  requires?: R;
  /** Persisted and readable by every plugin. Store secret references, never secrets. */
  inputs?: S;
  availability?(
    context: PluginMachineProviderAvailabilityContext,
  ):
    | PluginMachineProviderAvailability
    | Promise<PluginMachineProviderAvailability>;
  validate?(
    context: PluginMachineProviderValidateContext<R, S>,
  ): PluginMachineValidateDecision | Promise<PluginMachineValidateDecision>;
  environmentRow?: PluginMachineProviderEnvironmentRow;
  policy: PluginMachineProviderPolicy;
  /** Resolve a per-machine idle timeout; core retains activity checks and retirement policy. */
  experimental_idleSuspendMs?(context: {
    hostId: string;
    resource: JsonValue;
  }): Promise<number | null>;
  /** Return provider-owned inventory and estimated costs for machine details. */
  experimental_details?(context: {
    hostId: string;
    resource: JsonValue;
    signal: AbortSignal;
  }): Promise<{ summary: string; values: JsonValue }>;

  create(
    context: PluginMachineProviderCreateContext<R, S>,
  ): Promise<PluginMachineProviderCreateResult>;
  /** Reconcile and remove an uncertain allocation by durable key without creating or bootstrapping. Return failed while allocation intent remains unresolved. */
  experimental_reconcileCleanup(context: {
    key: string;
    report: PluginMachineProviderProgress;
    signal: AbortSignal;
  }): Promise<PluginMachineProviderRemoveResult>;
  suspend?(
    context: PluginMachineProviderSuspendContext,
  ): Promise<PluginMachineProviderResourceResult>;
  resume?(
    context: PluginMachineProviderLifecycleContext,
  ): Promise<PluginMachineProviderResourceResult>;
  remove(
    context: PluginMachineProviderLifecycleContext,
  ): Promise<PluginMachineProviderRemoveResult>;
}
