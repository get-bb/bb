import type {
  MachineExecutor,
  PluginMachineValidateDecision,
  StandardSchemaV1,
} from "@get-bb/plugin-sdk";
import type {
  PluginMachineProviderAvailability,
  PluginMachineProviderProgress,
  PluginMachineProviderResource,
} from "@get-bb/plugin-sdk/machine-provider";

export interface SandboxOperationContext {
  report: PluginMachineProviderProgress;
  signal: AbortSignal;
}

export interface SandboxCheckpointContext<
  Resource extends PluginMachineProviderResource,
> extends SandboxOperationContext {
  checkpoint(resource: Resource): Promise<void>;
}

export interface SandboxCreateContext<
  Inputs,
  Resource extends PluginMachineProviderResource,
> extends SandboxCheckpointContext<Resource> {
  key: string;
  attempt: number;
  inputs: Inputs;
}

export interface SandboxLifecycleContext<
  Resource extends PluginMachineProviderResource,
> extends SandboxCheckpointContext<Resource> {
  hostId: string;
  resource: Resource;
}

export interface SandboxResourceContext<
  Resource extends PluginMachineProviderResource,
> extends SandboxOperationContext {
  hostId: string;
  resource: Resource;
}

export interface SandboxBackendDefinition<Inputs> {
  id: string;
  displayName: string;
  description: string;
  environmentDescription: string;
  runtimeName: string;
  icon: string;
  ephemeral: boolean;
  inputs: StandardSchemaV1<unknown, Inputs>;
}

export interface SandboxBackend<
  Inputs,
  Resource extends PluginMachineProviderResource,
> {
  definition: SandboxBackendDefinition<Inputs>;
  parseInputs(value: unknown): Inputs;
  parseResource(value: PluginMachineProviderResource): Resource;
  allocationKey(resource: Resource): string;
  availability(): Promise<PluginMachineProviderAvailability>;
  validate(inputs: Inputs): Promise<PluginMachineValidateDecision>;
  create(
    context: SandboxCreateContext<Inputs, Resource>,
  ): Promise<{ resource: Resource; executor: MachineExecutor }>;
  reconcileCleanup(
    context: SandboxOperationContext & { key: string },
  ): Promise<void>;
  suspend(context: SandboxLifecycleContext<Resource>): Promise<Resource>;
  resume(
    context: SandboxLifecycleContext<Resource>,
  ): Promise<{ resource: Resource; executor: MachineExecutor }>;
  remove(context: SandboxResourceContext<Resource>): Promise<void>;
  displayName(context: { hostId: string; resource: Resource }): string;
  close(): void | Promise<void>;
}
