import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createBridgeJsonRpcTestHarness } from "@bb/provider-bridge-protocol/testing";
import { experimental_killAllChildrenForTests, handleLine } from "./bridge.js";

const fakeAppServerPath = fileURLToPath(
  new URL("./fake-codex-app-server.mjs", import.meta.url),
);

let harness: ReturnType<typeof createBridgeJsonRpcTestHarness>;

beforeEach(() => {
  vi.stubEnv("BB_CODEX_BRIDGE_APP_SERVER_COMMAND", process.execPath);
  vi.stubEnv(
    "BB_CODEX_BRIDGE_APP_SERVER_ARGS",
    JSON.stringify([fakeAppServerPath]),
  );
  harness = createBridgeJsonRpcTestHarness(handleLine);
});

afterEach(() => {
  experimental_killAllChildrenForTests();
  harness.restore();
  vi.unstubAllEnvs();
});

it("reuses one initialized app-server across model catalog requests", async () => {
  harness.sendRequest(1, "model/list", {});
  const first = await harness.waitForResponse(1);
  harness.sendRequest(2, "model/list", {});
  const second = await harness.waitForResponse(2);

  expect(first.error).toBeUndefined();
  expect(second.error).toBeUndefined();
  // The fixture puts a random per-process identity in its model id. Equal
  // catalogs therefore prove both requests reached the same child process.
  expect(second.result).toEqual(first.result);
});
