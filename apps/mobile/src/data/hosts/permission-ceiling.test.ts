import { BbHttpError } from "@bb/sdk/browser";
import { describe, expect, it } from "vitest";
import { updateHostPermissionCeiling } from "./permission-ceiling";

const HOST = {
  id: "h1",
  name: "mbp",
  type: "persistent",
  status: "connected",
  maxPermissionMode: "auto",
  lastSeenAt: null,
  lastRejectedProtocolVersion: null,
  createdAt: 1,
  updatedAt: 2,
};

describe("updateHostPermissionCeiling", () => {
  it("PATCHes the ceiling route through the profile fetch and parses the host", async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const client = {
      serverUrl: "http://127.0.0.1:41999/",
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(input), init });
        return new Response(JSON.stringify(HOST), { status: 200 });
      }) as typeof fetch,
    };
    const host = await updateHostPermissionCeiling(client, {
      hostId: "h1",
      maxPermissionMode: "auto",
    });
    expect(host.maxPermissionMode).toBe("auto");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      "http://127.0.0.1:41999/api/v1/hosts/h1/permission-ceiling",
    );
    expect(calls[0]?.init?.method).toBe("PATCH");
    expect(calls[0]?.init?.body).toBe(
      JSON.stringify({ maxPermissionMode: "auto" }),
    );
  });

  it("raises BbHttpError with the server's code and message", async () => {
    const client = {
      serverUrl: "http://127.0.0.1:41999",
      fetch: (async () =>
        new Response(
          JSON.stringify({
            code: "host_not_found",
            message: "Host not found",
          }),
          { status: 404 },
        )) as typeof fetch,
    };
    await expect(
      updateHostPermissionCeiling(client, {
        hostId: "missing",
        maxPermissionMode: "full",
      }),
    ).rejects.toMatchObject({
      status: 404,
      code: "host_not_found",
      message: "HTTP 404: Host not found",
    });
    await expect(
      updateHostPermissionCeiling(client, {
        hostId: "missing",
        maxPermissionMode: "full",
      }),
    ).rejects.toBeInstanceOf(BbHttpError);
  });

  it("rejects a body that is not a host row", async () => {
    const client = {
      serverUrl: "http://127.0.0.1:41999",
      fetch: (async () =>
        new Response("<html>gate</html>", { status: 200 })) as typeof fetch,
    };
    await expect(
      updateHostPermissionCeiling(client, {
        hostId: "h1",
        maxPermissionMode: "full",
      }),
    ).rejects.toThrow();
  });
});
