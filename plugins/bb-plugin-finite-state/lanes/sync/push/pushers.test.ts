import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import { createPluginContext } from "../../../lib/context.js";
import { RemoteLimiter } from "../../../lib/remote/rate-limit.js";
import type { AsEntity, AssuranceStudioClient } from "../../../lib/remote/types.js";
import { ENTITIES } from "../../../lib/sync/registry.js";
import type { PlanItem } from "../plan/index.js";
import { createAssuranceStudioPusher } from "./pushers.js";

const hosts: Array<ReturnType<typeof createFakePluginHost>> = [];

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.harness.lifecycle.dispose()));
});

function limiter(): RemoteLimiter {
  return new RemoteLimiter({
    concurrency: 1,
    maxAttempts: 1,
    maxBackoffMs: 1,
    scheduler: { now: Date.now, sleep: async (): Promise<void> => undefined },
    random: () => 0,
  });
}

describe("typed entity pushers", () => {
  it("sends the accepted review_version string and never entity_version", async () => {
    const host = createFakePluginHost({ pluginId: "finite-state-wp19-review-version" });
    hosts.push(host);
    const db = createPluginContext(host.bb).db();
    const projectId = "project-review-token";
    const projectVersionId = "version-review-token";
    const generationId = "generation-review-token";
    const pulledAt = "2026-08-13T03:00:00.000Z";
    const remoteId = "threat-remote-id";
    const key = ENTITIES.threat.key({ slug: "review-token" });
    db.prepare(
      `INSERT INTO pull_generation
         (project_id, project_version_id, generation_id, status,
          requested_kinds_json, started_at, completed_at, accepted_at)
       VALUES (?, ?, ?, 'accepted', '["threat"]', ?, ?, ?)`,
    ).run(projectId, projectVersionId, generationId, pulledAt, pulledAt, pulledAt);
    db.prepare(
      `INSERT INTO sync_state
         (project_id, project_version_id, entity_kind, accepted_generation_id, base_revision, last_pull)
       VALUES (?, ?, 'threat', ?, 0, ?)`,
    ).run(projectId, projectVersionId, generationId, pulledAt);
    db.prepare(
      `INSERT INTO id_map
         (project_id, project_version_id, entity_kind, generation_id,
          entity_key, remote_id, pulled_at)
       VALUES (?, ?, 'threat', ?, ?, ?, ?)`,
    ).run(projectId, projectVersionId, generationId, key, remoteId, pulledAt);
    db.prepare(
      `INSERT INTO entity_review_state
         (project_id, project_version_id, generation_id, entity_kind,
          entity_key, remote_id, review_status, review_version, pulled_at)
       VALUES (?, ?, ?, 'threat', ?, ?, 'human_approved', ?, ?)`,
    ).run(
      projectId,
      projectVersionId,
      generationId,
      key,
      remoteId,
      "9007199254740993",
      pulledAt,
    );

    let entity: AsEntity = {
      id: remoteId,
      projectId,
      kind: "threat",
      reviewVersion: "9007199254740993",
      reviewStatus: "human_approved",
      humanEdited: true,
      fields: { slug: "review-token", title: "before" },
    };
    let sentFields: Record<string, unknown> | null = null;
    const client = {
      async *listEntities() { yield { items: [entity], next: null, total: 1 }; },
      async getEntity() { return entity; },
      async createEntity() { throw new Error("unexpected create"); },
      async updateEntity(_kind, input) {
        sentFields = structuredClone(input.fields);
        entity = {
          ...entity,
          fields: { ...entity.fields, title: input.fields["title"] ?? null },
        };
        return { success: true, entity, reviewStatusSet: false, reviewStatusReason: null } as const;
      },
      async deleteEntity() { return { success: true } as const; },
    } satisfies Pick<
      AssuranceStudioClient,
      "listEntities" | "getEntity" | "createEntity" | "updateEntity" | "deleteEntity"
    >;
    const planItem: PlanItem = {
      projectId,
      projectVersionId,
      kind: "threat",
      key,
      label: "review-token",
      operation: "update",
      expectedBaseContentHash: "base-hash",
      fields: [{
        field: "title",
        base: { present: true, value: "before" },
        ours: { present: true, value: "after" },
        theirs: { present: true, value: "before" },
      }],
      conflicts: [],
      referrers: [],
      error: null,
    };
    const pusher = createAssuranceStudioPusher({ db, client, limiter: limiter(), kind: "threat" });

    await pusher.apply(planItem, {
      runId: "review-token-run",
      scope: { projectId, projectVersionId },
    });

    expect(sentFields).toEqual({ title: "after", review_version: "9007199254740993" });
    expect(sentFields).not.toHaveProperty("entity_version");
  });
});
