import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { describe, expect, it, vi } from "vitest";
import {
  fromStorageProjectVersionId,
  openStore,
  PROJECT_LEVEL_VERSION_ID,
  toStorageProjectVersionId,
} from "./index.js";
import { MIGRATIONS } from "./schema.js";

describe("project-version storage boundary", () => {
  it("round-trips project-level null without exposing the reserved sentinel", () => {
    expect(PROJECT_LEVEL_VERSION_ID).toBe("@project");
    const stored = toStorageProjectVersionId(null);
    expect(stored).toBe(PROJECT_LEVEL_VERSION_ID);

    const upstreamInputs: (string | null)[] = [];
    upstreamInputs.push(fromStorageProjectVersionId(stored));
    upstreamInputs.push(
      fromStorageProjectVersionId(toStorageProjectVersionId("version-1")),
    );
    expect(upstreamInputs).toEqual([null, "version-1"]);
    expect(upstreamInputs).not.toContain(PROJECT_LEVEL_VERSION_ID);
  });

  it("rejects empty and externally supplied sentinel values", () => {
    expect(() => toStorageProjectVersionId("")).toThrow(/non-empty/u);
    expect(() => toStorageProjectVersionId("@project")).toThrow(/reserved/u);
    expect(() => fromStorageProjectVersionId("")).toThrow(/non-empty/u);
  });
});

describe("openStore", () => {
  it("migrates once, memoizes per plugin context, and enables foreign keys", async () => {
    const firstHost = createFakePluginHost({ pluginId: "finite-state-store-a" });
    const database = vi.spyOn(firstHost.bb.storage, "database");
    const migrate = vi.spyOn(firstHost.bb.storage, "migrate");

    const first = openStore(firstHost.bb);
    const again = openStore(firstHost.bb);

    expect(again).toBe(first);
    expect(database).toHaveBeenCalledOnce();
    expect(migrate).toHaveBeenCalledOnce();
    expect(migrate).toHaveBeenCalledWith(first.db, MIGRATIONS);
    expect(first.db.pragma("foreign_keys", { simple: true })).toBe(1);

    const secondHost = createFakePluginHost({ pluginId: "finite-state-store-b" });
    const second = openStore(secondHost.bb);
    expect(second).not.toBe(first);
    expect(second.db).not.toBe(first.db);

    await firstHost.harness.lifecycle.dispose();
    await secondHost.harness.lifecycle.dispose();
  });

  it("retries after migration failure without publishing an unmigrated store", async () => {
    const host = createFakePluginHost({ pluginId: "finite-state-store-retry" });
    const migrateSuccessfully = host.bb.storage.migrate.bind(host.bb.storage);
    const database = vi.spyOn(host.bb.storage, "database");
    const migrate = vi
      .spyOn(host.bb.storage, "migrate")
      .mockImplementationOnce(() => {
        throw new Error("induced migration failure");
      })
      .mockImplementation((db, statements) => {
        migrateSuccessfully(db, statements);
      });

    expect(() => openStore(host.bb)).toThrow("induced migration failure");
    const store = openStore(host.bb);

    expect(database).toHaveBeenCalledTimes(2);
    expect(migrate).toHaveBeenCalledTimes(2);
    expect(
      store.db
        .prepare(
          "SELECT count(*) FROM sqlite_schema WHERE type = 'table' AND name = 'pull_generation'",
        )
        .pluck()
        .get(),
    ).toBe(1);
    expect(openStore(host.bb)).toBe(store);
    expect(migrate).toHaveBeenCalledTimes(2);
    await host.harness.lifecycle.dispose();
  });

  it("commits successful transactions and fully rolls back thrown work", async () => {
    const host = createFakePluginHost({ pluginId: "finite-state-store-tx" });
    const store = openStore(host.bb);
    store.db
      .prepare(
        `INSERT INTO pull_generation
           (project_id, project_version_id, generation_id, status,
            requested_kinds_json, started_at, completed_at, accepted_at)
         VALUES ('project-a', 'version-a', 'g', 'accepted', '["finding"]',
                 'now', 'now', 'now')`,
      )
      .run();

    const result = store.tx(() => {
      store.db
        .prepare(
          `INSERT INTO findings
             (project_id, project_version_id, generation_id, finding_id,
              stable_key, raw, pulled_at)
           VALUES ('project-a', 'version-a', 'g', 'finding-commit',
                   'stable-commit', '{}', 'now')`,
        )
        .run();
      return "committed" as const;
    });
    expect(result).toBe("committed");

    expect(() =>
      store.tx(() => {
        store.db
          .prepare(
            `INSERT INTO findings
               (project_id, project_version_id, generation_id, finding_id,
                stable_key, raw, pulled_at)
             VALUES ('project-a', 'version-a', 'g', 'finding-rollback',
                     'stable-rollback', '{}', 'now')`,
          )
          .run();
        store.db
          .prepare(
            `INSERT INTO finding_cwes
               (project_id, project_version_id, generation_id, finding_id, cwe, pulled_at)
             VALUES ('project-a', 'version-a', 'g', 'finding-rollback', 'CWE-79', 'now')`,
          )
          .run();
        throw new Error("rollback checkpoint");
      }),
    ).toThrow("rollback checkpoint");

    expect(
      store.db
        .prepare("SELECT finding_id FROM findings ORDER BY finding_id")
        .pluck()
        .all(),
    ).toEqual(["finding-commit"]);
    expect(store.db.prepare("SELECT count(*) FROM finding_cwes").pluck().get()).toBe(0);
    await host.harness.lifecycle.dispose();
  });

  it("rolls back a partial scoped document checkpoint on a foreign-key error", async () => {
    const host = createFakePluginHost({ pluginId: "finite-state-store-fk" });
    const store = openStore(host.bb);

    expect(() =>
      store.tx(() => {
        store.db
          .prepare(
            `INSERT INTO document
               (project_id, project_version_id, document_id, sha256, name, path,
                doc_kind, mime_type, bytes, uploaded_at, indexed_at)
             VALUES ('project-a', 'version-a', 'doc-atomic', 'sha-doc', 'doc.pdf',
                     'product-security/documents/doc.pdf', 'datasheet',
                     'application/pdf', 1, 'now', 'now')`,
          )
          .run();
        store.db
          .prepare(
            `INSERT INTO document_extraction
               (project_id, project_version_id, extraction_id, document_id, field,
                source_ref, locator_kind, status, extracted_at)
             VALUES ('project-a', 'version-a', 'extract-invalid', 'missing',
                     'mpn', '#p1', 'pdf', 'proposal', 'now')`,
          )
          .run();
      }),
    ).toThrow(/foreign key constraint failed/i);
    expect(store.db.prepare("SELECT count(*) FROM document").pluck().get()).toBe(0);
    await host.harness.lifecycle.dispose();
  });
});
