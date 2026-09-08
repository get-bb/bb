import { getAppSettings, getHost } from "@bb/db";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HOST_ID_FILE_NAME } from "@bb/host-daemon-contract";
import { resolveUserMachineEnvironment } from "../machines/environment-settings.js";
import type { AppDeps } from "../../types.js";
import type { HostDaemonContributedEnvEntry } from "@bb/host-daemon-contract";
import {
  githubGitConfiguration,
  resolveGitCredentials,
} from "../machines/git-credentials.js";

type HostEnvironmentContext = { hostId: string; projectId: string | null };
type HostEnvironmentContributor = (
  context: HostEnvironmentContext,
) => Promise<HostDaemonContributedEnvEntry[]>;

const contributors: readonly HostEnvironmentContributor[] = [
  () => resolveGitCredentials(),
];

export async function resolveHostEnvironment(
  deps: { db: AppDeps["db"]; config: Pick<AppDeps["config"], "dataDir"> },
  context: HostEnvironmentContext,
): Promise<HostDaemonContributedEnvEntry[]> {
  const host = getHost(deps.db, context.hostId);
  if (!host || host.machineProviderId === null || host.destroyedAt !== null)
    return [];
  try {
    if (
      readFileSync(
        join(deps.config.dataDir, HOST_ID_FILE_NAME),
        "utf8",
      ).trim() === context.hostId
    )
      return [];
  } catch {}
  const resolved = getAppSettings(deps.db).machineGitCredentialsEnabled
    ? await Promise.all(contributors.map((resolve) => resolve(context)))
    : [];
  const builtIn = resolved.flat();
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
