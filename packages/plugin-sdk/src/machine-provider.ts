import type {
  JsonValue,
  PluginMachineValidateDecision,
  StandardSchemaV1,
  StandardSchemaV1InferOutput,
} from "@get-bb/plugin-sdk";

export type PluginMachineProviderInputsSchema = StandardSchemaV1 | undefined;
type InputsValue<S> = S extends StandardSchemaV1
  ? StandardSchemaV1InferOutput<S>
  : null;
export interface PluginMachineProviderProgress {
  step(text: string): void;
  log(text: string): void;
}

export type PluginMachineProviderAvailability =
  | { status: "available" }
  | { status: "setup-required"; message: string }
  | { status: "unavailable"; message: string };

export type PluginMachineProviderValidateContext<
  S extends PluginMachineProviderInputsSchema =
    PluginMachineProviderInputsSchema,
> = {
  inputs: InputsValue<S>;
};

export interface PluginMachineProviderLifecycleContext {
  checkpoint(resource: JsonValue): Promise<void>;
  report: PluginMachineProviderProgress;
  signal: AbortSignal;
}

export type PluginMachineProviderCreateContext<
  S extends PluginMachineProviderInputsSchema =
    PluginMachineProviderInputsSchema,
> = PluginMachineProviderValidateContext<S> &
  PluginMachineProviderLifecycleContext & {
    key: string;
    attempt: number;
  };

export type PluginMachineProviderCreateResult =
  | { status: "created"; name: string; resource: JsonValue }
  | { status: "failed"; message: string };

type PluginMachineProviderResourceLifecycleContext =
  PluginMachineProviderLifecycleContext & {
    hostId: string;
    resource: JsonValue;
  };

type PluginMachineProviderRemoveContext = Omit<
  PluginMachineProviderResourceLifecycleContext,
  "checkpoint"
>;

export interface PluginMachineProviderResourceResult {
  resource: JsonValue;
}

export type PluginMachineProviderRemoveResult =
  | { status: "removed" }
  | { status: "failed"; message: string };

export interface PluginMachineProviderDefinition<
  S extends PluginMachineProviderInputsSchema =
    PluginMachineProviderInputsSchema,
> {
  id: string;
  displayName: string;
  /** One line telling a user what choosing this provider gets them, shown wherever a machine is added. */
  description: string;
  /** Provider glyph, declared icon, or plugin-relative icon path. */
  icon: string;
  ephemeral?: boolean;
  /** Persisted and readable by every plugin. Store secret references, never secrets. */
  inputs?: S;
  availability?():
    | PluginMachineProviderAvailability
    | Promise<PluginMachineProviderAvailability>;
  validate?(
    context: PluginMachineProviderValidateContext<S>,
  ): PluginMachineValidateDecision | Promise<PluginMachineValidateDecision>;
  create(
    context: PluginMachineProviderCreateContext<S>,
  ): Promise<PluginMachineProviderCreateResult>;
  /** Reconcile and remove an uncertain allocation by durable key without creating or bootstrapping. Return failed while allocation intent remains unresolved. */
  reconcileCleanup(context: {
    key: string;
    resource: JsonValue | null;
    report: PluginMachineProviderProgress;
    signal: AbortSignal;
  }): Promise<PluginMachineProviderRemoveResult>;
  suspend?(
    context: PluginMachineProviderResourceLifecycleContext,
  ): Promise<PluginMachineProviderResourceResult>;
  resume?(
    context: PluginMachineProviderResourceLifecycleContext,
  ): Promise<PluginMachineProviderResourceResult>;
  remove(
    context: PluginMachineProviderRemoveContext,
  ): Promise<PluginMachineProviderRemoveResult>;
}
