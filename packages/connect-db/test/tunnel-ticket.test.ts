import { describe, expect, it } from "vitest";
import {
  TUNNEL_TICKET_TTL_MS,
  createTunnelTicket,
  isTunnelTicket,
  sha256Hex,
  verifyTunnelTicket,
} from "../src/index.js";

const SECRET = "test-better-auth-secret";
const NOW = Date.UTC(2026, 8, 22, 12);

function encodeSegment(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

async function owner(id: string, credential = `bbcred_${id}`) {
  return { id, credentialHash: await sha256Hex(credential) };
}

describe("tunnel tickets", () => {
  it("round-trips the server id until the five-minute expiry", async () => {
    const srv = await owner("srv-1");
    const { ticket, expiresAt } = await createTunnelTicket(srv, SECRET, NOW);
    expect(isTunnelTicket(ticket)).toBe(true);
    expect(expiresAt).toBe(NOW + TUNNEL_TICKET_TTL_MS);
    await expect(verifyTunnelTicket(ticket, SECRET, srv, NOW)).resolves.toEqual(
      {
        sid: "srv-1",
        cred: srv.credentialHash.slice(0, 16),
        exp: expiresAt,
      },
    );
    await expect(
      verifyTunnelTicket(ticket, SECRET, srv, expiresAt - 1),
    ).resolves.not.toBeNull();
    await expect(
      verifyTunnelTicket(ticket, SECRET, srv, expiresAt),
    ).resolves.toBeNull();
  });

  it("rejects a ticket once the server's credential rotates", async () => {
    const before = await owner("srv-1", "bbcred_before");
    const after = await owner("srv-1", "bbcred_after");
    const { ticket: stale } = await createTunnelTicket(before, SECRET, NOW);
    await expect(
      verifyTunnelTicket(stale, SECRET, after, NOW),
    ).resolves.toBeNull();
    const { ticket: fresh } = await createTunnelTicket(after, SECRET, NOW);
    await expect(
      verifyTunnelTicket(fresh, SECRET, after, NOW),
    ).resolves.not.toBeNull();
  });

  it("rejects a ticket minted for another server", async () => {
    const { ticket } = await createTunnelTicket(
      await owner("srv-2"),
      SECRET,
      NOW,
    );
    await expect(
      verifyTunnelTicket(ticket, SECRET, await owner("srv-1"), NOW),
    ).resolves.toBeNull();
  });

  it("rejects a ticket signed with a different secret", async () => {
    const srv = await owner("srv-1");
    const { ticket } = await createTunnelTicket(srv, "other", NOW);
    await expect(
      verifyTunnelTicket(ticket, SECRET, srv, NOW),
    ).resolves.toBeNull();
  });

  it("rejects a tampered payload", async () => {
    const srv = await owner("srv-1");
    const other = await owner("srv-2");
    const { ticket } = await createTunnelTicket(srv, SECRET, NOW);
    const signature = ticket.slice(ticket.indexOf(".") + 1);
    const forged = `bbtkt_${encodeSegment(
      JSON.stringify({
        sid: "srv-2",
        cred: other.credentialHash.slice(0, 16),
        exp: NOW + TUNNEL_TICKET_TTL_MS,
      }),
    )}.${signature}`;
    await expect(
      verifyTunnelTicket(forged, SECRET, other, NOW),
    ).resolves.toBeNull();
  });

  it("rejects a tampered signature", async () => {
    const srv = await owner("srv-1");
    const { ticket } = await createTunnelTicket(srv, SECRET, NOW);
    const dot = ticket.indexOf(".");
    const first = ticket[dot + 1] === "A" ? "B" : "A";
    await expect(
      verifyTunnelTicket(
        `${ticket.slice(0, dot + 1)}${first}${ticket.slice(dot + 2)}`,
        SECRET,
        srv,
        NOW,
      ),
    ).resolves.toBeNull();
    await expect(
      verifyTunnelTicket(
        ticket.slice(0, ticket.indexOf(".")),
        SECRET,
        srv,
        NOW,
      ),
    ).resolves.toBeNull();
  });

  it("rejects tickets whose expiry is further out than the TTL allows", async () => {
    const srv = await owner("srv-1");
    const { ticket } = await createTunnelTicket(
      srv,
      SECRET,
      NOW + 60 * 60 * 1000,
    );
    await expect(
      verifyTunnelTicket(ticket, SECRET, srv, NOW),
    ).resolves.toBeNull();
  });

  it("rejects raw credentials and malformed values", async () => {
    const srv = await owner("srv-1");
    await expect(
      verifyTunnelTicket("bbcred_abc", SECRET, srv, NOW),
    ).resolves.toBeNull();
    await expect(
      verifyTunnelTicket("bbtkt_not-json.sig", SECRET, srv, NOW),
    ).resolves.toBeNull();
  });
});
