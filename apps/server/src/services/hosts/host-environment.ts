import { resolveUserMachineEnvironment } from "../machines/environment-settings.js";
import type { AppDeps } from "../../types.js";
import type { HostDaemonContributedEnvEntry } from "@bb/host-daemon-contract";
import {
  isEnrolledMachine,
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
  deps: Pick<AppDeps, "db" | "config">,
  context: HostEnvironmentContext,
): Promise<HostDaemonContributedEnvEntry[]> {
  if (!isEnrolledMachine(deps.db, context.hostId)) return [];
  const resolved = await Promise.all(
    contributors.map((resolve) => resolve(context)),
  );
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
