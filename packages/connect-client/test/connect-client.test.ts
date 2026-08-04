import { describe, expect, it, vi } from "vitest";
import {
  ConnectListError,
  ConnectMachineRedeemError,
  deriveConnectBaseUrl,
  listAccountServers,
  redeemMachineCredential,
  serverUrlForHandle,
} from "../src/index.js";

const CREDENTIAL = {
  credential: "bbcm_desktop",
  handle: "laptop",
  serverUrl: "https://laptop.getbb.app",
};

describe("connect URL helpers", () => {
  it("drops and re-adds the routing label", () => {
    expect(deriveConnectBaseUrl("https://laptop.getbb.app")).toBe(
      "https://getbb.app",
    );
    expect(serverUrlForHandle("https://getbb.app", "phone")).toBe(
      "https://phone.getbb.app",
    );
    // Self-hosted apex, non-default port kept.
    expect(deriveConnectBaseUrl("https://laptop.bb.example:8443")).toBe(
      "https://bb.example:8443",
    );
  });
});

describe("listAccountServers", () => {
  it("adds a public URL per handle and reports the self handle", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            servers: [
              { handle: "laptop", name: "Laptop", live: true },
              { handle: "phone", name: "Phone", live: false },
            ],
          }),
        ),
    );

    await expect(listAccountServers(CREDENTIAL, fetchImpl)).resolves.toEqual({
      selfHandle: "laptop",
      servers: [
        {
          handle: "laptop",
          name: "Laptop",
          live: true,
          url: "https://laptop.getbb.app",
        },
        {
          handle: "phone",
          name: "Phone",
          live: false,
          url: "https://phone.getbb.app",
        },
      ],
    });
  });

  it("marks a refused credential unauthorized", async () => {
    await expect(
      listAccountServers(
        CREDENTIAL,
        async () => new Response("no", { status: 401 }),
      ),
    ).rejects.toMatchObject({ code: "unauthorized" });
    await expect(
      listAccountServers(CREDENTIAL, async () => {
        throw new Error("offline");
      }),
    ).rejects.toBeInstanceOf(ConnectListError);
  });
});

describe("redeemMachineCredential", () => {
  it("returns a credential for the server the code targeted", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            credential: "bbcm_desktop",
            machineId: "machine-1",
            handle: "laptop",
            serverUrl: "https://laptop.getbb.app",
          }),
        ),
    );

    await expect(
      redeemMachineCredential(
        { apexUrl: "https://getbb.app", code: "ABCD-1234" },
        fetchImpl,
      ),
    ).resolves.toEqual(CREDENTIAL);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://getbb.app/api/connect/redeem-machine",
      expect.objectContaining({
        body: JSON.stringify({ code: "ABCD-1234" }),
        method: "POST",
      }),
    );
  });

  it("maps the gate's rejections to stable codes", async () => {
    const cases: Array<[number, string, string]> = [
      [409, "already-used", "already_used"],
      [409, "machine-limit", "machine_limit"],
      [410, "expired", "expired"],
      [404, "invalid-code", "invalid_code"],
      [500, "boom", "network"],
    ];
    for (const [status, wireError, expected] of cases) {
      await expect(
        redeemMachineCredential(
          { apexUrl: "https://getbb.app", code: "ABCD-1234" },
          async () =>
            new Response(JSON.stringify({ error: wireError }), { status }),
        ),
      ).rejects.toMatchObject({ code: expected });
    }
  });

  it("rejects a response with no server to point at", async () => {
    await expect(
      redeemMachineCredential(
        { apexUrl: "https://getbb.app", code: "ABCD-1234" },
        async () =>
          new Response(
            JSON.stringify({
              credential: "bbcm_desktop",
              machineId: "machine-1",
              handle: null,
              serverUrl: null,
            }),
          ),
      ),
    ).rejects.toBeInstanceOf(ConnectMachineRedeemError);
  });
});
