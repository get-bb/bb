import type { SystemEnvironmentProvider } from "@bb/server-contract";
import { createCliBbSdk } from "../client.js";

export const COMPOSITION_MACHINE_SELECTOR_ERROR =
  "This environment provider chooses its own new machine; omit machine selectors.";

export type EnvironmentProviderTarget =
  | {
      kind: "composition";
      machineProviderId: string;
      provider: SystemEnvironmentProvider;
    }
  | { kind: "existing-machine"; provider: SystemEnvironmentProvider };

export async function findEnvironmentProviderTarget(args: {
  environmentProviderId: string;
  projectId: string | null;
  serverUrl: string;
}): Promise<EnvironmentProviderTarget> {
  const requested = args.environmentProviderId.trim();
  const providers = await createCliBbSdk(
    args.serverUrl,
  ).environments.listProviders(
    args.projectId === null ? {} : { projectId: args.projectId },
  );
  const provider = providers.find((candidate) => candidate.id === requested);
  if (provider === undefined) {
    const available = providers.map((candidate) => candidate.id).join(", ");
    throw new Error(
      `Unknown environment provider '${requested}'.${available ? ` Available: ${available}.` : ""}`,
    );
  }
  return provider.machineProviderId
    ? {
        kind: "composition",
        machineProviderId: provider.machineProviderId,
        provider,
      }
    : { kind: "existing-machine", provider };
}
