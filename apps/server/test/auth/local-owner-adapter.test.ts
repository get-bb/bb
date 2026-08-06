import { describe, expect, it } from "vitest";
import {
  LOCAL_OWNER_PRINCIPAL,
  createLocalOwnerPrincipalPolicy,
} from "../../src/auth/local-owner-adapter.js";

describe("local-owner principal policy", () => {
  it("resolves one stable owner Principal for any trusted request", async () => {
    const policy = createLocalOwnerPrincipalPolicy();

    const first = await policy.principal({
      method: "GET",
      path: "/api/v1/projects",
      transport: "http",
      getHeader: () => undefined,
    });
    const second = await policy.principal({
      method: "POST",
      path: "/ws",
      transport: "websocket",
      getHeader: (name) => (name === "authorization" ? "Bearer x" : undefined),
    });

    expect(first).toEqual(LOCAL_OWNER_PRINCIPAL);
    expect(second).toBe(first);
    expect(first).toEqual({
      id: "local-owner",
      kind: "human",
      displayName: "Local Owner",
    });
    expect(Object.isFrozen(first)).toBe(true);
  });

  it("explicitly allows actions for the local owner", async () => {
    const policy = createLocalOwnerPrincipalPolicy();
    const principal = await policy.principal({
      method: "GET",
      path: "/api/v1/threads",
      transport: "http",
      getHeader: () => undefined,
    });

    await expect(
      policy.authorize(
        principal,
        { name: "thread.read" },
        { kind: "thread", id: "thr_1" },
      ),
    ).resolves.toEqual({ allowed: true });
  });

  it("does not authorize a Principal the adapter did not issue", async () => {
    const policy = createLocalOwnerPrincipalPolicy();

    await expect(
      policy.authorize(
        { id: "someone-else", kind: "human", displayName: "Someone Else" },
        { name: "thread.read" },
        { kind: "thread", id: "thr_1" },
      ),
    ).resolves.toEqual({ allowed: false, reason: "unauthenticated" });
  });
});
