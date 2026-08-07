import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createRealThread,
  pathExists,
  REAL_POLL_INTERVAL_MS,
  sendAndWaitForIdle,
  TEST_TIMEOUT_MS,
} from "./provider-smoke-harness.js";

const PROVIDER_ID = "claude-code";

async function waitForCondition(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs: number,
  message: string,
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, REAL_POLL_INTERVAL_MS));
  }
  throw new Error(message);
}

describe("real Claude background process integration", () => {
  it(
    "survives a same-daemon session reconnect and follow-up",
    async () => {
      const { environment, harness, thread } = await createRealThread({
        providerId: PROVIDER_ID,
        workspace: { path: null, type: "unmanaged" },
      });

      try {
        if (!environment.path) {
          throw new Error("Expected an unmanaged workspace path");
        }
        const markerPath = path.join(
          environment.path,
          "background-survived-reconnect.txt",
        );

        await sendAndWaitForIdle({
          harness,
          providerId: PROVIDER_ID,
          threadId: thread.id,
          text: `Use the Bash tool exactly once to execute this exact command: sleep 40; printf survived > ${JSON.stringify(markerPath)}. Set Bash's run_in_background parameter to true. As soon as Bash accepts it, reply exactly STARTED. Do not poll it, wait for it, or use another tool.`,
        });
        expect(await pathExists(markerPath)).toBe(false);

        // Cross the host daemon's 10-second shell-environment refresh TTL so
        // the follow-up exercises the same idle-gap maintenance path as the
        // report, while the background command remains live.
        await new Promise((resolve) => setTimeout(resolve, 12_000));
        expect(await pathExists(markerPath)).toBe(false);

        const runtimeBeforeReconnect = harness.daemonApp.runtimeManager.get(
          environment.id,
        )?.runtime;
        const previousSessionId = harness.daemonApp.connection.sessionId;
        if (!runtimeBeforeReconnect || !previousSessionId) {
          throw new Error("Expected a live runtime and daemon session");
        }

        harness.daemonApp.connection.handleSessionInvalidated({
          code: "inactive_session",
          observedSessionId: previousSessionId,
          source: "postEvents",
        });
        await waitForCondition(
          () => {
            const sessionId = harness.daemonApp.connection.sessionId;
            return sessionId !== null && sessionId !== previousSessionId;
          },
          10_000,
          "Daemon did not establish a replacement session",
        );

        expect(
          harness.daemonApp.runtimeManager.get(environment.id)?.runtime,
        ).toBe(runtimeBeforeReconnect);

        await sendAndWaitForIdle({
          harness,
          providerId: PROVIDER_ID,
          threadId: thread.id,
          text: "Reply exactly FOLLOWUP. Do not use any tools.",
        });
        await waitForCondition(
          () => pathExists(markerPath),
          45_000,
          "Background command did not write its marker after reconnect",
        );

        expect(await fs.readFile(markerPath, "utf8")).toBe("survived");
      } finally {
        await harness.cleanup();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
