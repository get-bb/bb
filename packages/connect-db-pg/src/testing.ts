import { builtinModules } from "node:module";
import { PGlite } from "@electric-sql/pglite";
import {
  type PgQueryable,
  type SqlBackend,
  pgBackend,
} from "@bb/connect-db/store";
import { applyConnectDbPgMigrations } from "./migrate.js";

const INT8_OID = 20;

export interface PgliteConnectDb {
  pglite: PGlite;
  queryable: PgQueryable;
  backend: SqlBackend;
  close(): Promise<void>;
}

export function pgliteQueryable(pglite: PGlite): PgQueryable {
  return {
    async queryArrays(text, params) {
      const result = await pglite.query<unknown[]>(text, [...params], {
        rowMode: "array",
        parsers: { [INT8_OID]: (value: string) => Number(value) },
      });
      return { rows: result.rows, rowCount: result.affectedRows ?? 0 };
    },
  };
}

let migratedDataDir: Promise<Blob> | undefined;

async function createMigratedDataDir(): Promise<Blob> {
  const pglite = new PGlite();
  try {
    await applyConnectDbPgMigrations(pgliteQueryable(pglite));
    return await pglite.dumpDataDir("none");
  } finally {
    await pglite.close();
  }
}

export async function createMigratedPglite(): Promise<PgliteConnectDb> {
  const pglite = new PGlite({
    loadDataDir: await (migratedDataDir ??= createMigratedDataDir()),
  });
  await pglite.waitReady;
  const queryable = pgliteQueryable(pglite);
  return {
    pglite,
    queryable,
    backend: pgBackend(queryable),
    close: () => pglite.close(),
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
