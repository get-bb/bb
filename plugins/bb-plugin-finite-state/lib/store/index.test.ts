import { describe, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { openStore } from "./index.js";
import { MIGRATIONS } from "./schema.js";

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

  it("retries after a migration failure without publishing an unmigrated store", async () => {
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
          "SELECT count(*) FROM sqlite_schema WHERE type = 'table' AND name = 'findings'",
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

    const result = store.tx(() => {
      store.db
        .prepare(
          `INSERT INTO findings
             (finding_id, project_id, project_version_id, stable_key, raw, pulled_at)
           VALUES ('finding-commit', 'project-a', 'pv-a', 'stable-commit', '{}', 'now')`,
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
               (finding_id, project_id, project_version_id, stable_key, raw, pulled_at)
             VALUES ('finding-rollback', 'project-a', 'pv-a', 'stable-rollback', '{}', 'now')`,
          )
          .run();
        store.db
          .prepare(
            `INSERT INTO finding_cwes
               (project_version_id, finding_id, cwe, pulled_at)
             VALUES ('pv-a', 'finding-rollback', 'CWE-79', 'now')`,
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

  it("rolls back partial document, check, and run checkpoints on foreign-key errors", async () => {
    const host = createFakePluginHost({ pluginId: "finite-state-store-fk" });
    const store = openStore(host.bb);

    expect(() =>
      store.tx(() => {
        store.db
          .prepare(
            `INSERT INTO document
               (document_id, project_key, sha256, name, path, doc_kind, mime_type,
                bytes, uploaded_at, indexed_at)
             VALUES ('doc-atomic', 'project-a', 'sha-doc', 'doc.pdf',
                     'product-security/documents/doc.pdf', 'datasheet',
                     'application/pdf', 1, 'now', 'now')`,
          )
          .run();
        store.db
          .prepare(
            `INSERT INTO document_extraction
               (extraction_id, document_id, field, source_ref, locator_kind, status,
                extracted_at)
             VALUES ('extract-invalid', 'missing', 'mpn', '#p1', 'pdf', 'proposal',
                     'now')`,
          )
          .run();
      }),
    ).toThrow(/foreign key constraint failed/i);
    expect(store.db.prepare("SELECT count(*) FROM document").pluck().get()).toBe(0);

    expect(() =>
      store.tx(() => {
        store.db
          .prepare(
            `INSERT INTO verification_checks
               (check_id, code, name, check_type, raw, pulled_at)
             VALUES ('check-atomic', 'CHK-1', 'Check one', 'binary_analysis', '{}', 'now')`,
          )
          .run();
        store.db
          .prepare(
            `INSERT INTO requirement_check_mappings
               (project_id, requirement_key, check_id, raw, pulled_at)
             VALUES ('project-a', 'REQ-1', 'missing', '{}', 'now')`,
          )
          .run();
      }),
    ).toThrow(/foreign key constraint failed/i);
    expect(
      store.db.prepare("SELECT count(*) FROM verification_checks").pluck().get(),
    ).toBe(0);

    expect(() =>
      store.tx(() => {
        store.db
          .prepare(
            `INSERT INTO verification_runs
               (run_id, project_id, tier, matrix_col, kind, status, raw, synced_at)
             VALUES ('run-atomic', 'project-a', 'tier0', 'static', 'static',
                     'running', '{}', 'now')`,
          )
          .run();
        store.db
          .prepare(
            `INSERT INTO verification_artifacts
               (artifact_id, run_id, name, kind, locator, pulled_at)
             VALUES ('artifact-invalid', 'missing', 'log', 'log', 'artifacts/log',
                     'now')`,
          )
          .run();
      }),
    ).toThrow(/foreign key constraint failed/i);
    expect(
      store.db.prepare("SELECT count(*) FROM verification_runs").pluck().get(),
    ).toBe(0);

    await host.harness.lifecycle.dispose();
  });
});
