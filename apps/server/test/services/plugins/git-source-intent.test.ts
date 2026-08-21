import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createConnection,
  migrate,
  upsertInstalledPlugin,
  type DbConnection,
} from "@bb/db";
import { gitSelectorForRow } from "../../../src/services/plugins/git-source-intent.js";

describe("persisted git source intent", () => {
  let db: DbConnection;

  beforeEach(() => {
    db = createConnection(":memory:");
    migrate(db);
  });

  afterEach(() => db.$client.close());

  it("accepts one complete selector and rejects every corrupt union shape", () => {
    const row = upsertInstalledPlugin(db, {
      id: "selector-shape",
      source: "git:/repo@main",
      provenance: { kind: "direct" },
      sourceIntent: {
        kind: "git",
        url: "/repo",
        subdirectory: null,
        selector: { kind: "ref", ref: "main", refKind: "branch" },
      },
      exactResolution: { kind: "git", commit: "abcdef1234567" },
      updateState: {
        lastCheckAt: null,
        availableCompatibleVersion: null,
        newestIncompatibleVersion: null,
        statusDetail: null,
      },
      activeArtifactId: null,
      rootDir: "/cache/repo/abcdef1234567",
      version: "1.0.0",
      enabled: true,
    });

    expect(gitSelectorForRow(row)).toEqual({
      kind: "ref",
      ref: "main",
      refKind: "branch",
    });
    expect(gitSelectorForRow({ ...row, sourceGitRefKind: null })).toBeNull();

    for (const corrupt of [
      {
        ...row,
        sourceGitRange: "^1.0.0",
        sourceGitTagPrefix: "",
        sourceGitResolvedTag: "v1.0.0",
      },
      {
        ...row,
        sourceGitRequestedRef: null,
        sourceGitRefKind: null,
      },
      {
        ...row,
        sourceGitRequestedRef: null,
        sourceGitRefKind: null,
        sourceGitRange: "^1.0.0",
      },
    ]) {
      expect(() => gitSelectorForRow(corrupt)).toThrow(
        /corrupt normalized git selector/,
      );
    }
  });
});
