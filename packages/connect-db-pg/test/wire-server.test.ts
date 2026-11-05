import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { Client } from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { startCloudDevDatabase } from "../src/dev.js";
import { servePglite } from "../src/wire-server.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function served(idleInTransactionTimeoutMs?: number) {
  const pglite = new PGlite();
  await pglite.exec("CREATE TABLE item (id int PRIMARY KEY, label text)");
  const server = await servePglite(pglite, { idleInTransactionTimeoutMs });
  cleanups.push(async () => {
    await server.close();
    await pglite.close();
  });
  return server;
}

async function client(connectionString: string): Promise<Client> {
  const next = new Client({ connectionString });
  next.on("error", () => undefined);
  await next.connect();
  cleanups.push(() => next.end().catch(() => undefined));
  return next;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() =>
        typeof address === "object" && address !== null
          ? resolve(address.port)
          : reject(new Error("no port")),
      );
    });
  });
}

describe("PGlite wire server", () => {
  it("runs parameterized queries from many concurrent clients", async () => {
    const server = await served();
    const clients = await Promise.all(
      Array.from({ length: 8 }, () => client(server.connectionString)),
    );
    await Promise.all(
      clients.map(async (each, index) => {
        for (let step = 0; step < 10; step += 1) {
          await each.query("INSERT INTO item (id, label) VALUES ($1, $2)", [
            index * 100 + step,
            `c${index}`,
          ]);
        }
      }),
    );
    const counts = await Promise.all(
      clients.map((each, index) =>
        each.query<{ count: string }>(
          "SELECT count(*) AS count FROM item WHERE label = $1",
          [`c${index}`],
        ),
      ),
    );
    expect(counts.map((result) => result.rows[0]?.count)).toEqual(
      Array.from({ length: 8 }, () => "10"),
    );
  });

  it("holds other clients until an open transaction ends", async () => {
    const server = await served();
    const writer = await client(server.connectionString);
    const reader = await client(server.connectionString);
    await writer.query("BEGIN");
    await writer.query("INSERT INTO item (id, label) VALUES ($1, $2)", [
      1,
      "pending",
    ]);
    let read = false;
    const seen = reader
      .query<{ label: string }>("SELECT label FROM item WHERE id = $1", [1])
      .then((result) => {
        read = true;
        return result.rows;
      });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(read).toBe(false);
    await writer.query("UPDATE item SET label = $1 WHERE id = $2", [
      "committed",
      1,
    ]);
    await writer.query("COMMIT");
    expect(await seen).toEqual([{ label: "committed" }]);
  });

  it("keeps a failed transaction on its client until it rolls back", async () => {
    const server = await served();
    const writer = await client(server.connectionString);
    const other = await client(server.connectionString);
    await writer.query("BEGIN");
    await expect(writer.query("SELECT * FROM missing")).rejects.toThrow(
      /missing/,
    );
    const pending = other.query("SELECT 1 AS one");
    await expect(writer.query("SELECT 1")).rejects.toThrow(/aborted/);
    await writer.query("ROLLBACK");
    expect((await pending).rows).toEqual([{ one: 1 }]);
  });

  it("rolls back the transaction of a client that disconnects", async () => {
    const server = await served();
    const writer = await client(server.connectionString);
    const reader = await client(server.connectionString);
    await writer.query("BEGIN");
    await writer.query("INSERT INTO item (id, label) VALUES (2, 'lost')");
    const seen = reader.query("SELECT id FROM item");
    await writer.end();
    expect((await seen).rows).toEqual([]);
    expect((await reader.query("SELECT 1 AS one")).rows).toEqual([{ one: 1 }]);
  });

  it("ends a client that idles inside a transaction", async () => {
    const server = await served(200);
    const idle = await client(server.connectionString);
    const other = await client(server.connectionString);
    await idle.query("BEGIN");
    await idle.query("INSERT INTO item (id, label) VALUES (3, 'idle')");
    const seen = other.query("SELECT id FROM item");
    expect((await seen).rows).toEqual([]);
    await expect(idle.query("SELECT 1")).rejects.toThrow();
  });
});

describe("startCloudDevDatabase", () => {
  it("migrates a persistent database and keeps its rows across restarts", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "bb-cloud-dev-pglite-"));
    cleanups.push(() => rm(dataDir, { recursive: true, force: true }));
    const port = await freePort();

    const first = await startCloudDevDatabase({ dataDir, port });
    expect(first.applied.length).toBeGreaterThan(0);
    const writer = new Client({ connectionString: first.connectionString });
    await writer.connect();
    await writer.query(
      `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) VALUES ('u1', 'u1', 'u1@example.com', true, 1, 1)`,
    );
    await writer.end();
    await first.close();

    const second = await startCloudDevDatabase({ dataDir, port });
    cleanups.push(() => second.close());
    expect(second.applied).toEqual([]);
    const reader = await client(second.connectionString);
    expect((await reader.query(`SELECT id FROM "user"`)).rows).toEqual([
      { id: "u1" },
    ]);
  });

  it("names the port when it is taken", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "bb-cloud-dev-pglite-"));
    cleanups.push(() => rm(dataDir, { recursive: true, force: true }));
    const holder = createServer();
    await new Promise<void>((resolve) =>
      holder.listen(0, "127.0.0.1", resolve),
    );
    cleanups.push(
      () => new Promise<void>((resolve) => holder.close(() => resolve())),
    );
    const address = holder.address();
    if (address === null || typeof address === "string") {
      throw new Error("no port");
    }
    await expect(
      startCloudDevDatabase({ dataDir, port: address.port }),
    ).rejects.toThrow(`127.0.0.1:${address.port} is already in use`);
  });
});
