import { rmSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { type ConnectDb, schema } from "@bb/connect-db";
import { getTableName } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { applyConnectDbMigrations } from "./migrate.js";
import type { PgQueryable } from "./pg-client.js";
import { pgliteQueryable } from "./pglite.js";
import { servePglite } from "./wire-server.js";

export { pgliteQueryable };

const SCHEMA_FINGERPRINT = `SELECT md5(
  coalesce((SELECT string_agg(table_name || '.' || column_name || ':' || data_type || ':' || is_nullable, ',' ORDER BY table_name, column_name)
    FROM information_schema.columns WHERE table_schema = 'public'), '')
  || coalesce((SELECT string_agg(tgname, ',' ORDER BY tgname) FROM pg_trigger WHERE NOT tgisinternal), '')
) AS fingerprint`;

const DATA_TABLES = Object.values(schema)
  .map((table) => `"${getTableName(table)}"`)
  .join(", ");

const TEMPLATE_PATH_ENV = "BB_TEST_CONNECT_DB_TEMPLATE";

let template: Promise<Blob> | null = null;
let templateFingerprint: string | null = null;
const idle: PGlite[] = [];

async function fingerprint(pglite: PGlite): Promise<string> {
  const { rows } = await pglite.query<{ fingerprint: string }>(
    SCHEMA_FINGERPRINT,
  );
  return rows[0]?.fingerprint ?? "";
}

async function buildTemplate(): Promise<Blob> {
  const pglite = new PGlite();
  try {
    await applyConnectDbMigrations(pgliteQueryable(pglite));
    return await pglite.dumpDataDir("none");
  } finally {
    await pglite.close();
  }
}

function migratedTemplate(): Promise<Blob> {
  template ??= (async () => {
    const path = process.env[TEMPLATE_PATH_ENV];
    if (path === undefined) return buildTemplate();
    return new Blob([await readFile(path)]);
  })();
  return template;
}

export async function setupTestConnectDbTemplate(): Promise<() => void> {
  const path = join(tmpdir(), `bb-connect-db-template-${process.pid}.tar`);
  await writeFile(
    path,
    Buffer.from(await (await buildTemplate()).arrayBuffer()),
  );
  process.env[TEMPLATE_PATH_ENV] = path;
  return () => {
    delete process.env[TEMPLATE_PATH_ENV];
    rmSync(path, { force: true });
  };
}

async function reusable(pglite: PGlite): Promise<boolean> {
  try {
    await pglite.exec("ROLLBACK");
    if ((await fingerprint(pglite)) !== templateFingerprint) return false;
    await pglite.exec(`TRUNCATE ${DATA_TABLES} CASCADE`);
    return true;
  } catch {
    return false;
  }
}

async function migratedPglite(): Promise<PGlite> {
  for (let pglite = idle.pop(); pglite; pglite = idle.pop()) {
    if (await reusable(pglite)) return pglite;
    await pglite.close().catch(() => undefined);
  }
  const pglite = new PGlite({ loadDataDir: await migratedTemplate() });
  await pglite.waitReady;
  templateFingerprint ??= await fingerprint(pglite);
  return pglite;
}

export interface TestConnectDb {
  db: ConnectDb;
  pglite: PGlite;
  queryable: PgQueryable;
  close(): Promise<void>;
}

export async function createTestConnectDb(): Promise<TestConnectDb> {
  const pglite = await migratedPglite();
  let released = false;
  return {
    db: drizzle({ client: pglite, schema }),
    pglite,
    queryable: pgliteQueryable(pglite),
    async close() {
      if (released) return;
      released = true;
      idle.push(pglite);
    },
  };
}

export interface ServedTestConnectDb extends TestConnectDb {
  connectionString: string;
}

export async function serveTestConnectDb(): Promise<ServedTestConnectDb> {
  const database = await createTestConnectDb();
  const server = await servePglite(database.pglite);
  return {
    ...database,
    connectionString: server.connectionString,
    async close() {
      await server.close();
      await database.pglite.close();
    },
  };
}

interface BundlerPluginBuild {
  onResolve(
    options: { filter: RegExp },
    callback: (args: { path: string; namespace: string }) => {
      path: string;
      namespace?: string;
      external?: boolean;
    },
  ): void;
  onLoad(
    options: { filter: RegExp; namespace: string },
    callback: (args: { path: string }) => { contents: string; loader: "js" },
  ): void;
}

const BUILTIN_PATTERN = new RegExp(`^(node:)?(${builtinModules.join("|")})$`);

export const workerNodeBuiltinsPlugin = {
  name: "worker-node-builtins",
  setup(build: BundlerPluginBuild) {
    build.onResolve({ filter: new RegExp("^cloudflare:") }, (args) => ({
      path: args.path,
      external: true,
    }));
    build.onResolve({ filter: BUILTIN_PATTERN }, (args) =>
      args.namespace === "worker-node-builtin"
        ? { path: args.path, external: true }
        : {
            path: args.path.replace(/^node:/u, ""),
            namespace: "worker-node-builtin",
          },
    );
    build.onLoad(
      { filter: new RegExp(".*"), namespace: "worker-node-builtin" },
      (args) => ({
        contents: `export * from "node:${args.path}";\nexport { default } from "node:${args.path}";\n`,
        loader: "js",
      }),
    );
  },
};
