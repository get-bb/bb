import { describe, expect, it } from "vitest";
import {
  normalizeExperimentalFileOpenOptions,
  normalizeExperimentalFileIdentity,
  normalizeExperimentalLiveFileTarget,
  toFilePreviewLineRange,
} from "./live-file-navigation";

describe("normalizeExperimentalLiveFileTarget", () => {
  it("accepts complete workspace, storage, POSIX host, and Windows host identities", () => {
    expect(
      normalizeExperimentalLiveFileTarget({
        kind: "workspace",
        environmentId: "env_1",
        path: "src/app.tsx",
      }),
    ).toEqual({
      kind: "workspace",
      environmentId: "env_1",
      path: "src/app.tsx",
    });
    expect(
      normalizeExperimentalLiveFileTarget({
        kind: "thread-storage",
        threadId: "thr_1",
        path: "reports/result.md",
      }),
    ).not.toBeNull();
    expect(
      normalizeExperimentalLiveFileTarget({
        kind: "host",
        hostId: "host_1",
        path: "/tmp/output.log",
      }),
    ).not.toBeNull();
    expect(
      normalizeExperimentalLiveFileTarget({
        kind: "host",
        hostId: "host_1",
        path: "C:\\work\\output.log",
      }),
    ).not.toBeNull();
  });

  it.each([
    { kind: "workspace", environmentId: "env_1", path: "/src/app.tsx" },
    { kind: "workspace", environmentId: "env_1", path: "src/../app.tsx" },
    { kind: "thread-storage", threadId: "thr_1", path: "./result.md" },
    { kind: "host", hostId: "host_1", path: "relative/file.ts" },
    { kind: "host", hostId: "host_1", path: "/tmp/../secret" },
    {
      kind: "workspace",
      environmentId: "env_1",
      path: "src/app.tsx",
      ambientThreadId: "thr_1",
    },
  ])("rejects ambiguous or non-exact target %#", (target) => {
    expect(normalizeExperimentalLiveFileTarget(target)).toBeNull();
  });

  it("accepts valid surrogate pairs and rejects unpaired surrogates", () => {
    expect(
      normalizeExperimentalLiveFileTarget({
        kind: "workspace",
        environmentId: "env_1",
        path: `reports/${String.fromCodePoint(0x1f4c4)}.md`,
      }),
    ).not.toBeNull();

    for (const path of [
      String.fromCharCode(0xd800),
      String.fromCharCode(0xdc00),
      `a${String.fromCharCode(0xd800)}b`,
    ]) {
      expect(
        normalizeExperimentalLiveFileTarget({
          kind: "workspace",
          environmentId: "env_1",
          path,
        }),
      ).toBeNull();
    }
  });
});

describe("normalizeExperimentalFileOpenOptions", () => {
  it("accepts canonical identities for every byte-backed store", () => {
    const identities = [
      {
        source: {
          store: "project-attachment",
          ownerId: "proj_1",
          path: "folder/100% #图.md",
        },
        displayName: "100% #图.md",
        mimeType: "text/markdown",
        sizeBytes: 42,
        location: { kind: "range", startLine: 8, endLine: 12 },
      },
      {
        source: {
          store: "thread-host",
          ownerId: "thr_1",
          path: "/workspace/100% #图.md",
        },
        displayName: "100% #图.md",
        mimeType: null,
        sizeBytes: null,
        location: null,
      },
      {
        source: {
          store: "tasks-attachment",
          ownerId: "task_1",
          attachmentId: "att_1",
        },
        displayName: "report.pdf",
        mimeType: "application/pdf",
        sizeBytes: 2048,
        location: null,
      },
    ];

    for (const identity of identities) {
      expect(normalizeExperimentalFileIdentity(identity)).toEqual(identity);
      expect(normalizeExperimentalFileOpenOptions({ identity })).toEqual({
        identity,
      });
    }
  });

  it("rejects traversal, unsafe remote schemes, invalid MIME, and invalid sizes", () => {
    const base = {
      source: {
        store: "project-attachment",
        ownerId: "proj_1",
        path: "folder/report.md",
      },
      displayName: "report.md",
      mimeType: "text/markdown",
      sizeBytes: 42,
      location: null,
    };
    expect(
      normalizeExperimentalFileIdentity({
        ...base,
        source: { ...base.source, path: "folder/../secret.md" },
      }),
    ).toBeNull();
    expect(
      normalizeExperimentalFileIdentity({
        ...base,
        source: {
          store: "remote",
          ownerId: "remote",
          url: "javascript:alert(1)",
        },
      }),
    ).toBeNull();
    expect(
      normalizeExperimentalFileIdentity({
        ...base,
        mimeType: "invalid",
      }),
    ).toBeNull();
    expect(
      normalizeExperimentalFileIdentity({ ...base, sizeBytes: -1 }),
    ).toBeNull();
  });

  it("rejects invalid locations instead of dropping them", () => {
    expect(
      normalizeExperimentalFileOpenOptions({
        target: {
          kind: "workspace",
          environmentId: "env_1",
          path: "src/app.tsx",
        },
        location: { kind: "range", startLine: 8, endLine: 4 },
      }),
    ).toBeNull();
  });

  it("maps a valid line location to the existing preview range", () => {
    expect(
      toFilePreviewLineRange({ kind: "line", line: 42, column: 7 }),
    ).toEqual({ startLineNumber: 42, endLineNumber: 42 });
  });
});
