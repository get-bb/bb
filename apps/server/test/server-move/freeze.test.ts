import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createServerErrorHandler } from "../../src/errors.js";
import {
  isServerMoveFreezeExempt,
  serverMoveFreezeMiddleware,
} from "../../src/services/server-move/freeze.js";
import { readJson } from "../helpers/json.js";
import { testLogger } from "../helpers/test-app.js";

const BB_ACCOUNT_RPC = "/api/v1/plugins/bb-account/rpc";

function frozenApp(state: { frozen: boolean }): Hono {
  const app = new Hono();
  app.onError(createServerErrorHandler(testLogger));
  app.use(
    "/api/v1/*",
    serverMoveFreezeMiddleware({ isFrozen: () => state.frozen }),
  );
  app.all("/api/v1/*", (context) => context.json({ ok: true }));
  app.all("/internal/*", (context) => context.json({ ok: true }));
  return app;
}

describe("server move freeze middleware", () => {
  it("blocks public writes while frozen and keeps reads, move routes, and daemon routes open", async () => {
    const state = { frozen: true };
    const app = frozenApp(state);

    for (const [method, path] of [
      ["POST", "/api/v1/threads"],
      ["PATCH", "/api/v1/hosts/host-1"],
      ["DELETE", "/api/v1/projects/project-1"],
      ["POST", "/api/v1/server/export"],
      ["POST", "/api/v1/server/movement"],
    ] as const) {
      const response = await app.request(path, { method });
      expect(response.status, `${method} ${path}`).toBe(503);
      expect(await readJson(response)).toEqual({
        code: "server_moving",
        message:
          "The server is moving to another machine. Changes are paused until the move finishes or is cancelled.",
        retryable: false,
      });
    }
    for (const [method, path] of [
      ["GET", "/api/v1/threads"],
      ["HEAD", "/api/v1/threads"],
      ["POST", "/api/v1/server/move"],
      ["POST", "/api/v1/server/move/check"],
      ["POST", "/api/v1/server/move/cancel"],
      ["POST", "/internal/events"],
    ] as const) {
      const response = await app.request(path, { method });
      expect(response.status, `${method} ${path}`).toBe(200);
    }

    state.frozen = false;
    expect(
      (await app.request("/api/v1/threads", { method: "POST" })).status,
    ).toBe(200);
  });

  it("keeps bb connect's bb account status reads open while frozen so the tunnel stays up", async () => {
    const app = frozenApp({ frozen: true });

    for (const method of [
      "bb-account.v1.status",
      "bb-account.v1.waitForStatusChange",
      "bb-account.v1.connectCredential",
    ]) {
      const response = await app.request(`${BB_ACCOUNT_RPC}/${method}`, {
        method: "POST",
        body: JSON.stringify({ afterRevision: 3 }),
      });
      expect(response.status, method).toBe(200);
    }
    for (const method of [
      "bb-account.v1.fetch",
      "bb-account.v1.adoptConnectCredential",
      "bb-account.v1.confirmRefusedCredential",
    ]) {
      const response = await app.request(`${BB_ACCOUNT_RPC}/${method}`, {
        method: "POST",
      });
      expect(response.status, method).toBe(503);
      expect(await readJson(response)).toMatchObject({
        code: "server_moving",
      });
    }
  });

  it("exempts only the read-only bb account RPCs that bb connect polls", () => {
    for (const path of [
      `${BB_ACCOUNT_RPC}/bb-account.v1.status`,
      `${BB_ACCOUNT_RPC}/bb-account.v1.waitForStatusChange`,
      `${BB_ACCOUNT_RPC}/bb-account.v1.connectCredential`,
    ]) {
      expect(isServerMoveFreezeExempt("POST", path), path).toBe(true);
    }
    for (const path of [
      `${BB_ACCOUNT_RPC}/bb-account.v1.fetch`,
      `${BB_ACCOUNT_RPC}/bb-account.v1.adoptConnectCredential`,
      `${BB_ACCOUNT_RPC}/bb-account.v1.confirmRefusedCredential`,
      `${BB_ACCOUNT_RPC}/login.start`,
      `${BB_ACCOUNT_RPC}/redeemCode`,
      `${BB_ACCOUNT_RPC}/signOut`,
      `${BB_ACCOUNT_RPC}/bb-account.v1.statusX`,
      `${BB_ACCOUNT_RPC}/bb-account.v1.status/extra`,
      `${BB_ACCOUNT_RPC}/bb-account.v1.waitForStatusChange/`,
      "/api/v1/plugins/connect/rpc/bb-account.v1.status",
      "/api/v1/plugins/bb-account-evil/rpc/bb-account.v1.status",
      "/api/v1/plugins/bb-account/cli",
      `/prefix${BB_ACCOUNT_RPC}/bb-account.v1.status`,
      "/api/v1/threads",
    ]) {
      expect(isServerMoveFreezeExempt("POST", path), path).toBe(false);
    }
  });
});
