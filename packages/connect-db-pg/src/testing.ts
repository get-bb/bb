import { rmSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Socket, createServer } from "node:net";
import { PGlite } from "@electric-sql/pglite";
import { type ConnectDb, schema } from "@bb/connect-db";
import { getTableName } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { applyConnectDbMigrations } from "./migrate.js";
import type { PgQueryable } from "./pg-client.js";

const INT8_OID = 20;

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

const SSL_REQUEST = 80_877_103;
const GSS_REQUEST = 80_877_104;
const BATCH_END = new Set(["S", "Q"]);

interface WireJob {
  connection: number;
  bytes: Uint8Array;
  write(data: Uint8Array): void;
  done(): void;
}

function wireSession(pglite: PGlite) {
  const jobs: WireJob[] = [];
  let owner: number | null = null;
  let running = false;
  const next = (): WireJob | undefined => {
    if (owner === null) return jobs.shift();
    const index = jobs.findIndex((job) => job.connection === owner);
    return index === -1 ? undefined : jobs.splice(index, 1)[0];
  };
  const pump = async () => {
    if (running) return;
    running = true;
    try {
      for (let job = next(); job; job = next()) {
        const current = job;
        await pglite.execProtocolRawStream(current.bytes, {
          onRawData: (data) => current.write(data),
        });
        owner = pglite.isInTransaction() ? current.connection : null;
        current.done();
      }
    } finally {
      running = false;
    }
  };
  return {
    run(job: WireJob) {
      jobs.push(job);
      void pump();
    },
    async release(connection: number) {
      for (let index = jobs.length - 1; index >= 0; index -= 1) {
        if (jobs[index]?.connection === connection) jobs.splice(index, 1);
      }
      if (owner === connection) {
        owner = null;
        await pglite.exec("ROLLBACK");
      }
      void pump();
    },
  };
}

interface WireServer {
  port: number;
  close(): Promise<void>;
}

function servePglite(pglite: PGlite): Promise<WireServer> {
  const session = wireSession(pglite);
  const sockets = new Set<Socket>();
  let connections = 0;
  const server = createServer((socket) => {
    sockets.add(socket);
    const connection = (connections += 1);
    let buffered = Buffer.alloc(0);
    let pending: Buffer[] = [];
    let started = false;
    let queue = Promise.resolve();
    const send = (bytes: Buffer) => {
      queue = queue.then(
        () =>
          new Promise<void>((resolve) =>
            session.run({
              connection,
              bytes: new Uint8Array(bytes),
              write: (data) => {
                if (socket.writable) socket.write(data);
              },
              done: resolve,
            }),
          ),
      );
    };
    socket.on("data", (chunk) => {
      buffered = Buffer.concat([buffered, chunk]);
      while (buffered.length > 0) {
        if (!started) {
          if (buffered.length < 8) return;
          const length = buffered.readInt32BE(0);
          if (buffered.length < length) return;
          const code = buffered.readInt32BE(4);
          const message = buffered.subarray(0, length);
          buffered = buffered.subarray(length);
          if (code === SSL_REQUEST || code === GSS_REQUEST) {
            socket.write("N");
            continue;
          }
          started = true;
          send(Buffer.from(message));
          continue;
        }
        if (buffered.length < 5) return;
        const length = 1 + buffered.readInt32BE(1);
        if (buffered.length < length) return;
        const type = String.fromCharCode(buffered[0] ?? 0);
        const message = buffered.subarray(0, length);
        buffered = buffered.subarray(length);
        if (type === "X") {
          socket.end();
          return;
        }
        pending.push(Buffer.from(message));
        if (BATCH_END.has(type)) {
          send(Buffer.concat(pending));
          pending = [];
        }
      }
    });
    socket.on("error", () => socket.destroy());
    socket.on("close", () => {
      sockets.delete(socket);
      void queue.then(() => session.release(connection));
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("test database server has no TCP address"));
        return;
      }
      resolve({
        port: address.port,
        close: () =>
          new Promise<void>((done) => {
            for (const socket of sockets) socket.destroy();
            server.close(() => done());
          }),
      });
    });
  });
}

export interface ServedTestConnectDb extends TestConnectDb {
  connectionString: string;
}

export async function serveTestConnectDb(): Promise<ServedTestConnectDb> {
  const database = await createTestConnectDb();
  const server = await servePglite(database.pglite);
  return {
    ...database,
    connectionString: `postgresql://postgres:postgres@127.0.0.1:${server.port}/postgres`,
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
