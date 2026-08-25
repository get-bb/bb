import { describe, expect, it, vi } from "vitest";
import {
  collectLogLines,
  setupCommandOutputTestEnvironment,
  runCommand,
  stubServerApi,
} from "../helpers/command-output-harness.js";
import type { CommandRegistrar } from "../helpers/command-output-harness.js";
import * as fixtures from "../helpers/command-output-fixtures.js";
import { registerThreadCommands } from "../../commands/thread/index.js";

function makeHold(overrides: Record<string, unknown> = {}) {
  return {
    id: "hold_one",
    kind: "turn",
    threadId: "thr_one",
    holder: "user",
    userReleasable: true,
    reason: "Scheduled",
    payload: {
      kind: "inline",
      input: [{ type: "text", text: "ship it", mentions: [] }],
      execution: {},
      editable: true,
    },
    resumeAt: null,
    expectedReleaseAt: null,
    staleAfterMs: null,
    lastReportAt: null,
    createdAt: 1,
    releasedAt: null,
    releaseKind: null,
    ...overrides,
  };
}

describe("bb thread holds command output", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerThreadCommands(program, () => "http://server");

  it("bb thread holds narrows the cross-thread list by thread and holder", async () => {
    const get = vi.fn(async () => []);
    stubServerApi({ "v1.holds.$get": get });

    await runCommand(
      [
        "thread",
        "holds",
        "--thread",
        "thr_one",
        "--owner",
        "plugin:concurrency-limit",
      ],
      register,
    );

    expect(get).toHaveBeenCalledWith({
      query: { threadId: "thr_one", holder: "plugin:concurrency-limit" },
    });
    expect(vi.mocked(console.log).mock.calls[0]?.[0]).toBe("No holds found");
  });

  // A malformed holder is caught before the request so the user sees the
  // holder grammar instead of an opaque 400 from the list route.
  it("bb thread holds rejects an unrecognized --owner before requesting", async () => {
    const get = vi.fn(async () => []);
    stubServerApi({ "v1.holds.$get": get });

    await expect(
      runCommand(["thread", "holds", "--owner", "nobody"], register),
    ).rejects.toThrow("process.exit:1");

    expect(get).not.toHaveBeenCalled();
    expect(String(vi.mocked(console.error).mock.calls[0]?.[0])).toContain(
      "Invalid --owner value 'nobody'",
    );
  });

  it("bb thread holds renders one row per live hold with a resume countdown", async () => {
    const now = Date.now();
    const get = vi.fn(async () => [
      // Half a minute past the 10m boundary so the rendered countdown does not
      // depend on how long the command itself takes.
      makeHold({ resumeAt: now + 630_000, createdAt: now }),
      makeHold({
        id: "hold_two",
        threadId: "thr_two",
        holder: "core:reprovision",
        reason: "Rebuilding the workspace",
        resumeAt: null,
        createdAt: now,
      }),
    ]);
    stubServerApi({ "v1.holds.$get": get });

    await runCommand(["thread", "holds"], register);

    const output = collectLogLines(vi.mocked(console.log)).join("\n");
    expect(output).toContain("ID");
    expect(output).toContain("hold_one");
    expect(output).toContain("in 10m");
    expect(output).toContain("core:reprovision");
    expect(output).toContain("Rebuilding the workspace");
  });

  it("bb thread release reports the thread the released dispatch belongs to", async () => {
    const post = vi.fn(async () => makeHold({ releaseKind: "user" }));
    stubServerApi({ "v1.holds.:id.release.$post": post });

    await runCommand(["thread", "release", "hold_one"], register);

    expect(post).toHaveBeenCalledWith({ param: { id: "hold_one" } });
    expect(vi.mocked(console.log).mock.calls[0]?.[0]).toBe(
      "Hold hold_one released on thread thr_one",
    );
  });

  it("bb thread cancel-hold discards the dispatch", async () => {
    const post = vi.fn(async () => makeHold({ releaseKind: "cancelled" }));
    stubServerApi({ "v1.holds.:id.cancel.$post": post });

    await runCommand(["thread", "cancel-hold", "hold_one", "--json"], register);

    expect(post).toHaveBeenCalledWith({ param: { id: "hold_one" } });
    expect(
      JSON.parse(String(vi.mocked(console.log).mock.calls[0]?.[0])).releaseKind,
    ).toBe("cancelled");
  });
});

/** The one field these tests read back off the captured request. */
interface HoldUntilRequest {
  json: { holdUntil: number };
}

describe("bb thread --hold-until", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerThreadCommands(program, () => "http://server");

  it("bb thread tell --hold-until sends an epoch-ms holdUntil and reports the held delivery", async () => {
    const post = vi.fn(async (_args: HoldUntilRequest) => ({
      ok: true,
      delivery: "held",
    }));
    stubServerApi({ "v1.threads.:id.send.$post": post });
    const before = Date.now();

    await runCommand(
      ["thread", "tell", "thr_hold", "later please", "--hold-until", "10m"],
      register,
    );

    const holdUntil = post.mock.calls[0][0].json.holdUntil;
    expect(holdUntil).toBeGreaterThanOrEqual(before + 600_000);
    expect(holdUntil).toBeLessThanOrEqual(Date.now() + 600_000);
    expect(String(vi.mocked(console.log).mock.calls[0]?.[0])).toContain(
      "message held until",
    );
  });

  it("bb thread tell --hold-until refuses a past timestamp without sending", async () => {
    const post = vi.fn(async () => ({ ok: true }));
    stubServerApi({ "v1.threads.:id.send.$post": post });

    await expect(
      runCommand(
        [
          "thread",
          "tell",
          "thr_hold",
          "later please",
          "--hold-until",
          "2020-01-01T00:00:00Z",
        ],
        register,
      ),
    ).rejects.toThrow("process.exit:1");

    expect(post).not.toHaveBeenCalled();
    expect(String(vi.mocked(console.error).mock.calls[0]?.[0])).toContain(
      "--hold-until must be in the future",
    );
  });

  it("bb thread spawn --hold-until parks the first turn and says so", async () => {
    const post = vi.fn(async (_args: HoldUntilRequest) =>
      fixtures.makeThread({
        id: "thr_spawned",
        projectId: "proj_one",
        providerId: "codex",
        status: "idle",
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    stubServerApi({ "v1.threads.$post": post });

    await runCommand(
      [
        "thread",
        "spawn",
        "--project",
        "proj_one",
        "--prompt",
        "start later",
        "--hold-until",
        "2h",
      ],
      register,
    );

    expect(post.mock.calls[0][0].json.holdUntil).toBeGreaterThan(
      Date.now() + 7_000_000,
    );
    expect(collectLogLines(vi.mocked(console.log)).join("\n")).toContain(
      "First turn held until",
    );
  });
});
