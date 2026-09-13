import type { BbPluginApi, MachineBootstrapRequest } from "@get-bb/plugin-sdk";
import type { PluginMachineProviderResource } from "@get-bb/plugin-sdk/machine-provider";
import { errorMessage } from "../error-message.js";
import type { SandboxBackend } from "./sandbox-backend.js";

export function registerSandboxBackend<
  Inputs,
  Resource extends PluginMachineProviderResource,
>(
  bb: BbPluginApi,
  backend: SandboxBackend<Inputs, Resource>,
  options: {
    now: () => number;
    onConnected: (hostId: string) => Promise<void>;
  },
): void {
  const definition = backend.definition;

  async function bootstrap(
    request: MachineBootstrapRequest,
  ): Promise<{ hostId: string }> {
    const connectStartedAt = options.now();
    const result = await bb.experimental_machines.bootstrap(request);
    request.report.log(
      `${definition.runtimeName} daemon connected in ${options.now() - connectStartedAt} ms\n`,
    );
    return result;
  }

  bb.experimental_environments.register({
    id: definition.id,
    displayName: definition.displayName,
    description: definition.environmentDescription,
    icon: definition.icon,
    machineProviderId: definition.id,
    environmentProviderId: "project-checkout",
  });

  bb.experimental_machines.register({
    id: definition.id,
    displayName: definition.displayName,
    description: definition.description,
    icon: definition.icon,
    ephemeral: definition.ephemeral,
    inputs: definition.inputs,
    validate({ inputs }) {
      return backend.validate(backend.parseInputs(inputs));
    },
    availability() {
      return backend.availability();
    },
    async create(context) {
      try {
        const created = await backend.create({
          ...context,
          inputs: backend.parseInputs(context.inputs),
        });
        context.signal.throwIfAborted();
        const { hostId } = await bootstrap({
          key: context.key,
          executor: created.executor,
          report: context.report,
          signal: context.signal,
        });
        context.signal.throwIfAborted();
        await options.onConnected(hostId);
        return {
          status: "created",
          name: backend.displayName({ hostId, resource: created.resource }),
          resource: created.resource,
        };
      } catch (error) {
        context.signal.throwIfAborted();
        return { status: "failed", message: errorMessage(error) };
      }
    },
    async reconcileCleanup(context) {
      try {
        await backend.reconcileCleanup(context);
        return { status: "removed" };
      } catch (error) {
        context.signal.throwIfAborted();
        return { status: "failed", message: errorMessage(error) };
      }
    },
    async suspend(context) {
      return {
        resource: await backend.suspend({
          ...context,
          resource: backend.parseResource(context.resource),
        }),
      };
    },
    async resume(context) {
      const resumed = await backend.resume({
        ...context,
        resource: backend.parseResource(context.resource),
      });
      await bootstrap({
        key: backend.allocationKey(resumed.resource),
        executor: resumed.executor,
        report: context.report,
        signal: context.signal,
      });
      await options.onConnected(context.hostId);
      return { resource: resumed.resource };
    },
    async remove(context) {
      try {
        await backend.remove({
          ...context,
          resource: backend.parseResource(context.resource),
        });
        return { status: "removed" };
      } catch (error) {
        context.signal.throwIfAborted();
        return { status: "failed", message: errorMessage(error) };
      }
    },
  });
}
