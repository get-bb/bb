import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { AgentEnvironment } from "./rpc-types.js";

type EnvironmentProvidersApi = {
  sdk: {
    environments: Pick<BbPluginApi["sdk"]["environments"], "listProviders">;
  };
};

export async function assertProviderEnvironmentRunnable(
  bb: EnvironmentProvidersApi,
  projectId: string,
  environment: AgentEnvironment,
): Promise<void> {
  if (environment.type !== "provider") return;
  const providerId = environment.environmentProviderId;
  const provider = (await bb.sdk.environments.listProviders({ projectId })).find(
    (candidate) => candidate.id === providerId,
  );
  if (provider === undefined) {
    throw new Error(`The ${providerId} environment provider is not installed.`);
  }
  const machine = environment.machine;
  if (provider.machineProviderId !== null) {
    if (
      machine !== undefined &&
      (machine.type !== "new" ||
        machine.machineProviderId !== provider.machineProviderId)
    ) {
      throw new Error(
        `The ${providerId} environment provider creates its own new ${provider.machineProviderId} machine for each run, so it takes no other machine.`,
      );
    }
    return;
  }
  if (machine === undefined) {
    throw new Error(
      `The ${providerId} environment provider needs a machine: an existing one, or a new one from a machine provider.`,
    );
  }
}
