import { mkdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { applyConnectDbMigrations } from "./migrate.js";
import { pgliteQueryable } from "./pglite.js";
import { servePglite } from "./wire-server.js";

export interface CloudDevDatabaseOptions {
  dataDir: string;
  port: number;
  host?: string;
  onError?(error: unknown): void;
}

export interface CloudDevDatabase {
  connectionString: string;
  applied: string[];
  close(): Promise<void>;
}

function addressInUse(error: unknown): boolean {
  return (
    error instanceof Error && "code" in error && error.code === "EADDRINUSE"
  );
}

export async function startCloudDevDatabase(
  options: CloudDevDatabaseOptions,
): Promise<CloudDevDatabase> {
  const host = options.host ?? "127.0.0.1";
  await mkdir(options.dataDir, { recursive: true });
  const pglite = new PGlite({ dataDir: options.dataDir });
  try {
    await pglite.waitReady;
    const applied = await applyConnectDbMigrations(pgliteQueryable(pglite));
    const server = await servePglite(pglite, {
      host,
      port: options.port,
      onError: options.onError,
    }).catch((error: unknown) => {
      if (!addressInUse(error)) throw error;
      throw new Error(
        `local Postgres port ${host}:${options.port} is already in use; stop whatever holds it or set BB_CLOUD_DEV_DATABASE_URL to use another database`,
        { cause: error },
      );
    });
    return {
      connectionString: server.connectionString,
      applied,
      async close() {
        await server.close();
        await pglite.close();
      },
    };
  } catch (error) {
    await pglite.close().catch(() => undefined);
    throw error;
  }
}
