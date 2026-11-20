import { describe, expect, it } from "vitest";
import {
  createFakeDpopServer,
  FAKE_SERVER_URL,
  nodeDeviceCrypto,
} from "../device-auth/fake-dpop-server";
import { checkDirectServer, pairDirectServer } from "./direct-pairing";

function server() {
  return createFakeDpopServer({ validCode: "ABCDE-FGHJK", now: Date.now });
}

describe("direct server sign-in", () => {
  it("asks for a code when the server refuses an unsigned probe", async () => {
    const fake = server();
    expect(await checkDirectServer(FAKE_SERVER_URL, fake.fetch)).toMatchObject({
      kind: "needs-code",
      serverUrl: FAKE_SERVER_URL,
    });
  });

  it("pairs with a device key and proves the sign-in with a signed probe", async () => {
    const fake = server();
    const result = await pairDirectServer({
      serverUrl: FAKE_SERVER_URL,
      code: "abcde fghjk".toUpperCase().replace(" ", "-"),
      label: "bb mobile on test",
      crypto: nodeDeviceCrypto,
      fetchImpl: fake.fetch,
    });
    expect(result).toMatchObject({
      kind: "ready",
      device: { credentialId: "acc_phone", privateJwk: { kty: "EC" } },
    });
    expect(fake.calls).toEqual([
      "POST /api/v1/access/pairings/redeem",
      "GET /health",
      "GET /api/v1/system/config",
    ]);
  });

  it("keeps asking for a code after a wrong one", async () => {
    const fake = server();
    expect(
      await pairDirectServer({
        serverUrl: FAKE_SERVER_URL,
        code: "WRONG-CODE0",
        label: "bb mobile on test",
        crypto: nodeDeviceCrypto,
        fetchImpl: fake.fetch,
      }),
    ).toMatchObject({
      kind: "needs-code",
      message: expect.stringContaining("wrong"),
    });
  });
});
