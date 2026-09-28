import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  experimental_assembleCapturedThreadEvents as assembleCapturedThreadEvents,
  experimental_createBridgeJsonRpcTestHarness as createBridgeJsonRpcTestHarness,
} from "@get-bb/plugin-sdk/provider-bridge/testing";
import type { BridgeJsonRpcTestHarness } from "@get-bb/plugin-sdk/provider-bridge/testing";
import { handleLine } from "./bridge.js";
import {
  FULL_ACCESS_SESSION_OPTIONS,
  stubFakeCodexAppServer,
} from "./fake-codex-app-server-harness.js";

const THREAD_ID = "thr_quota_hydration";
let harness: BridgeJsonRpcTestHarness;
let workspaceDir: string;

beforeEach(() => {
  workspaceDir = mkdtempSync(join(tmpdir(), "bb-codex-quota-"));
  harness = createBridgeJsonRpcTestHarness(handleLine);
});

afterEach(async () => {
  harness.sendRequest(99, "thread/stop", {
    threadId: THREAD_ID,
    intent: "release",
    activeTurnId: null,
  });
  await harness.waitForResponse(99);
  harness.restore();
  vi.unstubAllEnvs();
  rmSync(workspaceDir, { recursive: true, force: true });
});

it.each([false, true])(
  "starts before quota hydration settles and preserves rolling updates (read fails: %s)",
  async (error) => {
    const scriptPath = join(workspaceDir, "script.json");
    writeFileSync(
      scriptPath,
      JSON.stringify({
        deferredRateLimitRead: {
          error,
          result: {
            rateLimits: {
              primary: { usedPercent: 20, resetsAt: 1_781_120_400 },
              secondary: {
                usedPercent: 100,
                windowDurationMins: 10_080,
                resetsAt: 1_781_720_400,
              },
              rateLimitReachedType: "rate_limit_reached",
            },
          },
          updates: [
            { primary: { usedPercent: 95, resetsAt: 1_781_120_400 } },
            {
              secondary: {
                usedPercent: 30,
                windowDurationMins: 10_080,
                resetsAt: 1_781_720_400,
              },
            },
          ],
        },
      }),
    );
    stubFakeCodexAppServer(scriptPath);
    harness.sendRequest(1, "thread/start", {
      threadId: THREAD_ID,
      cwd: workspaceDir,
      instructionMode: "append",
      options: FULL_ACCESS_SESSION_OPTIONS,
    });
    const response = await harness.waitForResponse(1);
    expect(response).not.toHaveProperty("error");
    const { providerThreadId } = z
      .object({ providerThreadId: z.string() })
      .parse(response.result);
    harness.sendRequest(2, "turn/start", {
      threadId: THREAD_ID,
      providerThreadId,
      input: [{ type: "text", text: "Hello" }],
      clientRequestId: "creq_abcdefghjk",
      options: FULL_ACCESS_SESSION_OPTIONS,
    });
    expect(await harness.waitForResponse(2)).not.toHaveProperty("error");
    await vi.waitFor(() => {
      const events = assembleCapturedThreadEvents(harness.messages, "codex");
      expect(events.some((event) => event.type === "turn/started")).toBe(true);
      const quotas = events.filter(
        (event) => event.type === "provider/rateLimits/updated",
      );
      expect(quotas).toHaveLength(2);
      expect(quotas[0]).toMatchObject({
        rateLimits: { status: error ? "warning" : "blocked" },
      });
      expect(quotas[1]).toMatchObject({
        rateLimits: {
          status: "warning",
          reachedReason: null,
          windows: [
            { providerKey: "primary", status: "warning" },
            { providerKey: "secondary", status: "allowed" },
          ],
        },
      });
    });
  },
);
