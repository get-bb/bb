import {
  type EnvironmentDisplayInfo,
  type EnvironmentDisplayProviderLookup,
  formatEnvironmentDisplay,
} from "@bb/core-ui";
import type { Environment } from "@bb/domain";
import type { BbSdk } from "@bb/sdk";

export interface ThreadEnvironmentInfo {
  display: EnvironmentDisplayInfo;
  hostId: string;
}

async function resolveEnvironmentProvider(args: {
  environmentProviderId: string | null;
  sdk: BbSdk;
}): Promise<EnvironmentDisplayProviderLookup> {
  if (args.environmentProviderId === null) {
    return { status: "loaded", provider: null };
  }
  const providers = await args.sdk.environments.listProviders();
  const provider = providers.find(
    (candidate) => candidate.id === args.environmentProviderId,
  );
  return {
    status: "loaded",
    provider:
      provider === undefined
        ? null
        : {
            id: provider.id,
            displayName: provider.displayName,
            icon: provider.icon,
          },
  };
}

export async function fetchEnvironmentInfo(args: {
  environment: Environment;
  sdk: BbSdk;
}): Promise<ThreadEnvironmentInfo | null> {
  try {
    return {
      display: formatEnvironmentDisplay({
        environment: args.environment,
        host: {
          locality: "local",
          identity: null,
        },
        providerLookup: await resolveEnvironmentProvider({
          environmentProviderId: args.environment.environmentProviderId,
          sdk: args.sdk,
        }),
      }),
      hostId: args.environment.hostId,
    };
  } catch {
    return null;
  }
}

export function printEnvironmentInfo(env: ThreadEnvironmentInfo): void {
  console.log(`  Environment: ${env.display.modeLabel} (${env.display.id})`);
}
