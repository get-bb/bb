import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    providerThreadId: "quota-cleanup",
    intent: "release",
    activeTurnId: null,
  });
  await harness.waitForResponse(99);
  harness.restore();
  vi.unstubAllEnvs();
  rmSync(workspaceDir, { recursive: true, force: true });
});

it.each([
  "native",
  "recover",
  "error",
  "timeout",
  "release",
  "other-error",
  "no-update-error",
  "credits",
  "expired",
  "model-bucket",
] as const)(
  "keeps quota ahead of failure and reads only missing failure metadata (%s)",
  async (outcome) => {
    const scriptPath = join(workspaceDir, "script.json");
    const requestLogPath = join(workspaceDir, "requests.jsonl");
    const resetsAt = Math.floor(Date.now() / 1000) + 3600;
    const recovered = {
      limitId: "codex",
      primary: { usedPercent: 100, windowDurationMins: 300, resetsAt },
      rateLimitReachedType: "rate_limit_reached",
    };
    const native =
      outcome === "native"
        ? recovered
        : outcome === "expired"
          ? { ...recovered, primary: { ...recovered.primary, resetsAt: 1 } }
          : outcome === "credits"
            ? {
                limitId: "codex",
                credits: { hasCredits: false, unlimited: false, balance: "0" },
                rateLimitReachedType: "workspace_member_credits_depleted",
              }
            : { limitId: "codex", primary: null, secondary: null };
    const error = {
      message: "Original provider failure",
      codexErrorInfo:
        outcome === "other-error"
          ? "internalServerError"
          : "usageLimitExceeded",
      additionalDetails: null,
    };
    writeFileSync(
      scriptPath,
      JSON.stringify({
        requestLogPath,
        rateLimitRead: {
          hang: outcome === "timeout" || outcome === "release",
          error: outcome === "error" || outcome === "no-update-error",
          delayMs: 20,
          result:
            outcome === "model-bucket"
              ? {
                  rateLimits: { limitId: "codex" },
                  rateLimitsByLimitId: {
                    codex: { limitId: "codex" },
                    premium: { ...recovered, limitId: "premium" },
                    unrelated: {
                      ...recovered,
                      limitId: "unrelated",
                      primary: {
                        ...recovered.primary,
                        resetsAt: resetsAt + 86400,
                      },
                    },
                  },
                }
              : { rateLimits: recovered },
        },
        turns: [
          [
            {
              method: "turn/started",
              params: {
                threadId: "x",
                turn: { id: "turn-limit", status: "inProgress" },
              },
            },
            {
              method: "account/rateLimits/updated",
              params: {
                rateLimits:
                  outcome === "model-bucket" ? { limitId: "premium" } : native,
              },
            },
            {
              method: "error",
              params: {
                threadId: "x",
                turnId: "turn-limit",
                error,
                willRetry: false,
              },
            },
            {
              method: "turn/completed",
              params: {
                threadId: "x",
                turn: { id: "turn-limit", status: "failed", error },
              },
            },
          ].filter(
            (entry) =>
              outcome !== "no-update-error" ||
              entry.method !== "account/rateLimits/updated",
          ),
        ],
      }),
    );
    stubFakeCodexAppServer(scriptPath);
    const requests = () =>
      readFileSync(requestLogPath, "utf8")
        .trim()
        .split("\n")
        .map((line) =>
          z.object({ method: z.string() }).parse(JSON.parse(line)),
        );
    harness.sendRequest(1, "thread/start", {
      threadId: THREAD_ID,
      cwd: workspaceDir,
      instructionMode: "append",
      options: FULL_ACCESS_SESSION_OPTIONS,
    });
    const response = await harness.waitForResponse(1);
    expect(requests().some((r) => r.method === "account/rateLimits/read")).toBe(
      false,
    );
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
    await harness.waitForResponse(2);
    if (outcome === "release") {
      await vi.waitFor(() =>
        expect(
          requests().some((r) => r.method === "account/rateLimits/read"),
        ).toBe(true),
      );
      harness.sendRequest(3, "thread/stop", {
        threadId: THREAD_ID,
        providerThreadId,
        intent: "release",
        activeTurnId: null,
      });
      await harness.waitForResponse(3);
      expect(
        assembleCapturedThreadEvents(harness.messages, "codex").filter(
          (e) => e.type === "turn/completed",
        ),
      ).toEqual([]);
      return;
    }
    await vi.waitFor(
      () =>
        expect(
          assembleCapturedThreadEvents(harness.messages, "codex").some(
            (e) => e.type === "turn/completed",
          ),
        ).toBe(true),
      { timeout: 7000 },
    );
    const events = assembleCapturedThreadEvents(harness.messages, "codex");
    const completed = events.findIndex((e) => e.type === "turn/completed");
    const quotas = events
      .slice(0, completed)
      .filter((e) => e.type === "provider/rateLimits/updated");
    const shouldRead = !["native", "credits", "other-error"].includes(outcome);
    expect(
      requests().filter((r) => r.method === "account/rateLimits/read"),
    ).toHaveLength(shouldRead ? 1 : 0);
    expect(quotas.length).toBeGreaterThan(0);
    if (["native", "recover", "expired", "model-bucket"].includes(outcome))
      expect(quotas.at(-1)).toMatchObject({
        rateLimits: {
          status: "blocked",
          windows: [{ resetsAtMs: resetsAt * 1000 }],
        },
      });
    if (["error", "timeout", "no-update-error"].includes(outcome))
      expect(quotas.at(-1)).toMatchObject({
        rateLimits: { status: "unknown", windows: [] },
      });
    expect(events[completed]).toMatchObject({ status: "failed" });
    expect(events.some((e) => e.type === "provider/error")).toBe(true);
  },
  10000,
);
