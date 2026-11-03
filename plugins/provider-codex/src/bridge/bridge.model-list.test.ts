import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BRIDGE_JSON_RPC_ERRORS } from "@get-bb/plugin-sdk/provider-bridge";
import { experimental_createBridgeJsonRpcTestHarness as createBridgeJsonRpcTestHarness } from "@get-bb/plugin-sdk/provider-bridge/testing";
import { experimental_killAllChildrenForTests, handleLine } from "./bridge.js";
import {
  FULL_ACCESS_SESSION_OPTIONS,
  stubFakeCodexAppServer,
} from "./fake-codex-app-server-harness.js";

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

it("refreshes the catalog when new models become available", async () => {
  const workDir = await mkdtemp(join(tmpdir(), "bb-codex-model-refresh-"));
  temporaryDirectories.push(workDir);
  const scriptPath = join(workDir, "script.json");
  const firstCatalog = [{ id: "first", model: "first", isDefault: true }];
  const nextCatalog = [
    ...firstCatalog,
    { id: "new", model: "new", isDefault: false },
  ];
  await writeFile(
    scriptPath,
    JSON.stringify({ modelList: { data: firstCatalog }, turns: [] }),
  );
  stubFakeCodexAppServer(scriptPath);
  harness.sendRequest(1, "model/list", {});
  const first = await harness.waitForResponse(1);
  await writeFile(
    scriptPath,
    JSON.stringify({ modelList: { data: nextCatalog }, turns: [] }),
  );
  harness.sendRequest(2, "model/list", {});
  const second = await harness.waitForResponse(2);

  expect(first.error).toBeUndefined();
  expect(second.error).toBeUndefined();
  expect(first.result).toMatchObject({ models: [{ model: "first" }] });
  expect(second.result).toMatchObject({
    models: [{ model: "first" }, { model: "new" }],
  });
});

it("publishes the model catalog returned by a newly opened session", async () => {
  const workDir = await mkdtemp(join(tmpdir(), "bb-codex-session-catalog-"));
  temporaryDirectories.push(workDir);
  const scriptPath = join(workDir, "script.json");
  await writeFile(
    scriptPath,
    JSON.stringify({
      modelList: { data: [{ id: "session-model", model: "session-model" }] },
      turns: [],
    }),
  );
  stubFakeCodexAppServer(scriptPath);
  harness.sendRequest(1, "thread/start", {
    threadId: "thr_session_catalog",
    cwd: workDir,
    instructionMode: "append",
    options: FULL_ACCESS_SESSION_OPTIONS,
  });
  expect((await harness.waitForResponse(1)).error).toBeUndefined();
  await vi.waitFor(() => {
    expect(harness.messages).toContainEqual(
      expect.objectContaining({
        method: "thread/delta",
        params: expect.objectContaining({
          threadId: "thr_session_catalog",
          deltas: expect.arrayContaining([
            expect.objectContaining({
              kind: "extension.state",
              extensionKind: "bb/provider-model-catalog",
              payload: expect.objectContaining({
                models: [expect.objectContaining({ model: "session-model" })],
                selectedOnlyModels: [],
              }),
            }),
          ]),
        }),
      }),
    );
  });
});

it("launches the catalog app-server on the requested pool route", async () => {
  const workDir = await mkdtemp(join(tmpdir(), "bb-codex-model-route-"));
  temporaryDirectories.push(workDir);
  const scriptPath = join(workDir, "script.json");
  const launchLogPath = join(workDir, "launches.jsonl");
  await writeFile(scriptPath, JSON.stringify({ launchLogPath, turns: [] }));
  stubFakeCodexAppServer(scriptPath);
  const pooled = {
    CODEX_OPENAI_BASE_URL: "http://127.0.0.1:1/pool/v1",
    CODEX_POOL_AUTH_TOKEN: "machine-token",
  };

  harness.sendRequest(1, "model/list", { envVars: pooled });
  const first = await harness.waitForResponse(1);
  harness.sendRequest(2, "model/list", { envVars: pooled });
  const repeated = await harness.waitForResponse(2);
  harness.sendRequest(3, "model/list", { envVars: {} });
  const local = await harness.waitForResponse(3);

  expect([first.error, repeated.error, local.error]).toEqual([
    undefined,
    undefined,
    undefined,
  ]);
  expect(repeated.result).not.toEqual(first.result);
  expect(local.result).not.toEqual(first.result);
  const launches = (await readFile(launchLogPath, "utf8"))
    .trim()
    .split("\n")
    .map(
      (line) =>
        JSON.parse(line) as { args: string[]; poolToken: string | null },
    );
  expect(launches).toHaveLength(3);
  expect(launches[0]?.args).toContain('model_provider="bb-account-pool"');
  expect(launches[0]?.args).toContain(
    'openai_base_url="http://127.0.0.1:1/pool/v1"',
  );
  expect(launches[0]?.poolToken).toBe("machine-token");
  expect(launches[1]?.args).toContain('model_provider="bb-account-pool"');
  expect(launches[1]?.poolToken).toBe("machine-token");
  expect(launches[2]?.args).not.toContain('model_provider="bb-account-pool"');
  expect(launches[2]?.poolToken).toBeNull();
});

it.each([
  {
    name: "configured model",
    configRead: { config: { model: "configured-model" } },
    configReadError: false,
    expectedDefaults: [false, true],
  },
  {
    name: "unset model",
    configRead: { config: { model: null } },
    configReadError: false,
    expectedDefaults: [true, false],
  },
  {
    name: "model outside the catalog",
    configRead: { config: { model: "unlisted-model" } },
    configReadError: false,
    expectedDefaults: [true, false],
  },
  {
    name: "unavailable configuration API",
    configRead: { config: { model: "configured-model" } },
    configReadError: true,
    expectedDefaults: [true, false],
  },
  {
    name: "malformed configuration response",
    configRead: { config: { model: 42 } },
    configReadError: false,
    expectedDefaults: [true, false],
  },
])("resolves catalog defaults with $name", async (scenario) => {
  const workDir = await mkdtemp(join(tmpdir(), "bb-codex-model-default-"));
  temporaryDirectories.push(workDir);
  const scriptPath = join(workDir, "script.json");
  const catalog = [
    { id: "catalog-id", model: "catalog-model", isDefault: true },
    { id: "configured-id", model: "configured-model", isDefault: false },
  ];
  await writeFile(
    scriptPath,
    JSON.stringify({
      modelList: { data: catalog },
      configRead: scenario.configRead,
      configReadError: scenario.configReadError,
      turns: [],
    }),
  );
  stubFakeCodexAppServer(scriptPath);

  harness.sendRequest(1, "model/list", {});
  const response = await harness.waitForResponse(1);

  expect(response.error).toBeUndefined();
  expect(response.result).toMatchObject({
    models: catalog.map((model, index) => ({
      id: model.id,
      model: model.model,
      isDefault: scenario.expectedDefaults[index],
    })),
    selectedOnlyModels: [],
  });

  harness.sendRequest(2, "thread/start", {
    threadId: "thr_catalog_defaults",
    cwd: workDir,
    instructionMode: "append",
    options: FULL_ACCESS_SESSION_OPTIONS,
  });
  expect((await harness.waitForResponse(2)).error).toBeUndefined();
  await vi.waitFor(() => {
    expect(harness.messages).toContainEqual(
      expect.objectContaining({
        method: "thread/delta",
        params: expect.objectContaining({
          deltas: expect.arrayContaining([
            expect.objectContaining({
              kind: "extension.state",
              extensionKind: "bb/provider-model-catalog",
              payload: expect.objectContaining({
                models: catalog.map((model, index) =>
                  expect.objectContaining({
                    model: model.model,
                    isDefault: scenario.expectedDefaults[index],
                  }),
                ),
              }),
            }),
          ]),
        }),
      }),
    );
  });
});

it("recovers with a fresh app-server after a model catalog failure", async () => {
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

it("rejects a model catalog request with the missing-executable code when codex cannot be spawned", async () => {
  vi.stubEnv(
    "BB_CODEX_BRIDGE_APP_SERVER_COMMAND",
    join(tmpdir(), "bb-codex-does-not-exist"),
  );
  vi.stubEnv("BB_CODEX_BRIDGE_APP_SERVER_ARGS", "[]");

  harness.sendRequest(1, "model/list", {});
  const response = await harness.waitForResponse(1);

  expect(response.error?.code).toBe(BRIDGE_JSON_RPC_ERRORS.MISSING_EXECUTABLE);
  expect(response.error?.message).toContain("could not find the Codex CLI");
});
