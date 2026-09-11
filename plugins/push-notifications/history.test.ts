import { expect, it } from "vitest";
import { createPushNotificationHistory } from "./history.js";
import type { PushNotificationHistoryEntry } from "./contract.js";

it("caps dispatches at 200, merges channel attempts by identity, and resets per instance", () => {
  const history = createPushNotificationHistory();
  const first: PushNotificationHistoryEntry = {
    id: "first",
    title: "Finished",
    body: "Ready to review",
    threadId: "thread-1",
    createdAt: 1,
    channels: ["web"],
  };
  history.record(first);
  history.record({ ...first, id: "second", createdAt: 2 });
  history.record({ ...first, channels: ["web", "mobile"] });
  expect(history.list().map((entry) => [entry.id, entry.channels])).toEqual([
    ["second", ["web"]],
    ["first", ["web", "mobile"]],
  ]);
  for (let index = 3; index <= 201; index += 1) {
    history.record({ ...first, id: String(index), createdAt: index });
  }
  expect(history.list()).toHaveLength(200);
  expect(history.list()[0]?.id).toBe("201");
  expect(history.list().at(-1)?.id).toBe("second");
  expect(createPushNotificationHistory().list()).toEqual([]);
});
