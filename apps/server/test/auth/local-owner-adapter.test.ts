import { describe, expect, it } from "vitest";
import {
  LOCAL_OWNER_PRINCIPAL,
  createLocalOwnerPrincipalPolicy,
} from "../../src/auth/local-owner-adapter.js";

describe("local-owner principal policy", () => {
  it("resolves one stable owner Principal for any trusted request", async () => {
    const policy = createLocalOwnerPrincipalPolicy();

    const first = await policy.resolve({
      method: "GET",
      target: "/api/v1/projects",
      transport: "http",
      getHeader: () => undefined,
    });
    const second = await policy.resolve({
      method: "POST",
      target: "/ws",
      transport: "websocket",
      getHeader: (name) => (name === "authorization" ? "Bearer x" : undefined),
    });

    expect(first.principal).toEqual(LOCAL_OWNER_PRINCIPAL);
    expect(second.principal).toBe(first.principal);
    expect(first.principal).toEqual({
      id: "local-owner",
      kind: "human",
      displayName: "Local Owner",
    });
    expect(Object.isFrozen(first.principal)).toBe(true);
    expect(first.expiresAtMs).toBeNull();
    expect(first.clientRealtimeScope).toBe("unrestricted");
    expect(second.expiresAtMs).toBeNull();
    expect(second.clientRealtimeScope).toBe("unrestricted");
  });

  it("explicitly allows actions for the local owner session", async () => {
    const policy = createLocalOwnerPrincipalPolicy();
    const session = await policy.resolve({
      method: "GET",
      target: "/api/v1/threads",
      transport: "http",
      getHeader: () => undefined,
    });

    await expect(
      session.authorize(
        { name: "thread.read" },
        { kind: "thread", id: "thr_1" },
      ),
    ).resolves.toEqual({ allowed: true });
  });

  it("binds authorize to the issued local-owner session without a Principal argument", async () => {
    const policy = createLocalOwnerPrincipalPolicy();
    const session = await policy.resolve({
      method: "GET",
      target: "/api/v1/threads",
      transport: "http",
      getHeader: () => undefined,
    });

    expect(session.principal).toEqual(LOCAL_OWNER_PRINCIPAL);
    expect(session.authorize.length).toBe(2);
    await expect(
      session.authorize(
        { name: "thread.write" },
        { kind: "thread", id: "thr_2" },
      ),
    ).resolves.toEqual({ allowed: true });
  });
});
