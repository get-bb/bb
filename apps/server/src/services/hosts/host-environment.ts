import { getAppSettings, getHost } from "@bb/db";
import { resolveUserMachineEnvironment } from "../machines/environment-settings.js";
import type { AppDeps } from "../../types.js";
import type { HostDaemonContributedEnvEntry } from "@bb/host-daemon-contract";
import {
  githubGitConfiguration,
  resolveGitCredentials,
} from "../machines/git-credentials.js";
import { readPrimaryHostIdFromDataDir } from "./primary-host.js";

type HostEnvironmentContext = { hostId: string; projectId: string | null };

export async function resolveHostEnvironment(
  deps: { db: AppDeps["db"]; config: Pick<AppDeps["config"], "dataDir"> },
  context: HostEnvironmentContext,
): Promise<HostDaemonContributedEnvEntry[]> {
  const host = getHost(deps.db, context.hostId);
  if (!host || host.machineProviderId === null || host.destroyedAt !== null)
    return [];
  if (
    readPrimaryHostIdFromDataDir({ dataDir: deps.config.dataDir }) ===
    context.hostId
  )
    return [];
  const builtIn = getAppSettings(deps.db).machineGitCredentialsEnabled
    ? await resolveGitCredentials()
    : [];
  const user = await resolveUserMachineEnvironment(
    deps.db,
    deps.config.dataDir,
  );
  if (!builtIn.length && user.some((entry) => entry.name === "GH_TOKEN"))
    builtIn.push(...githubGitConfiguration());
  return mergeHostAndProviderEnvironment(builtIn, user);
}

export function mergeHostAndProviderEnvironment(
  host: readonly HostDaemonContributedEnvEntry[],
  provider: readonly HostDaemonContributedEnvEntry[],
): HostDaemonContributedEnvEntry[] {
  const providerNames = new Set(provider.map((entry) => entry.name));
  return [
    ...host.filter((entry) => !providerNames.has(entry.name)),
    ...provider,
  ];
}
