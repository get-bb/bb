import { describe, expect, it } from "vitest";
import { resolvePdfUrl } from "./pdf-source.js";

const ids = {
  threadId: "thr_1",
  environmentId: "env_1",
  projectId: "proj_1",
};

describe("resolvePdfUrl", () => {
  it.each([
    {
      source: { kind: "workspace" as const, ...ids },
      path: "docs/a report.pdf",
      expected: "/api/v1/environments/env_1/files/docs/a%20report.pdf",
    },
    {
      source: { kind: "host" as const, ...ids },
      path: "/tmp/a report.pdf",
      expected: "/api/v1/threads/thr_1/host-files/tmp/a%20report.pdf",
    },
    {
      source: { kind: "thread-storage" as const, ...ids },
      path: "exports/a report.pdf",
      expected:
        "/api/v1/threads/thr_1/thread-storage/files/exports/a%20report.pdf",
    },
  ])("routes the $source.kind source", ({ source, path, expected }) => {
    expect(resolvePdfUrl(path, source)).toBe(expected);
  });

  it("routes a project-backed compose preview through its host", () => {
    expect(
      resolvePdfUrl("docs/handbook.pdf", {
        kind: "workspace",
        threadId: null,
        environmentId: null,
        projectId: "proj_1",
        experimental_hostId: "host_remote",
      }),
    ).toBe("/api/v1/projects/proj_1/hosts/host_remote/files/docs/handbook.pdf");
  });
});
