import { Miniflare } from "miniflare";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  TUNNEL_TICKET_TTL_MS,
  createTunnelTicket,
  machine,
  profile,
  schema,
  server,
  sha256Hex,
  user,
} from "@bb/connect-db";
import { applyConnectDbMigrationsToD1 } from "@bb/connect-db/testing";
import worker from "./worker.js";

const SECRET = "tunnel-ticket-test-secret";
const RAW_CREDENTIAL = "bbcred_live_server";
const MACHINE_CREDENTIAL = "bbcm_live_machine";

let mf: Miniflare;
let d1: D1Database;

beforeAll(async () => {
  mf = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response(null); } }",
    d1Databases: { DB: "connect-tunnel-ticket-test" },
  });
  d1 = (await mf.getD1Database("DB")) as unknown as D1Database;
  await applyConnectDbMigrationsToD1(d1);
});

afterAll(async () => {
  await mf.dispose();
});

beforeEach(async () => {
  const db = drizzle(d1, { schema });
  await db.delete(machine).run();
  await db.delete(server).run();
  await db.delete(profile).run();
  await db.delete(user).run();
  const now = new Date();
  await db
    .insert(user)
    .values({
      id: "u1",
      name: "Sawyer",
      email: "u1@example.com",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  await db
    .insert(profile)
    .values({ userId: "u1", handle: "sawyer", createdAt: now })
    .run();
  await db
    .insert(server)
    .values([
      {
        id: "srv-primary",
        userId: "u1",
        name: "default",
        subdomain: "sawyer",
        credentialHash: await sha256Hex(RAW_CREDENTIAL),
        createdAt: now,
      },
      {
        id: "srv-other",
        userId: "u1",
        name: "desktop",
        subdomain: "sawyer-desktop",
        credentialHash: await sha256Hex("bbcred_other"),
        createdAt: now,
      },
    ])
    .run();
  await db
    .insert(machine)
    .values({
      id: "machine-air",
      userId: "u1",
      name: "air",
      subdomain: "sawyer-air",
      credentialHash: await sha256Hex(MACHINE_CREDENTIAL),
      createdAt: now,
    })
    .run();
});

async function dial(host: string, bearer: string) {
  const forwarded: Request[] = [];
  const env = {
    TUNNEL_DO: {
      idFromName: (name: string) => ({ name }),
      get: () => ({
        fetch: async (request: Request) => {
          forwarded.push(request);
          return new Response("tunnel accepted");
        },
      }),
    },
    DB: d1,
    BASE_DOMAIN: "getbb.app",
    BETTER_AUTH_SECRET: SECRET,
  };
  const response = await worker.fetch(
    new Request(`https://${host}/__tunnel?v=1`, {
      headers: { host, authorization: `Bearer ${bearer}` },
    }),
    env as never,
    { waitUntil() {}, passThroughOnException() {} } as never,
  );
  return { response, forwarded };
}

describe("tunnel dial with a ticket", () => {
  it("accepts a valid ticket for the resolved server", async () => {
    const { ticket } = await createTunnelTicket("srv-primary", SECRET);
    const { response, forwarded } = await dial("sawyer.getbb.app", ticket);
    expect(response.status).toBe(200);
    expect(forwarded).toHaveLength(1);
    expect(new URL(forwarded[0].url).searchParams.get("serverId")).toBe(
      "srv-primary",
    );
  });

  it("rejects an expired ticket", async () => {
    const { ticket } = await createTunnelTicket(
      "srv-primary",
      SECRET,
      Date.now() - TUNNEL_TICKET_TTL_MS - 1,
    );
    const { response, forwarded } = await dial("sawyer.getbb.app", ticket);
    expect(response.status).toBe(401);
    expect(await response.text()).toContain("invalid ticket");
    expect(forwarded).toHaveLength(0);
  });

  it("rejects a tampered payload", async () => {
    const { ticket } = await createTunnelTicket("srv-other", SECRET);
    const signature = ticket.slice(ticket.indexOf(".") + 1);
    const payload = Buffer.from(
      JSON.stringify({
        sid: "srv-primary",
        exp: Date.now() + TUNNEL_TICKET_TTL_MS,
      }),
    ).toString("base64url");
    const { response } = await dial(
      "sawyer.getbb.app",
      `bbtkt_${payload}.${signature}`,
    );
    expect(response.status).toBe(401);
  });

  it("rejects a tampered signature", async () => {
    const { ticket } = await createTunnelTicket("srv-primary", SECRET);
    const dot = ticket.indexOf(".");
    const swapped = ticket[dot + 1] === "A" ? "B" : "A";
    const { response } = await dial(
      "sawyer.getbb.app",
      `${ticket.slice(0, dot + 1)}${swapped}${ticket.slice(dot + 2)}`,
    );
    expect(response.status).toBe(401);
  });

  it("rejects a ticket signed with another secret", async () => {
    const { ticket } = await createTunnelTicket("srv-primary", "not-the-gate");
    const { response } = await dial("sawyer.getbb.app", ticket);
    expect(response.status).toBe(401);
  });

  it("rejects a ticket minted for a different server", async () => {
    const { ticket } = await createTunnelTicket("srv-other", SECRET);
    const { response, forwarded } = await dial("sawyer.getbb.app", ticket);
    expect(response.status).toBe(401);
    expect(forwarded).toHaveLength(0);
  });

  it("rejects a ticket for a revoked server", async () => {
    await drizzle(d1, { schema })
      .update(server)
      .set({ revokedAt: new Date(), credentialHash: null })
      .where(eq(server.id, "srv-primary"))
      .run();
    const { ticket } = await createTunnelTicket("srv-primary", SECRET);
    const { response } = await dial("sawyer.getbb.app", ticket);
    expect(response.status).toBe(403);
    expect(await response.text()).toContain("server not paired");
  });

  it("does not accept server tickets on machine labels", async () => {
    const { ticket } = await createTunnelTicket("machine-air", SECRET);
    const { response } = await dial("sawyer-air.getbb.app", ticket);
    expect(response.status).toBe(401);
  });
});

describe("tunnel dial with a raw credential", () => {
  it("still accepts the server credential", async () => {
    const { response, forwarded } = await dial(
      "sawyer.getbb.app",
      RAW_CREDENTIAL,
    );
    expect(response.status).toBe(200);
    expect(new URL(forwarded[0].url).searchParams.get("serverId")).toBe(
      "srv-primary",
    );
  });

  it("still accepts machine credentials on machine labels", async () => {
    const { response, forwarded } = await dial(
      "sawyer-air.getbb.app",
      MACHINE_CREDENTIAL,
    );
    expect(response.status).toBe(200);
    expect(new URL(forwarded[0].url).searchParams.get("machineId")).toBe(
      "machine-air",
    );
  });

  it("rejects another server's credential", async () => {
    const { response } = await dial("sawyer.getbb.app", "bbcred_other");
    expect(response.status).toBe(401);
    expect(await response.text()).toContain("invalid credential");
  });
});
