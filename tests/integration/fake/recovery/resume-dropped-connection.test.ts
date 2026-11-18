import { eq } from "drizzle-orm";
import { hostDaemonSessions } from "@bb/db";
import { describe, expect, it } from "vitest";
import { getThread, sendTextMessage } from "../../helpers/api.js";
import {
  waitForThreadOutputContaining,
  waitForThreadStatus,
} from "../../helpers/assertions.js";
import { withHarness } from "../../helpers/harness.js";
import {
  ACTIVE_TIMEOUT_MS,
  createRecoveryThread,
  RECOVERY_TEST_TIMEOUT_MS,
  requireSessionId,
  TURN_TIMEOUT_MS,
} from "./shared.js";

describe.sequential("fake provider dropped daemon connection", () => {
  it(
    "resumes the same daemon session after its connection drops mid-turn, and the turn finishes",
    () =>
      withHarness(
        {
          experiments: { resumeDaemonSessions: true },
          proxyDaemonConnection: true,
        },
        async (harness) => {
          const { thread } = await createRecoveryThread(
            harness,
            "Resume Dropped Connection",
          );
          const sessionId = requireSessionId(harness);
          const text = "delay:3000 across a dropped connection";
          await sendTextMessage(harness.api, thread.id, { text });
          await waitForThreadStatus(
            harness.api,
            thread.id,
            "active",
            ACTIVE_TIMEOUT_MS,
          );

          expect(harness.dropDaemonConnections()).toBeGreaterThan(0);

          await waitForThreadOutputContaining(
            harness.api,
            thread.id,
            "across a dropped connection",
            TURN_TIMEOUT_MS,
          );
          await waitForThreadStatus(
            harness.api,
            thread.id,
            "idle",
            TURN_TIMEOUT_MS,
          );
          expect((await getThread(harness.api, thread.id)).status).toBe("idle");
          expect(harness.daemonApp.connection.sessionId).toBe(sessionId);
          expect(
            harness.db
              .select({
                id: hostDaemonSessions.id,
                status: hostDaemonSessions.status,
              })
              .from(hostDaemonSessions)
              .where(eq(hostDaemonSessions.hostId, harness.hostId))
              .all(),
          ).toEqual([{ id: sessionId, status: "active" }]);
        },
      ),
    RECOVERY_TEST_TIMEOUT_MS,
  );
});
