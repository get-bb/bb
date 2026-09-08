import { machineGitHealth } from "./git-credentials.js";
import { getAppSettings, type DbConnection } from "@bb/db";
import {
  readMachineEnvironment,
  decryptMachineEnvironment,
} from "./environment-storage.js";
import type { HostDaemonContributedEnvEntry } from "@bb/host-daemon-contract";

export { updateMachineEnvironment } from "./environment-storage.js";

export async function resolveUserMachineEnvironment(
  db: DbConnection,
  dataDir: string,
): Promise<HostDaemonContributedEnvEntry[]> {
  const rows = await readMachineEnvironment(db, dataDir);
  return Promise.all(
    rows.map(async (row) => ({
      name: row.name,
      value: await decryptMachineEnvironment(dataDir, row),
      secret: true,
      reason: row.note ?? "Machine environment setting",
      source: { core: "machine-environment" },
    })),
  );
}

export async function machineEnvironmentView(
  db: DbConnection,
  dataDir: string,
) {
  const variables = (await readMachineEnvironment(db, dataDir)).map((row) => ({
    name: row.name,
    value: null,
    secret: true as const,
    note: row.note,
  }));
  const overridden = variables.some((row) => row.name === "GH_TOKEN");
  const enabled = getAppSettings(db).machineGitCredentialsEnabled;
  const health =
    overridden || !enabled
      ? {
          status: "ready",
          statusMessage:
            "The built-in gh token is overridden by Machine environment.",
        }
      : await machineGitHealth();
  return {
    variables,
    builtInGit: {
      status: overridden
        ? ("overridden" as const)
        : !enabled
          ? ("disabled" as const)
          : health.status === "ready"
            ? ("logged in" as const)
            : ("not logged in" as const),
      statusMessage:
        !enabled && !overridden
          ? "Automatic GitHub credentials are disabled."
          : health.statusMessage,
    },
  };
}

export async function effectiveMachineGitHealth(
  db: DbConnection,
  dataDir: string,
) {
  const view = await machineEnvironmentView(db, dataDir);
  return {
    status: ["not logged in", "disabled"].includes(view.builtInGit.status)
      ? ("not configured" as const)
      : ("ready" as const),
    statusMessage: view.builtInGit.statusMessage,
  };
}
