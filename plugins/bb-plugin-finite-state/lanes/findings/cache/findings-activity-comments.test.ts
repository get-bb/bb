import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";
import { createPluginContext } from "../../../lib/context.js";
import type { Json, RemotePage } from "../../../lib/remote/types.js";
import { hydrateFindingActivity, listFindingActivity } from "./activity.js";
import {
  commentMutationAuthorizationUnavailable,
  hydrateFindingComments,
  listFindingComments,
} from "./comments.js";

const hosts: Array<ReturnType<typeof createFakePluginHost>> = [];

afterEach(async () => {
  await Promise.all(hosts.splice(0).map(host => host.harness.lifecycle.dispose()));
});

function pages<T>(values: RemotePage<T>[]): AsyncIterable<RemotePage<T>> {
  return { async *[Symbol.asyncIterator]() { for (const value of values) yield value; } };
}

function fixture() {
  const host = createFakePluginHost({ pluginId: `findings-detail-${hosts.length}` });
  hosts.push(host);
  const db = createPluginContext(host.bb).db();
  const at = "2026-08-13T00:00:00.000Z";
  db.prepare(
    `INSERT INTO pull_generation
       (project_id, project_version_id, generation_id, status, requested_kinds_json,
        started_at, completed_at, accepted_at, error)
     VALUES ('project-1', 'pv-1', 'generation-1', 'accepted', '["finding"]', ?, ?, ?, NULL)`,
  ).run(at, at, at);
  db.prepare(
    `INSERT INTO sync_state
       (project_id, project_version_id, entity_kind, accepted_generation_id,
        staging_generation_id, base_revision, staging_continuation, staged_pages,
        staged_rows, last_pull, error)
     VALUES ('project-1', 'pv-1', 'finding', 'generation-1', NULL, 1, NULL, 0, 0, ?, NULL)`,
  ).run(at);
  db.prepare(
    `INSERT INTO findings
       (project_id, project_version_id, generation_id, finding_id, stable_key,
        cve, component_name, component_version, title, raw, pulled_at)
     VALUES ('project-1', 'pv-1', 'generation-1', 'finding-1', 'stable-1',
             'CVE-2026-1', 'library', '1.0.0', 'Finding', '{}', ?)`,
  ).run(at);
  return db;
}

describe("finding activity and comments", () => {
  it("hydrates attribution and tuples transactionally, then serves the prior cache offline", async () => {
    const db = fixture();
    const activityRows: Array<Record<string, Json>> = [
      { id: "event-2", at: "2026-08-13T02:00:00.000Z", actor: "Bob", source: "vex", old: { status: "A" }, new: { status: "B" } },
      { id: "event-1", at: "2026-08-13T01:00:00.000Z", actor: "Alice", action: "created", old: null, new: { status: "A" } },
    ];
    const platform = {
      getFindingActivity() {
        return pages([
          { items: [activityRows[0]], total: 2, next: "more" },
          { items: [activityRows[1]], total: 2, next: null },
        ]);
      },
    };
    await expect(hydrateFindingActivity(db, platform, {
      projectId: "project-1", projectVersionId: "pv-1", findingId: "finding-1",
    })).resolves.toBe(2);
    const cached = listFindingActivity(db, {
      projectId: "project-1", projectVersionId: "pv-1", findingId: "finding-1", limit: 1,
    });
    expect(cached.items[0]).toMatchObject({
      eventId: "event-2", actor: "Bob", source: "vex", oldTuple: { status: "A" }, newTuple: { status: "B" },
    });
    expect(cached.next).not.toBeNull();
    const failing = {
      getFindingActivity() {
        return { async *[Symbol.asyncIterator]() { throw new Error("offline"); } };
      },
    };
    await expect(hydrateFindingActivity(db, failing, {
      projectId: "project-1", projectVersionId: "pv-1", findingId: "finding-1",
    })).rejects.toThrow("offline");
    expect(listFindingActivity(db, {
      projectId: "project-1", projectVersionId: "pv-1", findingId: "finding-1", limit: 10,
    }).items).toHaveLength(2);
  });

  it("keeps comments version-scoped, refreshes only after complete reads, and fails mutations closed", async () => {
    const db = fixture();
    const commentRows: Array<Record<string, Json>> = [
      { id: "comment-1", body: "first", actor: "Alice", createdAt: "2026-08-13T01:00:00.000Z" },
      { id: "comment-2", text: "second", actorLabel: "Bob", createdAt: "2026-08-13T02:00:00.000Z", updatedAt: "2026-08-13T03:00:00.000Z" },
    ];
    const platform = {
      listFindingComments() {
        return pages([
          { items: [commentRows[0]], total: 2, next: "more" },
          { items: [commentRows[1]], total: 2, next: null },
        ]);
      },
    };
    await expect(hydrateFindingComments(db, platform, {
      projectId: "project-1", projectVersionId: "pv-1", findingId: "finding-1",
    })).resolves.toBe(2);
    expect(listFindingComments(db, {
      projectId: "project-1", projectVersionId: "pv-1", findingId: "finding-1", limit: 10,
    }).items).toEqual([
      { id: "comment-1", findingId: "finding-1", actorLabel: "Alice", text: "first", createdAt: "2026-08-13T01:00:00.000Z", updatedAt: null },
      { id: "comment-2", findingId: "finding-1", actorLabel: "Bob", text: "second", createdAt: "2026-08-13T02:00:00.000Z", updatedAt: "2026-08-13T03:00:00.000Z" },
    ]);
    const ambiguousFailure = {
      listFindingComments() {
        return { async *[Symbol.asyncIterator]() { throw new Error("connection reset"); } };
      },
    };
    await expect(hydrateFindingComments(db, ambiguousFailure, {
      projectId: "project-1", projectVersionId: "pv-1", findingId: "finding-1",
    })).rejects.toThrow("connection reset");
    expect(listFindingComments(db, {
      projectId: "project-1", projectVersionId: "pv-1", findingId: "finding-1", limit: 10,
    }).total).toBe(2);
    expect(() => commentMutationAuthorizationUnavailable()).toThrow(/refresh before retrying/u);
  });
});
