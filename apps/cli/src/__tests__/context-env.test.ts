import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCliRuntimeContext,
  requireProjectId,
  requireThreadId,
  requireThreadIdWithLabelOrSelf,
  resolveContextProjectId,
  resolveContextThreadId,
  resolveContextSnapshot,
  resolveExplicitIdFlag,
  resolveProjectId,
  resolveServerUrl,
  resolveThreadId,
} from "../context-env.js";

describe("context-env", () => {
  beforeEach(() => {
    vi.stubEnv("BB_PROJECT_ID", undefined);
    vi.stubEnv("BB_THREAD_ID", undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("requires project and thread context when missing", () => {
    expect(() => requireProjectId(undefined)).toThrow(
      "Missing project ID. Pass --project <id>.",
    );
    expect(() => requireThreadId(undefined)).toThrow(
      "Missing thread ID. Pass <threadId>.",
    );
  });

  it("does not use BB_PROJECT_ID and BB_THREAD_ID as explicit ID defaults", () => {
    vi.stubEnv("BB_PROJECT_ID", "proj-env");
    vi.stubEnv("BB_THREAD_ID", "thread-env");

    expect(resolveProjectId(undefined)).toBeUndefined();
    expect(resolveThreadId(undefined)).toBeUndefined();
  });

  it("resolves explicit project and thread flags", () => {
    vi.stubEnv("BB_PROJECT_ID", "proj-env");
    vi.stubEnv("BB_THREAD_ID", "thread-env");

    expect(resolveProjectId("proj-flag")).toBe("proj-flag");
    expect(resolveThreadId("thread-flag")).toBe("thread-flag");
  });

  it("normalizes empty values as undefined", () => {
    vi.stubEnv("BB_PROJECT_ID", "");
    vi.stubEnv("BB_THREAD_ID", "   ");

    expect(resolveProjectId(undefined)).toBeUndefined();
    expect(resolveThreadId(undefined)).toBeUndefined();
  });

  it("resolves explicit ID flags without environment fallback", () => {
    vi.stubEnv("BB_THREAD_ID", "thread-env");

    expect(
      resolveExplicitIdFlag({
        flagName: "--parent-thread",
        value: " thread-parent ",
      }),
    ).toBe("thread-parent");
    expect(
      resolveExplicitIdFlag({
        flagName: "--parent-thread",
        value: "   ",
      }),
    ).toBeUndefined();
    expect(
      resolveExplicitIdFlag({
        flagName: "--parent-thread",
        value: undefined,
      }),
    ).toBeUndefined();
  });

  it("rejects invalid explicit ID flags", () => {
    expect(() =>
      resolveExplicitIdFlag({
        flagName: "--parent-thread",
        value: "thread/invalid",
      }),
    ).toThrow('Invalid ID from --parent-thread: "thread/invalid".');
  });

  it("captures a consistent context snapshot", () => {
    vi.stubEnv("BB_PROJECT_ID", "proj-1");
    vi.stubEnv("BB_THREAD_ID", "thread-1");

    expect(resolveContextProjectId()).toBe("proj-1");
    expect(resolveContextThreadId()).toBe("thread-1");
    const snapshot = resolveContextSnapshot();
    expect(snapshot.projectId).toBe("proj-1");
    expect(snapshot.threadId).toBe("thread-1");
    expect(snapshot.serverUrl).toMatch(/^https?:\/\//);
  });

  it("resolves connection settings from one CLI runtime context", () => {
    const context = createCliRuntimeContext({
      cliConfig: {
        BB_HOST_DAEMON_PORT: 4567,
        BB_SERVER_URL: "http://server.test",
      },
    });

    expect(resolveServerUrl(context)).toBe("http://server.test");
    expect(resolveContextSnapshot(context).serverUrl).toBe(
      "http://server.test",
    );
  });

  it("resolves --self from BB_THREAD_ID for read-only thread commands", () => {
    vi.stubEnv("BB_THREAD_ID", "thread-self");

    expect(requireThreadIdWithLabelOrSelf(undefined, { self: true })).toEqual({
      id: "thread-self",
      source: "self",
    });
  });

  it("rejects combining a thread id with --self for read-only thread commands", () => {
    vi.stubEnv("BB_THREAD_ID", "thread-self");

    expect(() =>
      requireThreadIdWithLabelOrSelf("thread-explicit", { self: true }),
    ).toThrow("Cannot combine a thread ID argument with --self.");
  });
});
