import { describe, expect, it, vi } from "vitest";
import { enrollDesktopMachine } from "../src/connect-machine-enrollment.js";

function machineCodeResponse(): Response {
  return new Response(
    JSON.stringify({
      ok: true,
      result: {
        code: "ABCD-1234",
        expiresAt: 1_800_000,
        serverUrl: "https://laptop.getbb.app",
      },
    }),
  );
}

describe("enrollDesktopMachine", () => {
  it("mints a code on the local server and redeems it at the connect apex", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/rpc/createMachineCode")) {
        return machineCodeResponse();
      }
      expect(url).toBe("https://getbb.app/api/connect/redeem-machine");
      return new Response(
        JSON.stringify({
          credential: "bbcm_desktop",
          machineId: "machine-1",
          handle: "laptop",
          serverUrl: "https://laptop.getbb.app",
        }),
      );
    });

    await expect(
      enrollDesktopMachine({
        fetchImpl: fetchImpl as unknown as typeof fetch,
        localServerUrl: "http://127.0.0.1:38886",
      }),
    ).resolves.toEqual({
      credential: {
        credential: "bbcm_desktop",
        handle: "laptop",
        serverUrl: "https://laptop.getbb.app",
      },
      ok: true,
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:38886/api/v1/plugins/connect/rpc/createMachineCode",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("takes the label from the server URL, not the account handle", async () => {
    const fetchImpl = async (input: string | URL | Request) =>
      String(input).endsWith("/rpc/createMachineCode")
        ? machineCodeResponse()
        : new Response(
            JSON.stringify({
              credential: "bbcm_desktop",
              machineId: "machine-1",
              handle: "sawyer",
              serverUrl: "https://laptop.getbb.app",
            }),
          );

    await expect(
      enrollDesktopMachine({
        fetchImpl: fetchImpl as unknown as typeof fetch,
        localServerUrl: "http://127.0.0.1:38886",
      }),
    ).resolves.toMatchObject({ credential: { handle: "laptop" }, ok: true });
  });

  it("reports an unpaired bb without calling the gate", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: false,
            error: { code: "handler_error", message: "not_paired" },
          }),
          { status: 500 },
        ),
    );

    await expect(
      enrollDesktopMachine({
        fetchImpl: fetchImpl as unknown as typeof fetch,
        localServerUrl: "http://127.0.0.1:38886",
      }),
    ).resolves.toEqual({
      code: "not_paired",
      detail: "this bb is not paired with bb Connect",
      ok: false,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("reports the account machine limit from the gate", async () => {
    const fetchImpl = async (input: string | URL | Request) =>
      String(input).endsWith("/rpc/createMachineCode")
        ? machineCodeResponse()
        : new Response(JSON.stringify({ error: "machine-limit" }), {
            status: 409,
          });

    await expect(
      enrollDesktopMachine({
        fetchImpl: fetchImpl as unknown as typeof fetch,
        localServerUrl: "http://127.0.0.1:38886",
      }),
    ).resolves.toMatchObject({ code: "machine_limit", ok: false });
  });
});
