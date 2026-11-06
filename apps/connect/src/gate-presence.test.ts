import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NEXT_TUNNEL_WRITE_INTERVAL_MS } from "@bb/connect-db";
import {
  type TestConnectDb,
  createTestConnectDb,
} from "@bb/connect-db-pg/testing";
import type { GatePresenceRequest } from "@bb/tunnel-contract/next";
import { recordNextTunnelPresence } from "./gate-api.js";

const NOW = 1_790_000_000_000;
let pg: TestConnectDb;

async function run(text: string, params: unknown[] = []): Promise<void> {
  await pg.queryable.queryArrays(text, params);
}

async function nextColumns(table: "server" | "machine", id: string) {
  const { rows } = await pg.queryable.queryArrays(
    `SELECT next_tunnel_gate, next_tunnel_region, next_tunnel_at, last_seen_at FROM ${table} WHERE id = $1`,
    [id],
  );
  const [gate, region, at, lastSeenAt] = rows[0] ?? [];
  return { gate, region, at, lastSeenAt };
}

function presence(over: Partial<GatePresenceRequest>): GatePresenceRequest {
  return {
    label: "lily",
    state: "connected",
    region: "iad",
    gateMachineId: "fly-a",
    at: NOW,
    ...over,
  };
}

beforeEach(async () => {
  pg = await createTestConnectDb();
  await run(
    `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) VALUES ('owner', 'Owner', 'o@example.com', true, $1, $1)`,
    [NOW],
  );
  await run(
    `INSERT INTO profile (user_id, handle, created_at) VALUES ('owner', 'owner', $1)`,
    [NOW],
  );
  await run(
    `INSERT INTO server (id, user_id, name, subdomain, credential_hash, created_at) VALUES ('srv-lily', 'owner', 'lily', 'lily', 'x', $1), ('srv-iris', 'owner', 'iris', 'iris', 'y', $1)`,
    [NOW],
  );
  await run(
    `INSERT INTO machine (id, user_id, name, subdomain, credential_hash, created_at) VALUES ('mch-box', 'owner', 'box', 'box', 'z', $1)`,
    [NOW],
  );
});

afterEach(async () => {
  await pg.close();
});

describe("next tunnel presence on Postgres", () => {
  it("applies the presence write rules", async () => {
    const target = pg.db;
    const at = NOW + 1;
    expect(
      await recordNextTunnelPresence(
        target,
        [
          presence({ at }),
          presence({
            label: "iris",
            at,
            gateMachineId: "fly-z",
            region: "sjc",
          }),
          presence({ label: "box", at, gateMachineId: "fly-m" }),
          presence({ label: "nobody", at }),
        ],
        at + 5,
      ),
    ).toEqual(["recorded", "recorded", "recorded", "unknown_label"]);
    expect(await nextColumns("server", "srv-lily")).toEqual({
      gate: "fly-a",
      region: "iad",
      at,
      lastSeenAt: at,
    });
    expect(await nextColumns("machine", "mch-box")).toMatchObject({
      gate: "fly-m",
      at,
    });

    const later = at + 1;
    expect(
      await recordNextTunnelPresence(
        target,
        [
          presence({ at: later }),
          presence({
            label: "iris",
            at: later - 10_000,
            gateMachineId: "fly-y",
          }),
          presence({
            label: "box",
            state: "disconnected",
            gateMachineId: "fly-other",
            at: later,
          }),
        ],
        later,
      ),
    ).toEqual(["unchanged", "unchanged", "unchanged"]);

    await run(`UPDATE server SET next_tunnel_at = $1 WHERE id = 'srv-lily'`, [
      at - NEXT_TUNNEL_WRITE_INTERVAL_MS,
    ]);
    const refreshed = later + 1;
    expect(
      await recordNextTunnelPresence(
        target,
        [
          presence({ at: refreshed }),
          presence({
            label: "iris",
            state: "disconnected",
            gateMachineId: "fly-z",
            at: refreshed,
          }),
          presence({
            label: "box",
            state: "disconnected",
            gateMachineId: "fly-m",
            at: refreshed,
          }),
        ],
        refreshed,
      ),
    ).toEqual(["recorded", "recorded", "recorded"]);
    expect((await nextColumns("server", "srv-lily")).at).toBe(refreshed);
    expect(await nextColumns("server", "srv-iris")).toMatchObject({
      gate: null,
      region: null,
      at: refreshed,
    });
    expect((await nextColumns("machine", "mch-box")).gate).toBeNull();
  });

  it("does not record a revoked machine", async () => {
    await run(`UPDATE machine SET revoked_at = $1 WHERE id = 'mch-box'`, [NOW]);
    expect(
      await recordNextTunnelPresence(
        pg.db,
        [presence({ label: "box", at: NOW + 1 })],
        NOW + 1,
      ),
    ).toEqual(["unchanged"]);
    expect((await nextColumns("machine", "mch-box")).gate).toBeNull();
  });
});
