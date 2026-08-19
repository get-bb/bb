import { describe, expect, it } from "vitest";
import {
  normalizeExperimentalFileOpenOptions,
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
});

describe("normalizeExperimentalFileOpenOptions", () => {
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
