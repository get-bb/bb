import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";
import { listBenchArtifacts, validateLogicalArtifactLocator } from "./artifacts.js";
import { storeEvidenceCheckpointWithResult } from "./results.js";
import { createBenchTestStore, evidenceBundle, SYNCED_AT } from "./test-helpers.js";

const hosts: Array<ReturnType<typeof createFakePluginHost>> = [];

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.harness.lifecycle.dispose()));
});

describe("bench artifacts repository", () => {
  it("stores and pages safe logical locators", () => {
    const fixture = createBenchTestStore("artifacts-safe");
    hosts.push(fixture.host);
    storeEvidenceCheckpointWithResult(
      fixture.db,
      evidenceBundle({
        artifacts: [
          {
            name: "report.json",
            kind: "report",
            locator: "runs/run-a/report.json",
            sha256: "c".repeat(64),
            bytes: 42,
          },
        ],
      }),
      SYNCED_AT,
    );
    const page = listBenchArtifacts(fixture.db, {
      projectId: "project-a",
      pvId: "version-a",
      runId: "run-a",
      pageSize: 1,
      continuation: null,
    });
    expect(page.items).toEqual([
      expect.objectContaining({ locator: "runs/run-a/report.json", bytes: 42 }),
    ]);
  });

  it.each([
    "/etc/passwd",
    "../secret",
    "runs/../../secret",
    "C:/Windows/system.ini",
    "https://upstream.invalid/file",
    "runs/%2e%2e/secret",
    "runs\\secret",
  ])("rejects unsafe locator %s", (locator) => {
    expect(() => validateLogicalArtifactLocator(locator)).toThrow(/safe logical relative path/iu);
  });
});
