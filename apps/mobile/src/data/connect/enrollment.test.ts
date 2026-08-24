import { ConnectMachineRedeemError } from "@bb/connect-client";
import { describe, expect, it, vi } from "vitest";
import {
  accountServerProfile,
  describeEnrollmentError,
  redeemEnrollment,
} from "./enrollment";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("redeemEnrollment", () => {
  it("redeems at the apex and shapes a connect profile labelled by handle", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(200, {
        credential: "bbcm_secret",
        machineId: "m1",
        handle: "account",
        serverUrl: "https://bee.getbb.app",
      }),
    );
    const result = await redeemEnrollment(
      { apexUrl: "https://getbb.app", code: "ABCD-EFGH" },
      fetchImpl,
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://getbb.app/api/connect/redeem-machine",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result.profile).toEqual({
      mode: "connect",
      serverUrl: "https://bee.getbb.app",
      handle: "bee",
      credential: "bbcm_secret",
      label: "bee",
    });
    expect(result.credential.handle).toBe("bee");
  });

  it("maps the apex's wire errors to user copy, including the machine cap", async () => {
    const limit = vi
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        jsonResponse(409, { error: "machine-limit" }),
      );
    await expect(
      redeemEnrollment({ apexUrl: "https://getbb.app", code: "X-1" }, limit),
    ).rejects.toBeInstanceOf(ConnectMachineRedeemError);
    const failure = await redeemEnrollment(
      { apexUrl: "https://getbb.app", code: "X-1" },
      limit,
    ).catch((error: unknown) => describeEnrollmentError(error));
    expect(failure).toMatchObject({ code: "machine_limit" });
    expect(failure).toHaveProperty("message", expect.stringContaining("20"));

    for (const [status, wire, code] of [
      [404, "invalid-code", "invalid_code"],
      [410, "expired", "expired"],
      [409, "already-used", "already_used"],
    ] as const) {
      const failed = await redeemEnrollment(
        { apexUrl: "https://getbb.app", code: "X-1" },
        vi
          .fn<typeof fetch>()
          .mockResolvedValue(jsonResponse(status, { error: wire })),
      ).catch((error: unknown) => describeEnrollmentError(error));
      expect(failed).toMatchObject({ code });
    }
    expect(
      describeEnrollmentError(new TypeError("Network request failed")),
    ).toMatchObject({ code: "network" });
  });
});

describe("accountServerProfile", () => {
  it("reuses the account-scoped credential for another server on the account", () => {
    expect(
      accountServerProfile(
        {
          serverUrl: "https://bee.getbb.app",
          handle: "bee",
          credential: "bbcm_1",
        },
        { handle: "lab", name: "  ", url: "https://lab.getbb.app" },
      ),
    ).toEqual({
      mode: "connect",
      serverUrl: "https://lab.getbb.app",
      handle: "lab",
      credential: "bbcm_1",
      label: "lab",
    });
  });
});
