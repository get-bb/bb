import type { Host } from "@bb/domain";
import {
  type EnvironmentDisplayInfo,
  formatEnvironmentDisplay,
} from "@bb/core-ui";
import type { BbSdk } from "@bb/sdk";
import { fetchLocalHostId } from "../daemon.js";

export interface ThreadEnvironmentInfo {
  display: EnvironmentDisplayInfo;
  hostId: string;
  hostName: string | null;
  isLocalHost: boolean;
}

async function fetchHost(args: {
  hostId: string;
  sdk: BbSdk;
}): Promise<Host | null> {
  try {
    return await args.sdk.hosts.get({ hostId: args.hostId });
  } catch {
    return null;
  }
}

export async function fetchEnvironmentInfo(args: {
  environmentId: string;
  sdk: BbSdk;
}): Promise<ThreadEnvironmentInfo | null> {
  try {
    const [env, localHostId] = await Promise.all([
      args.sdk.environments.get({ environmentId: args.environmentId }),
      fetchLocalHostId(),
    ]);
    const host = await fetchHost({
      hostId: env.hostId,
      sdk: args.sdk,
    });
    const isLocal = env.hostId === localHostId;
    return {
      display: formatEnvironmentDisplay({
        environment: env,
        isLocalHost: isLocal,
        hostName: host?.name,
      }),
      hostId: env.hostId,
      hostName: host?.name ?? null,
      isLocalHost: isLocal,
    };
  } catch {
    return null;
  }
}

export function printEnvironmentInfo(env: ThreadEnvironmentInfo): void {
  const hostLabel = env.hostName ?? env.hostId;
  const hostSuffix = env.isLocalHost ? " (localhost)" : "";
  console.log(`  Host: ${hostLabel}${hostSuffix} (${env.hostId})`);
  console.log(`  Environment: ${env.display.modeLabel} (${env.display.id})`);
}
