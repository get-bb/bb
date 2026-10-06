import { expect, it } from "vitest";
import {
  createConnection,
  migrate,
  listEnvironmentRemovals,
  recordEnvironmentRemoval,
} from "../../src/index.js";

it("pages durable removal occurrences independently of environment rows and explicitly resets expired cursors", () => {
  const db = createConnection(":memory:");
  migrate(db);
  try {
    const removal = {
      environmentId: "env_gone",
      hostId: "host_gone",
      path: "/removed",
      providerOwnedPath: true,
      removedAt: 1,
    };
    const first = recordEnvironmentRemoval(db, removal);
    const second = recordEnvironmentRemoval(db, { ...removal, removedAt: 2 });
    const page = listEnvironmentRemovals(db, null, 1, 3);
    expect(page).toEqual({
      status: "ok",
      removals: [first],
      nextCursor: first.id,
      hasMore: true,
    });
    expect(listEnvironmentRemovals(db, Number(page.nextCursor), 1, 3)).toEqual({
      status: "ok",
      removals: [second],
      nextCursor: second.id,
      hasMore: false,
    });
    expect(
      listEnvironmentRemovals(db, Number(second.id), 100, 3).removals,
    ).toEqual([]);
    const now = 31 * 86400000;
    expect(listEnvironmentRemovals(db, 0, 100, now)).toEqual({
      status: "cursorExpired",
      removals: [],
      nextCursor: second.id,
      hasMore: false,
    });
    const third = recordEnvironmentRemoval(db, { ...removal, removedAt: now });
    expect(Number(third.id)).toBeGreaterThan(Number(second.id));
    expect(
      listEnvironmentRemovals(db, Number(second.id), 100, now).removals,
    ).toEqual([third]);
    expect(listEnvironmentRemovals(db, 0, 100, now).status).toBe(
      "cursorExpired",
    );
    expect(listEnvironmentRemovals(db, null, 100, now).removals).toEqual([
      third,
    ]);
  } finally {
    db.$client.close();
  }
});
