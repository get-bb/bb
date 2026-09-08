import { machineGitHealth } from "./git-credentials.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { eq, like } from "drizzle-orm";
import { appSettingsValues, getAppSettings, type DbConnection } from "@bb/db";
import { deleteSecretFile, writeSecretFile } from "@bb/secret-storage";
import {
  machineEnvironmentNameSchema,
  machineEnvironmentVariableSchema,
  type MachineEnvironmentSet,
  type MachineEnvironmentVariable,
} from "@bb/server-contract";
import type { HostDaemonContributedEnvEntry } from "@bb/host-daemon-contract";

const prefix = "machineEnvironment:";
const locks = new WeakMap<DbConnection, Map<string, Promise<void>>>();

function secretPath(dataDir: string, name: string): string {
  return join(
    dataDir,
    "secrets",
    "machine-environment",
    machineEnvironmentNameSchema.parse(name),
  );
}

export function listMachineEnvironment(
  db: DbConnection,
): MachineEnvironmentVariable[] {
  return db
    .select({ value: appSettingsValues.value })
    .from(appSettingsValues)
    .where(like(appSettingsValues.key, `${prefix}%`))
    .orderBy(appSettingsValues.key)
    .all()
    .map((row) =>
      machineEnvironmentVariableSchema.parse(JSON.parse(row.value)),
    );
}

export async function updateMachineEnvironment(
  db: DbConnection,
  dataDir: string,
  name: string,
  input: MachineEnvironmentSet | null,
): Promise<void> {
  name = machineEnvironmentNameSchema.parse(name);
  let pending = locks.get(db);
  if (!pending) {
    pending = new Map();
    locks.set(db, pending);
  }
  const previous = pending.get(name) ?? Promise.resolve();
  const current = previous
    .catch(() => {})
    .then(async () => {
      const path = secretPath(dataDir, name);
      if (input === null) {
        db.delete(appSettingsValues)
          .where(eq(appSettingsValues.key, prefix + name))
          .run();
        await deleteSecretFile(path);
        return;
      }
      const secret = input.secret || name === "GH_TOKEN";
      if (secret) await writeSecretFile(path, input.value);
      const value = JSON.stringify({
        name,
        value: secret ? null : input.value,
        secret,
        note: input.note,
      });
      const updatedAt = Date.now();
      db.insert(appSettingsValues)
        .values({ key: prefix + name, value, updatedAt })
        .onConflictDoUpdate({
          target: appSettingsValues.key,
          set: { value, updatedAt },
        })
        .run();
      if (!secret) await deleteSecretFile(path);
    });
  pending.set(name, current);
  try {
    await current;
  } finally {
    if (pending.get(name) === current) pending.delete(name);
  }
}

export async function resolveUserMachineEnvironment(
  db: DbConnection,
  dataDir: string,
): Promise<HostDaemonContributedEnvEntry[]> {
  const rows = listMachineEnvironment(db);
  return Promise.all(
    rows.map(async (row) => {
      let value = row.value;
      if (row.secret) {
        try {
          value = await readFile(secretPath(dataDir, row.name), "utf8");
        } catch {
          throw new Error(
            `Machine environment secret ${row.name} is unavailable; set it again`,
          );
        }
      }
      if (value === null)
        throw new Error(
          `Machine environment variable ${row.name} has no value`,
        );
      return {
        name: row.name,
        value,
        secret: row.secret,
        reason: row.note ?? "Machine environment setting",
        source: { core: "machine-environment" },
      };
    }),
  );
}

export async function machineEnvironmentView(db: DbConnection) {
  const variables = listMachineEnvironment(db);
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

export async function effectiveMachineGitHealth(db: DbConnection) {
  const view = await machineEnvironmentView(db);
  return {
    status: ["not logged in", "disabled"].includes(view.builtInGit.status)
      ? ("not configured" as const)
      : ("ready" as const),
    statusMessage: view.builtInGit.statusMessage,
  };
}
