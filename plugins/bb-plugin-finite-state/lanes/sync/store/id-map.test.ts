import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import type Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { createPluginContext } from "../../../lib/context.js";
import { PROJECT_LEVEL_VERSION_ID } from "../../../lib/store/index.js";
import { ENTITIES, type EntityKind } from "../../../lib/sync/registry.js";
import {
  IdMapFenceError,
  IdMapStore,
  type IdMapEntry,
} from "./id-map.js";

const hosts: Array<ReturnType<typeof createFakePluginHost>> = [];
const PULLED_AT = "2026-08-12T12:00:00.000Z";

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.harness.lifecycle.dispose()));
});

function createDb(label: string): Database.Database {
  const host = createFakePluginHost({ pluginId: `finite-state-wp16-id-${label}` });
  hosts.push(host);
  return createPluginContext(host.bb).db();
}

function insertGeneration(
  db: Database.Database,
  projectId: string,
  projectVersionId: string,
  generationId: string,
  status: "accepted" | "staging" = "accepted",
): void {
  db.prepare(
    `INSERT INTO pull_generation
       (project_id, project_version_id, generation_id, status,
        requested_kinds_json, started_at, completed_at, accepted_at)
     VALUES (?, ?, ?, ?, '[]', ?, ?, ?)`,
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
  kind: EntityKind,
  acceptedGenerationId: string,
  stagingGenerationId: string | null,
  baseRevision = 0,
): void {
  db.prepare(
    `INSERT INTO sync_state
       (project_id, project_version_id, entity_kind, accepted_generation_id,
        staging_generation_id, base_revision)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    projectId,
    projectVersionId,
    kind,
    acceptedGenerationId,
    stagingGenerationId,
    baseRevision,
  );
}

function insertId(db: Database.Database, entry: IdMapEntry): void {
  db.prepare(
    `INSERT INTO id_map
       (project_id, project_version_id, entity_kind, generation_id,
        entity_key, remote_id, pulled_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    entry.projectId,
    entry.projectVersionId,
    entry.entityKind,
    entry.generationId,
    entry.entityKey,
    entry.remoteId,
    PULLED_AT,
  );
}

describe("IdMapStore", () => {
  it("learns and upserts an accepted mapping with revision fences", () => {
    const db = createDb("learn");
    const store = new IdMapStore(db);
    const key = ENTITIES.threat.key({ slug: "threat-a" });
    insertGeneration(db, "project-a", "version-a", "accepted-a");
    insertSyncState(db, "project-a", "version-a", "threat", "accepted-a", null, 8);
    const entry: IdMapEntry = {
      projectId: "project-a",
      projectVersionId: "version-a",
      entityKind: "threat",
      generationId: "accepted-a",
      entityKey: key,
      remoteId: "remote-a",
    };

    expect(store.learnAccepted(entry, {
      generationId: "accepted-a",
      baseRevision: 8,
    })).toBe(9);
    expect(store.resolveAccepted("project-a", "version-a", "threat", key))
      .toBe("remote-a");
    expect(store.reverseAccepted("project-a", "version-a", "threat", "remote-a"))
      .toBe(key);

    expect(store.learnAccepted(
      { ...entry, remoteId: "remote-b" },
      { generationId: "accepted-a", baseRevision: 9 },
    )).toBe(10);
    expect(store.resolveAccepted("project-a", "version-a", "threat", key))
      .toBe("remote-b");
    expect(store.reverseAccepted("project-a", "version-a", "threat", "remote-a"))
      .toBeNull();
  });

  it("rolls back a learned mapping when its revision fence is stale", () => {
    const db = createDb("learn-fence");
    const store = new IdMapStore(db);
    const key = ENTITIES.threat.key({ slug: "threat-a" });
    insertGeneration(db, "project-a", "version-a", "accepted-a");
    insertSyncState(db, "project-a", "version-a", "threat", "accepted-a", null, 4);

    expect(() => store.learnAccepted({
      projectId: "project-a",
      projectVersionId: "version-a",
      entityKind: "threat",
      generationId: "accepted-a",
      entityKey: key,
      remoteId: "remote-a",
    }, {
      generationId: "accepted-a",
      baseRevision: 3,
    })).toThrow(IdMapFenceError);
    expect(store.resolveAccepted("project-a", "version-a", "threat", key)).toBeNull();
    expect(
      db.prepare("SELECT base_revision FROM sync_state").pluck().get(),
    ).toBe(4);
  });

  it("keeps staging mappings invisible to accepted resolve and reverse", () => {
    const db = createDb("staging-invisible");
    const store = new IdMapStore(db);
    const acceptedKey = ENTITIES.threat.key({ slug: "accepted" });
    const stagingKey = ENTITIES.threat.key({ slug: "staging" });
    insertGeneration(db, "project-a", "version-a", "accepted-a");
    insertGeneration(db, "project-a", "version-a", "staging-a", "staging");
    insertSyncState(
      db,
      "project-a",
      "version-a",
      "threat",
      "accepted-a",
      "staging-a",
    );
    insertId(db, {
      projectId: "project-a",
      projectVersionId: "version-a",
      entityKind: "threat",
      generationId: "accepted-a",
      entityKey: acceptedKey,
      remoteId: "remote-accepted",
    });
    insertId(db, {
      projectId: "project-a",
      projectVersionId: "version-a",
      entityKind: "threat",
      generationId: "staging-a",
      entityKey: stagingKey,
      remoteId: "remote-staging",
    });

    expect(store.resolveAccepted("project-a", "version-a", "threat", acceptedKey))
      .toBe("remote-accepted");
    expect(store.resolveAccepted("project-a", "version-a", "threat", stagingKey))
      .toBeNull();
    expect(store.reverseAccepted(
      "project-a",
      "version-a",
      "threat",
      "remote-staging",
    )).toBeNull();
  });

  it("scopes the same remote id to each project and version", () => {
    const db = createDb("scoped-remote");
    const store = new IdMapStore(db);
    const key = ENTITIES.threat.key({ slug: "shared" });
    for (const [projectId, versionId] of [
      ["project-a", "version-a"],
      ["project-a", "version-b"],
      ["project-b", "version-a"],
    ] as const) {
      insertGeneration(db, projectId, versionId, "accepted-a");
      insertSyncState(db, projectId, versionId, "threat", "accepted-a", null);
      insertId(db, {
        projectId,
        projectVersionId: versionId,
        entityKind: "threat",
        generationId: "accepted-a",
        entityKey: key,
        remoteId: "shared-remote-id",
      });
    }

    expect(store.resolveAccepted("project-a", "version-b", "threat", key))
      .toBe("shared-remote-id");
    expect(store.reverseAccepted(
      "project-b",
      "version-a",
      "threat",
      "shared-remote-id",
    )).toBe(key);
  });

  it("dumps accepted entries deterministically by kind and key", () => {
    const db = createDb("dump");
    const store = new IdMapStore(db);
    insertGeneration(db, "project-a", "version-a", "accepted-a");
    insertSyncState(db, "project-a", "version-a", "threat", "accepted-a", null);
    insertSyncState(db, "project-a", "version-a", "component", "accepted-a", null);
    const entries: IdMapEntry[] = [
      {
        projectId: "project-a",
        projectVersionId: "version-a",
        entityKind: "threat",
        generationId: "accepted-a",
        entityKey: ENTITIES.threat.key({ slug: "z-threat" }),
        remoteId: "remote-z",
      },
      {
        projectId: "project-a",
        projectVersionId: "version-a",
        entityKind: "component",
        generationId: "accepted-a",
        entityKey: ENTITIES.component.key({ slug: "b-component" }),
        remoteId: "remote-b",
      },
      {
        projectId: "project-a",
        projectVersionId: "version-a",
        entityKind: "component",
        generationId: "accepted-a",
        entityKey: ENTITIES.component.key({ slug: "a-component" }),
        remoteId: "remote-a",
      },
    ];
    for (const entry of entries) insertId(db, entry);

    expect(store.dumpAccepted("project-a", "version-a").map((entry) => entry.remoteId))
      .toEqual(["remote-a", "remote-b", "remote-z"]);
  });

  it("uses the reserved project-level storage sentinel without leaking null into SQLite", () => {
    const db = createDb("project-level");
    const store = new IdMapStore(db);
    const key = ENTITIES.threat.key({ slug: "project-level" });
    insertGeneration(db, "project-a", PROJECT_LEVEL_VERSION_ID, "accepted-a");
    insertSyncState(
      db,
      "project-a",
      PROJECT_LEVEL_VERSION_ID,
      "threat",
      "accepted-a",
      null,
    );

    store.learnAccepted({
      projectId: "project-a",
      projectVersionId: PROJECT_LEVEL_VERSION_ID,
      entityKind: "threat",
      generationId: "accepted-a",
      entityKey: key,
      remoteId: "remote-project-level",
    }, {
      generationId: "accepted-a",
      baseRevision: 0,
    });

    expect(store.resolveAccepted(
      "project-a",
      PROJECT_LEVEL_VERSION_ID,
      "threat",
      key,
    )).toBe("remote-project-level");
    expect(
      db.prepare("SELECT project_version_id FROM id_map").pluck().get(),
    ).toBe(PROJECT_LEVEL_VERSION_ID);
  });
});
