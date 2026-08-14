import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import { createPluginContext } from "../../../../lib/context.js";
import {
  persistVendorDocument,
  persistVendorImport,
  readVendorDocument,
  readVendorImport,
} from "./staging.js";

const hosts: Array<ReturnType<typeof createFakePluginHost>> = [];

afterEach(async () => {
  await Promise.all(
    hosts.splice(0).map((host) => host.harness.lifecycle.dispose()),
  );
});

describe("vendor VEX staging", () => {
  it("persists imports in scoped SQLite rows without a 16-entry eviction boundary", () => {
    const host = createFakePluginHost({ pluginId: "vendor-vex-staging" });
    hosts.push(host);
    const db = createPluginContext(host.bb).db();
    const projectId = "platform-1";
    const pvId = "version-1";
    const firstDigest = "0".repeat(64);

    for (let index = 0; index < 17; index += 1) {
      const documentSha256 = index.toString(16).padStart(2, "0").repeat(32);
      persistVendorDocument(db, {
        projectId,
        pvId,
        file: `vendor-${index}.json`,
        bytes: Uint8Array.from([index + 1]),
        documentSha256,
      });
    }
    persistVendorImport(db, {
      projectId,
      pvId,
      importId: "vendor-import-1",
      documentSha256: firstDigest,
      vendor: "Supplier",
    });

    expect(
      readVendorDocument(db, { projectId, pvId, documentSha256: firstDigest }),
    ).toEqual({ file: "vendor-0.json", bytes: Uint8Array.from([1]) });
    expect(
      readVendorImport(db, { projectId, pvId, importId: "vendor-import-1" }),
    ).toEqual({ documentSha256: firstDigest, vendor: "Supplier" });
    expect(
      readVendorImport(db, {
        projectId: "platform-2",
        pvId,
        importId: "vendor-import-1",
      }),
    ).toBeNull();
    expect(
      db
        .prepare(
          "SELECT COUNT(*) FROM triage_runs WHERE source = 'vendor_import'",
        )
        .pluck()
        .get(),
    ).toBe(18);
  });
});
