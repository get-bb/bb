import { describe, expect, it } from "vitest";
import {
  directiveSource,
  openedSource,
  sourceKey,
} from "./artifact-source";

describe("directiveSource", () => {
  it("defaults to the thread workspace", () => {
    expect(directiveSource("thr_1", undefined)).toEqual({
      ok: true,
      source: { kind: "thread-workspace", threadId: "thr_1" },
    });
    expect(directiveSource("thr_1", "workspace")).toEqual({
      ok: true,
      source: { kind: "thread-workspace", threadId: "thr_1" },
    });
  });

  it("accepts thread storage", () => {
    expect(directiveSource("thr_1", "thread-storage")).toEqual({
      ok: true,
      source: { kind: "thread-storage", threadId: "thr_1" },
    });
  });

  it("reports an unknown source", () => {
    const result = directiveSource("thr_1", "project");
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.message).toMatch(
      /must be "workspace" or "thread-storage"/,
    );
  });
});

describe("openedSource", () => {
  it("prefers the thread workspace when a thread is known", () => {
    expect(
      openedSource({
        kind: "workspace",
        threadId: "thr_1",
        environmentId: "env_1",
        projectId: "proj_1",
      }),
    ).toEqual({ kind: "thread-workspace", threadId: "thr_1" });
  });

  it("resolves environment and project sources", () => {
    expect(
      openedSource({
        kind: "workspace",
        threadId: null,
        environmentId: "env_1",
        projectId: "proj_1",
      }),
    ).toEqual({
      kind: "workspace",
      environmentId: "env_1",
      projectId: "proj_1",
      hostId: null,
    });
    expect(
      openedSource({
        kind: "workspace",
        threadId: null,
        environmentId: null,
        projectId: "proj_1",
        experimental_hostId: "host_2",
      }),
    ).toEqual({
      kind: "workspace",
      environmentId: null,
      projectId: "proj_1",
      hostId: "host_2",
    });
  });

  it("resolves thread storage and rejects host files", () => {
    expect(
      openedSource({
        kind: "thread-storage",
        threadId: "thr_1",
        environmentId: null,
        projectId: null,
      }),
    ).toEqual({ kind: "thread-storage", threadId: "thr_1" });
    expect(
      openedSource({
        kind: "host",
        threadId: "thr_1",
        environmentId: "env_1",
        projectId: null,
      }),
    ).toBeNull();
    expect(
      openedSource({
        kind: "workspace",
        threadId: null,
        environmentId: null,
        projectId: null,
      }),
    ).toBeNull();
  });
});

describe("sourceKey", () => {
  it("is stable for the same descriptor", () => {
    const source = { kind: "thread-workspace", threadId: "thr_1" } as const;
    expect(sourceKey(source)).toBe(sourceKey({ ...source }));
  });

  it("differs per descriptor", () => {
    expect(sourceKey({ kind: "thread-workspace", threadId: "thr_1" })).not.toBe(
      sourceKey({ kind: "thread-workspace", threadId: "thr_2" }),
    );
  });
});
