import { turnScope } from "@bb/domain";
import { expect, it } from "vitest";
import {
  buildEventProjection,
  type ThreadEventWithMeta,
} from "../src/build-event-projection.js";
import { getProjectionEntryMessages } from "../src/event-projection-flatten.js";

function editHistory(count: number): ThreadEventWithMeta[] {
  const history: ThreadEventWithMeta[] = [];
  function append(event: ThreadEventWithMeta["event"]): void {
    const sequence = history.length + 1;
    history.push({
      event,
      meta: { id: `event-${sequence}`, seq: sequence, createdAt: sequence },
    });
  }
  const common = {
    threadId: "responsiveness-thread",
    providerThreadId: "responsiveness-provider",
    scope: turnScope("responsiveness-turn"),
  };
  append({ ...common, type: "turn/started" });
  for (let index = 0; index < count; index++) {
    const item = {
      type: "fileChange" as const,
      id: `edit-${index}`,
      changes: [{ path: `src/file-${index}.ts`, kind: "update" as const }],
      approvalStatus: null,
    };
    append({
      ...common,
      type: "item/started",
      item: { ...item, status: "pending" },
    });
    append({
      ...common,
      type: "item/fileChange/outputDelta",
      itemId: item.id,
      delta: `saved-${index}`,
    });
    append({
      ...common,
      type: "item/completed",
      item: { ...item, status: "completed" },
    });
  }
  return history;
}

it("projects a long streamed edit history without a half-second synchronous stall", async () => {
  const options = {
    threadName: "Responsiveness fixture",
    threadStatus: "active" as const,
    turnMessageDetail: "full" as const,
  };
  buildEventProjection(editHistory(100), options);
  const history = editHistory(6000);
  const startedAt = performance.now();
  const pendingTimer = new Promise<number>((resolve) => {
    setTimeout(() => resolve(performance.now() - startedAt), 0);
  });
  const projection = buildEventProjection(history, options);
  const projectionMs = performance.now() - startedAt;
  const timerDelayMs = await pendingTimer;
  const edits = projection.entries
    .flatMap(getProjectionEntryMessages)
    .filter((message) => message.kind === "file-edit");
  console.log(
    JSON.stringify({
      events: history.length,
      edits: edits.length,
      projectionMs,
      timerDelayMs,
    }),
  );
  expect(edits).toHaveLength(6000);
  expect(edits[0]?.stdout).toBe("saved-0");
  expect(edits[5999]?.stdout).toBe("saved-5999");
  expect(edits.every((message) => message.status === "completed")).toBe(true);
  expect(projectionMs).toBeLessThan(500);
}, 30_000);
