import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import {
  captureTrustedRemoteAddress,
  getConnectIsRemote,
  getTrustedRemoteAddress,
  getGateAuthKind,
  runWithConnectRemote,
  TRUSTED_REMOTE_ADDRESS_CONTEXT_KEY,
} from "../src/request-context.js";

describe("request context", () => {
  it("captures the trusted remote address from node connection metadata", async () => {
    const app = new Hono();
    app.use("*", async (context, next) => {
      captureTrustedRemoteAddress(context);
      await next();
    });
    app.get("/", (context) =>
      context.json({
        address: getTrustedRemoteAddress(context),
      }),
    );

    const response = await app.fetch(new Request("http://example.test/"), {
      incoming: {
        socket: {
          remoteAddress: "127.0.0.1",
        },
      },
    });

    await expect(response.json()).resolves.toEqual({
      address: "127.0.0.1",
    });
  });

  it("stores undefined when connection metadata is unavailable", async () => {
    const app = new Hono();
    app.get("/", (context) => {
      captureTrustedRemoteAddress(context);
      return context.json({
        hasAddress:
          context.get(TRUSTED_REMOTE_ADDRESS_CONTEXT_KEY) !== undefined,
      });
    });

    const response = await app.request("/");

    await expect(response.json()).resolves.toEqual({
      hasAddress: false,
    });
  });

  it.each([
    { gateAuth: "session", expected: true },
    { gateAuth: "machine", expected: false },
    { gateAuth: "invalid", expected: false },
    { gateAuth: undefined, expected: false },
  ])(
    "reports Connect as $expected for $gateAuth authentication",
    ({ gateAuth, expected }) => {
      const headers = new Headers();
      if (gateAuth !== undefined) headers.set("x-bb-gate-auth", gateAuth);

      expect(
        getGateAuthKind({
          req: { header: (name) => headers.get(name) ?? undefined },
        }) === "session",
      ).toBe(expected);
    },
  );

  it("scopes Connect status to the originating request", async () => {
    const app = new Hono();
    app.use("*", (context, next) => {
      return runWithConnectRemote(
        getGateAuthKind(context) === "session",
        next,
      );
    });
    app.get("/", async (context) => {
      const beforeAwait = getConnectIsRemote();
      await Promise.resolve();
      const afterImmediate = await new Promise((resolve) => {
        setImmediate(() => resolve(getConnectIsRemote()));
      });
      return context.json({ beforeAwait, afterImmediate });
    });

    const connect = await app.fetch(
      new Request("http://example.test/", {
        headers: {
          "x-bb-gate-auth": "session",
        },
      }),
    );
    await expect(connect.json()).resolves.toEqual({
      beforeAwait: true,
      afterImmediate: true,
    });

    const local = await app.fetch(new Request("http://example.test/"));
    await expect(local.json()).resolves.toEqual({
      beforeAwait: false,
      afterImmediate: false,
    });

    const nestedStatus = runWithConnectRemote(true, () =>
      runWithConnectRemote(false, getConnectIsRemote),
    );
    expect(nestedStatus).toBe(false);

    expect(getConnectIsRemote()).toBe(false);
  });
});
