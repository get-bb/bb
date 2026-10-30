import { describe, expect, it, onTestFinished, vi } from "vitest";
import type { ChildProcess } from "node:child_process";
import * as hostProcesses from "../../../../packages/process-utils/src/host-process.js";
import {
  getThreadEvents,
  getThreadResponse,
  sendTextMessage,
} from "../../helpers/api.js";
import {
  waitForHostConnected,
  waitForHostDisconnected,
  waitForThreadOutputContaining,
  waitForThreadStatus,
} from "../../helpers/assertions.js";
import { withHarness } from "../../helpers/harness.js";
import {
  ACTIVE_TIMEOUT_MS,
  createRecoveryThread,
  RECOVERY_TEST_TIMEOUT_MS,
  HOST_OFFLINE_TIMEOUT_MS,
  RECOVERY_TIMEOUT_MS,
  STOP_DELAY_TEXT,
} from "./shared.js";

describe.sequential("fake provider active crash recovery integration", () => {
  it(
    "marks in-flight work failed on daemon crash and allows retry after restart",
    async () => {
      const workers: { child: ChildProcess; closed: boolean }[] = [];
      const fork = hostProcesses.forkHostProcess;
      const observation = vi
        .spyOn(hostProcesses, "forkHostProcess")
        .mockImplementation((...args) => {
          const child = fork(...args);
          if (String(args[0]).includes("plugin-host-worker")) {
            const worker = { child, closed: false };
            child.once("close", () => {
              worker.closed = true;
            });
            workers.push(worker);
          }
          return child;
        });
      onTestFinished(async () => {
        observation.mockRestore();
        await Promise.all(
          workers.map(({ child, closed }) => {
            if (closed) return;
            return new Promise<void>((resolve) => {
              child.once("close", resolve);
              child.kill("SIGKILL");
            });
          }),
        );
      });
      await withHarness(async (harness) => {
        const { thread } = await createRecoveryThread(
          harness,
          "Crash Recovery Active",
        );

        await sendTextMessage(harness.api, thread.id, {
          text: STOP_DELAY_TEXT,
        });
        await waitForThreadStatus(
          harness.api,
          thread.id,
          "active",
          ACTIVE_TIMEOUT_MS,
        );

        expect(workers.length).toBeGreaterThan(0);
        await harness.crashDaemon();
        expect(workers.every((worker) => worker.closed)).toBe(true);
        await waitForHostDisconnected(
          harness.api,
          harness.hostId,
          HOST_OFFLINE_TIMEOUT_MS,
        );
        const disconnectedThread = await getThreadResponse(
          harness.api,
          thread.id,
        );
        if (disconnectedThread.status === "active") {
          expect(disconnectedThread.runtime.displayStatus).toBe("active");
        } else {
          expect(disconnectedThread.status).toBe("error");
          expect(disconnectedThread.runtime.displayStatus).toBe("error");
        }

        await harness.startDaemon();
        await waitForHostConnected(harness.api, RECOVERY_TIMEOUT_MS);
        await waitForThreadStatus(
          harness.api,
          thread.id,
          "error",
          RECOVERY_TIMEOUT_MS,
        );

        await sendTextMessage(harness.api, thread.id, {
          text: "recovered after crash",
        });
        await waitForThreadOutputContaining(
          harness.api,
          thread.id,
          "recovered after crash",
          RECOVERY_TIMEOUT_MS,
        );
        await waitForThreadStatus(
          harness.api,
          thread.id,
          "idle",
          RECOVERY_TIMEOUT_MS,
        );

        const events = await getThreadEvents(harness.api, thread.id);
        expect(
          events.some(
            (event) =>
              event.type === "system/error" &&
              event.data.code === "thread_command_failed",
          ),
        ).toBe(true);
      });
    },
    RECOVERY_TEST_TIMEOUT_MS,
  );
});
