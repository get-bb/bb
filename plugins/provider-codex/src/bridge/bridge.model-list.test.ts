import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { experimental_createBridgeJsonRpcTestHarness as createBridgeJsonRpcTestHarness } from "@get-bb/plugin-sdk/provider-bridge/testing";
import { experimental_killAllChildrenForTests, handleLine } from "./bridge.js";
import { stubFakeCodexAppServer } from "./fake-codex-app-server-harness.js";

let harness: ReturnType<typeof createBridgeJsonRpcTestHarness>;
const temporaryDirectories: string[] = [];

beforeEach(() => {
  stubFakeCodexAppServer();
  harness = createBridgeJsonRpcTestHarness(handleLine);
});

afterEach(async () => {
  experimental_killAllChildrenForTests();
  harness.restore();
  vi.unstubAllEnvs();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

it("reuses one initialized app-server across model catalog requests", async () => {
  harness.sendRequest(1, "model/list", {});
  const first = await harness.waitForResponse(1);
  harness.sendRequest(2, "model/list", {});
  const second = await harness.waitForResponse(2);

  expect(first.error).toBeUndefined();
  expect(second.error).toBeUndefined();
  expect(second.result).toEqual(first.result);
});

it("replaces the cached app-server after a model catalog failure", async () => {
  const workDir = await mkdtemp(join(tmpdir(), "bb-codex-model-list-"));
  temporaryDirectories.push(workDir);
  const scriptPath = join(workDir, "script.json");
  await writeFile(
    scriptPath,
    JSON.stringify({
      modelListFailOnceMarkerPath: join(workDir, "failed-once"),
      turns: [],
    }),
  );
  stubFakeCodexAppServer(scriptPath);

  harness.sendRequest(1, "model/list", {});
  const failed = await harness.waitForResponse(1);
  harness.sendRequest(2, "model/list", {});
  const recovered = await harness.waitForResponse(2);

  expect(failed.error?.message).toContain(
    "Codex model/list returned no supported models.",
  );
  expect(recovered.error).toBeUndefined();
  expect(recovered.result).toMatchObject({
    models: [
      {
        displayName: "Fake model",
      },
    ],
  });
});
