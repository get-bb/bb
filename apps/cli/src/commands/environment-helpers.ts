import {
  type EnvironmentDisplayInfo,
  formatEnvironmentDisplay,
} from "@bb/core-ui";
import type { BbSdk } from "@bb/sdk";

export interface ThreadEnvironmentInfo {
  display: EnvironmentDisplayInfo;
  hostId: string;
}

export async function fetchEnvironmentInfo(args: {
  environmentId: string;
  sdk: BbSdk;
}): Promise<ThreadEnvironmentInfo | null> {
  try {
    const env = await args.sdk.environments.get({
      environmentId: args.environmentId,
    });
    return {
      display: formatEnvironmentDisplay({
        environment: env,
        host: {
          locality: "local",
        },
      }),
      hostId: env.hostId,
    };
  } catch {
    return null;
  }
}

export function printEnvironmentInfo(env: ThreadEnvironmentInfo): void {
  console.log(`  Environment: ${env.display.modeLabel} (${env.display.id})`);
}
