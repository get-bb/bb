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
  if (!host || host.destroyedAt !== null) return [];
  const primaryHostId = readPrimaryHostIdFromDataDir({
    dataDir: deps.config.dataDir,
  });
  const builtIn =
    primaryHostId !== null &&
    primaryHostId !== context.hostId &&
    getAppSettings(deps.db).machineGitCredentialsEnabled
      ? await resolveGitCredentials()
      : [];
  const [global, project] = await Promise.all([
    resolveUserMachineEnvironment(deps.db, deps.config.dataDir),
    context.projectId === null
      ? []
      : resolveUserMachineEnvironment(
          deps.db,
          deps.config.dataDir,
          context.projectId,
        ),
  ]);
  const user = mergeHostAndProviderEnvironment(global, project);
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
