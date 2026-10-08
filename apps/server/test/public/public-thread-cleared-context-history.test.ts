import { expect, it } from "vitest";
import { getAppSettings } from "@bb/db";
import {
  defaultAppSettings,
  THREAD_CONTEXT_CLEAR_OPERATION,
  threadScope,
} from "@bb/domain";
import {
  threadConversationOutlineResponseSchema,
  threadTimelineResponseSchema,
} from "@bb/server-contract";
import { readJson } from "../helpers/json.js";
import { seedEvent, seedThreadFixture } from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

it("follows keepHistoryAfterContextClear across cached timeline, outline, and message reads", async () => {
  await withTestHarness(async (harness) => {
    const { thread } = seedThreadFixture(harness);
    const common = { threadId: thread.id, scope: threadScope() };
    seedEvent(harness.deps, {
      ...common,
      sequence: 1,
      type: "system/manager/user_message",
      data: { text: "Earlier task" },
    });
    seedEvent(harness.deps, {
      ...common,
      sequence: 2,
      type: "system/operation",
      data: {
        operation: THREAD_CONTEXT_CLEAR_OPERATION,
        operationId: "clear",
        status: "completed",
        message: "Fresh context",
      },
    });
    seedEvent(harness.deps, {
      ...common,
      sequence: 3,
      type: "system/manager/user_message",
      data: { text: "Fresh task" },
    });
    const read = async () => {
      const timeline = threadTimelineResponseSchema.parse(
        await readJson(
          await harness.app.request(`/api/v1/threads/${thread.id}/timeline`),
        ),
      );
      const outline = threadConversationOutlineResponseSchema.parse(
        await readJson(
          await harness.app.request(
            `/api/v1/threads/${thread.id}/conversation-outline`,
          ),
        ),
      );
      const message = await harness.app.request(
        `/api/v1/threads/${thread.id}/messages/1`,
      );
      return {
        contextBoundarySeq: timeline.contextBoundarySeq,
        rows: timeline.rows.map((row) =>
          row.kind === "conversation"
            ? row.text
            : row.kind === "system"
              ? row.title
              : row.kind,
        ),
        outline: outline.items.map((item) => item.preview),
        messageStatus: message.status,
      };
    };
    const put = (settings: object) =>
      harness.app.request("/api/v1/settings/general", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(settings),
      });
    const hidden = {
      contextBoundarySeq: 2,
      rows: ["Context cleared", "Fresh task"],
      outline: ["Fresh task"],
      messageStatus: 404,
    };

    expect(await read()).toEqual(hidden);
    expect(
      (
        await put({
          ...defaultAppSettings,
          keepHistoryAfterContextClear: true,
        })
      ).status,
    ).toBe(200);
    const kept = {
      contextBoundarySeq: 2,
      rows: ["Earlier task", "Context cleared", "Fresh task"],
      outline: ["Earlier task", "Fresh task"],
      messageStatus: 200,
    };
    expect(await read()).toEqual(kept);

    const { keepHistoryAfterContextClear: omitted, ...legacy } =
      defaultAppSettings;
    expect(omitted).toBe(false);
    expect((await put({ ...legacy, showKeyboardHints: false })).status).toBe(
      200,
    );
    expect(getAppSettings(harness.db).keepHistoryAfterContextClear).toBe(true);
    expect(await read()).toEqual(kept);

    expect((await put(defaultAppSettings)).status).toBe(200);
    expect(await read()).toEqual(hidden);
  });
});
