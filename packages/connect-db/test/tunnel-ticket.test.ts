import { describe, expect, it } from "vitest";
import {
  TUNNEL_TICKET_TTL_MS,
  createTunnelTicket,
  isTunnelTicket,
  verifyTunnelTicket,
} from "../src/index.js";

const SECRET = "test-better-auth-secret";
const NOW = Date.UTC(2026, 8, 22, 12);

function encodeSegment(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

describe("tunnel tickets", () => {
  it("round-trips the server id until the five-minute expiry", async () => {
    const { ticket, expiresAt } = await createTunnelTicket(
      "srv-1",
      SECRET,
      NOW,
    );
    expect(isTunnelTicket(ticket)).toBe(true);
    expect(expiresAt).toBe(NOW + TUNNEL_TICKET_TTL_MS);
    await expect(verifyTunnelTicket(ticket, SECRET, NOW)).resolves.toEqual({
      sid: "srv-1",
      exp: expiresAt,
    });
    await expect(
      verifyTunnelTicket(ticket, SECRET, expiresAt - 1),
    ).resolves.not.toBeNull();
    await expect(
      verifyTunnelTicket(ticket, SECRET, expiresAt),
    ).resolves.toBeNull();
  });

  it("rejects a ticket signed with a different secret", async () => {
    const { ticket } = await createTunnelTicket("srv-1", "other", NOW);
    await expect(verifyTunnelTicket(ticket, SECRET, NOW)).resolves.toBeNull();
  });

  it("rejects a tampered payload", async () => {
    const { ticket } = await createTunnelTicket("srv-1", SECRET, NOW);
    const signature = ticket.slice(ticket.indexOf(".") + 1);
    const forged = `bbtkt_${encodeSegment(
      JSON.stringify({ sid: "srv-2", exp: NOW + TUNNEL_TICKET_TTL_MS }),
    )}.${signature}`;
    await expect(verifyTunnelTicket(forged, SECRET, NOW)).resolves.toBeNull();
  });

  it("rejects a tampered signature", async () => {
    const { ticket } = await createTunnelTicket("srv-1", SECRET, NOW);
    const dot = ticket.indexOf(".");
    const first = ticket[dot + 1] === "A" ? "B" : "A";
    await expect(
      verifyTunnelTicket(
        `${ticket.slice(0, dot + 1)}${first}${ticket.slice(dot + 2)}`,
        SECRET,
        NOW,
      ),
    ).resolves.toBeNull();
    await expect(
      verifyTunnelTicket(ticket.slice(0, ticket.indexOf(".")), SECRET, NOW),
    ).resolves.toBeNull();
  });

  it("rejects tickets whose expiry is further out than the TTL allows", async () => {
    const { ticket } = await createTunnelTicket(
      "srv-1",
      SECRET,
      NOW + 60 * 60 * 1000,
    );
    await expect(verifyTunnelTicket(ticket, SECRET, NOW)).resolves.toBeNull();
  });

  it("rejects raw credentials and malformed values", async () => {
    await expect(
      verifyTunnelTicket("bbcred_abc", SECRET, NOW),
    ).resolves.toBeNull();
    await expect(
      verifyTunnelTicket("bbtkt_not-json.sig", SECRET, NOW),
    ).resolves.toBeNull();
  });
});
