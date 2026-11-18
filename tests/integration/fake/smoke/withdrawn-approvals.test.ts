import type { TimelineRow } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import {
  getThreadTimeline,
  listThreadInteractions,
  sendTextMessage,
} from "../../helpers/api.js";
import {
  waitForEventType,
  waitForThreadOutputContaining,
  waitForThreadStatus,
} from "../../helpers/assertions.js";
import { withHarness } from "../../helpers/harness.js";
import {
  createProjectFixture,
  createReadyThread,
  TURN_TIMEOUT_MS,
} from "./shared.js";

function collectWorkRows(rows: readonly TimelineRow[]): TimelineRow[] {
  return rows.flatMap((row) => [
    ...(row.kind === "work" ? [row] : []),
    ...(row.kind === "turn" && row.children
      ? collectWorkRows(row.children)
      : []),
  ]);
}

describe.sequential("fake provider withdrawn approvals", () => {
  it("closes an approval the provider withdraws and dispatches the next message", () =>
    withHarness(async (harness) => {
      const project = await createProjectFixture(
        harness,
        "Withdrawn Approval Smoke",
      );
      const { thread } = await createReadyThread(harness, {
        projectId: project.id,
        workspace: {
          type: "unmanaged",
          path: harness.repoDir,
        },
      });

      await sendTextMessage(harness.api, thread.id, {
        text: "approve:command withdraw_approval delay:300",
      });
      await waitForEventType(
        harness.api,
        thread.id,
        "system/interaction/lifecycle",
        TURN_TIMEOUT_MS,
      );
      await waitForThreadOutputContaining(
        harness.api,
        thread.id,
        "Approval withdrawn",
        TURN_TIMEOUT_MS,
      );
      await waitForThreadStatus(
        harness.api,
        thread.id,
        "idle",
        TURN_TIMEOUT_MS,
      );
      await expect
        .poll(() => listThreadInteractions(harness.api, thread.id), {
          timeout: TURN_TIMEOUT_MS,
        })
        .toEqual([]);
      const timeline = await getThreadTimeline(harness.api, thread.id, {
        includeNestedRows: true,
      });
      expect(collectWorkRows(timeline.rows)).toEqual([
        expect.objectContaining({
          workKind: "command",
          status: "interrupted",
          approvalStatus: null,
        }),
      ]);

      await sendTextMessage(harness.api, thread.id, { text: "follow up" });
      await waitForThreadOutputContaining(
        harness.api,
        thread.id,
        "Response to: follow up",
        TURN_TIMEOUT_MS,
      );
    }));
});
