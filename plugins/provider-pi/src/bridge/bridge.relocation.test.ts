import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  FULL_PERMISSION_OPTIONS,
  startFakePiBridge,
  type FakePiBridgeHarness,
} from "./test-support.js";
import { definePiRelocationTest } from "./relocation-test-support.js";

let harness: FakePiBridgeHarness | undefined;

afterEach(async () => {
  await harness?.teardown();
  vi.unstubAllEnvs();
});

definePiRelocationTest("retained");

it("keeps the original session and discards an unsuccessful relocation before retrying", async () => {
  harness = await startFakePiBridge({
    prefix: "bb-pi-relocation-retry-",
    initialize: true,
  });
  mkdirSync(harness.sessionDir, { recursive: true });
  const sessionFile = join(harness.sessionDir, "pi_original.jsonl");
  const contents =
    JSON.stringify({
      type: "session",
      version: 3,
      id: "original",
      cwd: join(harness.workspaceDir, "removed"),
      timestamp: "2026-01-01T00:00:00.000Z",
    }) + "\n";
  writeFileSync(sessionFile, contents);
  const params = {
    threadId: "thr_relocation_retry",
    providerThreadId: "pi_original",
    cwd: harness.workspaceDir,
    instructionMode: "append",
    options: { ...FULL_PERMISSION_OPTIONS, model: "missing-model" },
  };
  const failed = await harness.request(200, "thread/resume", params);
  expect(failed.error).toMatchObject({
    message: expect.stringContaining("Failed to resolve Pi model"),
  });
  expect(readFileSync(sessionFile, "utf8")).toBe(contents);
  expect(readdirSync(harness.sessionDir)).toEqual(["pi_original.jsonl"]);
  expect(
    harness.messages.some((message) => message.method === "thread/identity"),
  ).toBe(false);
  const retried = await harness.request(201, "thread/resume", {
    ...params,
    options: FULL_PERMISSION_OPTIONS,
  });
  expect(retried.error).toBeUndefined();
  expect(retried.result).toMatchObject({
    providerThreadId: expect.stringMatching(/^pi_/),
  });
  expect(readFileSync(sessionFile, "utf8")).toBe(contents);
  expect(readdirSync(harness.sessionDir)).toHaveLength(2);
}, 90_000);
