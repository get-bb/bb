import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import type Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { createPluginContext } from "../../../lib/context.js";
import { ENTITIES, type EntityKind } from "../../../lib/sync/registry.js";
import { canonicalJson } from "../serialize/canonical.js";
import { createSerializer } from "../serialize/serializer.js";
import {
  BaseSnapshotFenceError,
  BaseSnapshotStore,
  type BaseRow,
} from "./base-snapshot.js";
import { IdMapStore } from "./id-map.js";

const hosts: Array<ReturnType<typeof createFakePluginHost>> = [];
const PULLED_AT = "2026-08-12T12:00:00.000Z";
const HASH_OPTIONS = {
  idToSlug: (_remoteId: string): null => null,
  onWarning: (): void => undefined,
};

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.harness.lifecycle.dispose()));
});

function createDb(label: string): Database.Database {
  const host = createFakePluginHost({ pluginId: `finite-state-wp16-${label}` });
  hosts.push(host);
  return createPluginContext(host.bb).db();
}

function insertGeneration(
  db: Database.Database,
  projectId: string,
  projectVersionId: string,
  generationId: string,
  status: "accepted" | "staging",
): void {
  db.prepare(
    `INSERT INTO pull_generation
       (project_id, project_version_id, generation_id, status,
        requested_kinds_json, started_at, completed_at, accepted_at)
     VALUES (?, ?, ?, ?, '["threat"]', ?, ?, ?)`,
  ).run(
    projectId,
    projectVersionId,
    generationId,
    status,
    PULLED_AT,
    status === "accepted" ? PULLED_AT : null,
    status === "accepted" ? PULLED_AT : null,
  );
}

function insertSyncState(
  db: Database.Database,
  projectId: string,
  projectVersionId: string,
  acceptedGenerationId: string,
  stagingGenerationId: string | null,
  baseRevision: number,
): void {
  db.prepare(
    `INSERT INTO sync_state
       (project_id, project_version_id, entity_kind, accepted_generation_id,
        staging_generation_id, base_revision)
     VALUES (?, ?, 'threat', ?, ?, ?)`,
  ).run(
    projectId,
    projectVersionId,
    acceptedGenerationId,
    stagingGenerationId,
    baseRevision,
  );
}

function hash(kind: EntityKind, payload: Record<string, unknown>): string {
  return createSerializer(kind).contentHash(payload, HASH_OPTIONS);
}

function insertBase(
  db: Database.Database,
  value: Omit<BaseRow, "contentHash">,
): string {
  const contentHash = hash(value.entityKind, value.payload);
  db.prepare(
    `INSERT INTO base_snapshot
       (project_id, project_version_id, entity_kind, generation_id,
        entity_key, remote_id, payload, content_hash, pulled_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    value.projectId,
    value.projectVersionId,
    value.entityKind,
    value.generationId,
    value.entityKey,
    value.remoteId,
    canonicalJson(value.payload),
    contentHash,
    value.pulledAt,
  );
  if (value.remoteId !== null) {
    db.prepare(
      `INSERT INTO id_map
         (project_id, project_version_id, entity_kind, generation_id,
          entity_key, remote_id, pulled_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      value.projectId,
      value.projectVersionId,
      value.entityKind,
      value.generationId,
      value.entityKey,
      value.remoteId,
      value.pulledAt,
    );
  }
  return contentHash;
}

function threatKey(slug: string): string {
  return ENTITIES.threat.key({ slug });
}

function stagingRow(
  entityKey: string,
  remoteId: string,
  payload: Record<string, unknown>,
): BaseRow {
  return {
    projectId: "project-a",
    projectVersionId: "version-a",
    entityKind: "threat",
    generationId: "staging-a",
    entityKey,
    remoteId,
    payload,
    contentHash: "untrusted-caller-hash",
    pulledAt: PULLED_AT,
  };
}

describe("BaseSnapshotStore", () => {
  it("rolls back a failed staging page and keeps accepted readers on the prior generation", () => {
    const db = createDb("staging-atomic");
    const store = new BaseSnapshotStore(db);
    const acceptedKey = threatKey("accepted-threat");
    const duplicateKey = threatKey("duplicate-threat");
    insertGeneration(db, "project-a", "version-a", "accepted-a", "accepted");
    insertGeneration(db, "project-a", "version-a", "staging-a", "staging");
    insertSyncState(db, "project-a", "version-a", "accepted-a", "staging-a", 7);
    insertBase(db, {
      projectId: "project-a",
      projectVersionId: "version-a",
      entityKind: "threat",
      generationId: "accepted-a",
      entityKey: acceptedKey,
      remoteId: "remote-accepted",
      payload: { slug: "accepted-threat", title: "Accepted" },
      pulledAt: PULLED_AT,
    });

    expect(() => store.putStagingPage(
      "project-a",
      "version-a",
      "threat",
      "staging-a",
      [
        stagingRow(duplicateKey, "remote-one", { slug: "duplicate-threat", title: "First" }),
        stagingRow(duplicateKey, "remote-two", { slug: "duplicate-threat", title: "Second" }),
      ],
    )).toThrow(/UNIQUE constraint failed/u);

    expect(
      db.prepare(
        "SELECT count(*) FROM base_snapshot WHERE generation_id = 'staging-a'",
      ).pluck().get(),
    ).toBe(0);
    expect(
      db.prepare(
        "SELECT count(*) FROM id_map WHERE generation_id = 'staging-a'",
      ).pluck().get(),
    ).toBe(0);
    expect(store.getAccepted("project-a", "version-a", "threat", acceptedKey))
      .toMatchObject({ generationId: "accepted-a", payload: { title: "Accepted" } });
  });

  it("stores canonical staging payloads with recomputed hashes while accepted reads ignore staging", () => {
    const db = createDb("accepted-ignore-staging");
    const store = new BaseSnapshotStore(db);
    const key = threatKey("threat-a");
    const acceptedPayload = { slug: "threat-a", title: "Accepted" };
    const stagingPayload = {
      slug: "threat-a",
      title: "Staging",
      nested: { z: 1, a: true },
    };
    insertGeneration(db, "project-a", "version-a", "accepted-a", "accepted");
    insertGeneration(db, "project-a", "version-a", "staging-a", "staging");
    insertSyncState(db, "project-a", "version-a", "accepted-a", "staging-a", 2);
    insertBase(db, {
      projectId: "project-a",
      projectVersionId: "version-a",
      entityKind: "threat",
      generationId: "accepted-a",
      entityKey: key,
      remoteId: "remote-accepted",
      payload: acceptedPayload,
      pulledAt: PULLED_AT,
    });

    store.putStagingPage(
      "project-a",
      "version-a",
      "threat",
      "staging-a",
      [stagingRow(key, "remote-staging", stagingPayload)],
    );

    expect(store.getAccepted("project-a", "version-a", "threat", key)?.payload)
      .toEqual(acceptedPayload);
    expect(
      db.prepare(
        "SELECT payload FROM base_snapshot WHERE generation_id = 'staging-a'",
      ).pluck().get(),
    ).toBe(canonicalJson(stagingPayload));
    expect(
      db.prepare(
        "SELECT content_hash FROM base_snapshot WHERE generation_id = 'staging-a'",
      ).pluck().get(),
    ).toBe(hash("threat", stagingPayload));
  });

  it("advances exactly one scoped row, mapping, and revision", () => {
    const db = createDb("advance-scoped");
    const store = new BaseSnapshotStore(db);
    const ids = new IdMapStore(db);
    const key = threatKey("shared-threat");
    const initialPayload = { slug: "shared-threat", title: "Initial" };
    const nextPayload = { slug: "shared-threat", title: "Advanced", score: 4 };
    for (const projectId of ["project-a", "project-b"]) {
      insertGeneration(db, projectId, "version-a", "accepted-a", "accepted");
      insertSyncState(db, projectId, "version-a", "accepted-a", null, 3);
      insertBase(db, {
        projectId,
        projectVersionId: "version-a",
        entityKind: "threat",
        generationId: "accepted-a",
        entityKey: key,
        remoteId: `remote-${projectId}`,
        payload: initialPayload,
        pulledAt: PULLED_AT,
      });
    }

    const nextRevision = store.advanceAccepted(
      "project-a",
      "version-a",
      "threat",
      key,
      {
        generationId: "accepted-a",
        baseRevision: 3,
        contentHash: hash("threat", initialPayload),
      },
      {
        payload: nextPayload,
        remoteId: "remote-project-a-next",
        pulledAt: "2026-08-12T13:00:00.000Z",
      },
    );

    expect(nextRevision).toBe(4);
    expect(store.getAccepted("project-a", "version-a", "threat", key))
      .toMatchObject({
        payload: nextPayload,
        contentHash: hash("threat", nextPayload),
        remoteId: "remote-project-a-next",
      });
    expect(store.getAccepted("project-b", "version-a", "threat", key))
      .toMatchObject({ payload: initialPayload, remoteId: "remote-project-b" });
    expect(ids.resolveAccepted("project-a", "version-a", "threat", key))
      .toBe("remote-project-a-next");
    expect(ids.resolveAccepted("project-b", "version-a", "threat", key))
      .toBe("remote-project-b");
    expect(
      db.prepare(
        `SELECT project_id, base_revision FROM sync_state
          WHERE entity_kind = 'threat' ORDER BY project_id`,
      ).all(),
    ).toEqual([
      { project_id: "project-a", base_revision: 4 },
      { project_id: "project-b", base_revision: 3 },
    ]);
  });

  it("rolls back advance on content-hash or revision mismatch", () => {
    const db = createDb("advance-fences");
    const store = new BaseSnapshotStore(db);
    const key = threatKey("threat-a");
    const payload = { slug: "threat-a", title: "Original" };
    insertGeneration(db, "project-a", "version-a", "accepted-a", "accepted");
    insertSyncState(db, "project-a", "version-a", "accepted-a", null, 5);
    const originalHash = insertBase(db, {
      projectId: "project-a",
      projectVersionId: "version-a",
      entityKind: "threat",
      generationId: "accepted-a",
      entityKey: key,
      remoteId: "remote-a",
      payload,
      pulledAt: PULLED_AT,
    });
    const next = {
      payload: { slug: "threat-a", title: "Should roll back" },
      remoteId: "remote-next",
      pulledAt: "2026-08-12T13:00:00.000Z",
    };

    expect(() => store.advanceAccepted(
      "project-a",
      "version-a",
      "threat",
      key,
      { generationId: "accepted-a", baseRevision: 5, contentHash: "wrong" },
      next,
    )).toThrow(BaseSnapshotFenceError);
    expect(() => store.advanceAccepted(
      "project-a",
      "version-a",
      "threat",
      key,
      { generationId: "accepted-a", baseRevision: 4, contentHash: originalHash },
      next,
    )).toThrow(BaseSnapshotFenceError);

    expect(store.getAccepted("project-a", "version-a", "threat", key))
      .toMatchObject({ payload, remoteId: "remote-a", contentHash: originalHash });
    expect(
      db.prepare(
        "SELECT base_revision FROM sync_state WHERE project_id = 'project-a'",
      ).pluck().get(),
    ).toBe(5);
  });

  it("creates and deletes an accepted base with the same exact fences", () => {
    const db = createDb("create-delete");
    const store = new BaseSnapshotStore(db);
    const ids = new IdMapStore(db);
    const key = threatKey("new-threat");
    const payload = { slug: "new-threat", title: "New" };
    insertGeneration(db, "project-a", "version-a", "accepted-a", "accepted");
    insertSyncState(db, "project-a", "version-a", "accepted-a", null, 0);

    expect(store.advanceAccepted(
      "project-a",
      "version-a",
      "threat",
      key,
      { generationId: "accepted-a", baseRevision: 0, contentHash: null },
      { payload, remoteId: "remote-new", pulledAt: PULLED_AT },
    )).toBe(1);
    expect(ids.resolveAccepted("project-a", "version-a", "threat", key))
      .toBe("remote-new");

    expect(store.deleteAccepted(
      "project-a",
      "version-a",
      "threat",
      key,
      {
        generationId: "accepted-a",
        baseRevision: 1,
        contentHash: hash("threat", payload),
      },
    )).toBe(2);
    expect(store.getAccepted("project-a", "version-a", "threat", key)).toBeNull();
    expect(ids.resolveAccepted("project-a", "version-a", "threat", key)).toBeNull();
  });
});
