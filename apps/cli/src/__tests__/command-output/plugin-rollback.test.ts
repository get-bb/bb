import { describe, expect, it, vi } from "vitest";
import {
  collectLogPayloads,
  readlineMocks,
  runCommand,
  setupCommandOutputTestEnvironment,
  type CommandRegistrar,
} from "../helpers/command-output-harness.js";
import { registerPluginCommands } from "../../commands/plugin.js";

const until = Date.UTC(2026, 9, 28, 9, 30);
const rollback = {
  version: "1.0.0",
  label: "1.0.0",
  display: "notes@1.0.0",
  until,
};
const reverted = {
  applied: true,
  from: { version: "1.1.0", label: "1.1.0", display: "notes@1.1.0" },
  to: { version: "1.0.0", label: "1.0.0", display: "notes@1.0.0" },
  outcome: "reverted",
};

const available = {
  outcome: "rollback-available",
  from: { version: "1.1.0", label: "1.1.0", display: "notes@1.1.0" },
  point: rollback,
};

function rollbackJob(fields: object) {
  return {
    job: {
      id: "rollback-1",
      pluginId: "notes",
      displayName: "Notes",
      kind: "rollback",
      ...fields,
    },
  };
}

describe("bb plugin rollback", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerPluginCommands(program, () => "http://server");

  it("names the kept release, warns about restored state, and rolls back only that release", async () => {
    readlineMocks.question.mockResolvedValueOnce("y");
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json(available))
      .mockResolvedValueOnce(
        Response.json(rollbackJob({ state: "completed", result: reverted }), {
          status: 202,
        }),
      );

    await runCommand(["plugin", "rollback", "notes"], register);

    expect(readlineMocks.question).toHaveBeenCalledWith(
      "Roll back and activate? [y/N] ",
    );
    const [input, request] = vi.mocked(fetch).mock.calls[1] ?? [];
    expect(String(input)).toBe("http://server/api/v1/plugins/notes/rollback");
    expect(JSON.parse(String(request?.body))).toEqual({
      expectedVersion: "1.0.0",
    });
    expect(String(vi.mocked(fetch).mock.calls[0]?.[0])).toBe(
      "http://server/api/v1/plugins/notes/rollback",
    );
    expect(vi.mocked(fetch).mock.calls[0]?.[1]?.method).toBeUndefined();
    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      "notes: roll back notes@1.1.0 to notes@1.0.0, the release its last update replaced (kept until 2026-10-28T09:30:00.000Z).",
      "notes: settings, KV entries, data.db, secrets, and schedules return to their values from before the update; changes made since then are discarded.",
      "notes: rolled back notes@1.1.0 → notes@1.0.0; its settings, KV entries, data.db, secrets, and schedules are back to their values from before the update.",
      "notes: its tracked source is unchanged, so `bb plugin update notes` can offer notes@1.1.0 again.",
    ]);
  });

  it("prints only the result with --json", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json(available))
      .mockResolvedValueOnce(
        Response.json(rollbackJob({ state: "completed", result: reverted }), {
          status: 202,
        }),
      );

    await runCommand(
      ["plugin", "rollback", "notes", "--yes", "--json"],
      register,
    );

    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      JSON.stringify({ ok: true, result: reverted }, null, 2),
    ]);
  });

  it.each([
    {
      name: "a plugin without a rollback point",
      response: Response.json({
        outcome: "unavailable",
        detail:
          'plugin "notes" has no rollback point: no update to its current version is still within the rollback window',
      }),
      message:
        'Error: plugin "notes" has no rollback point: no update to its current version is still within the rollback window',
    },
    {
      name: "a bb server that predates plugin rollback",
      response: Response.json(
        { code: "not_found", message: "Not found" },
        { status: 404 },
      ),
      message:
        "notes: not rolled back — the bb server is older than this bb CLI and predates plugin rollback. Upgrade bb on the server, then run `bb plugin rollback notes` again.",
    },
  ])("refuses $name before asking anything", async ({ response, message }) => {
    vi.mocked(fetch).mockResolvedValueOnce(response);

    await expect(
      runCommand(["plugin", "rollback", "notes", "--yes"], register),
    ).rejects.toThrow("process.exit:1");

    expect(vi.mocked(console.error)).toHaveBeenCalledWith(message);
    expect(readlineMocks.question).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("refuses a non-TTY rollback without --yes", async () => {
    Object.defineProperty(process.stdin, "isTTY", {
      value: false,
      configurable: true,
    });
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(available));

    await expect(
      runCommand(["plugin", "rollback", "notes"], register),
    ).rejects.toThrow("process.exit:1");

    expect(vi.mocked(console.error)).toHaveBeenCalledWith(
      "Refusing to roll back without confirmation — re-run with --yes.",
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      name: "a refused rollback",
      job: {
        state: "failed",
        error:
          "rollback refused: expected 1.0.0, but the rollback point is now notes@0.9.0; review the plugin again",
      },
      message:
        "Error: rollback refused: expected 1.0.0, but the rollback point is now notes@0.9.0; review the plugin again",
    },
    {
      name: "a rollback that failed and restored the updated release",
      job: {
        state: "completed",
        result: {
          ...reverted,
          applied: false,
          outcome: "rolled-back",
          detail:
            "rolling back to 1.0.0 failed, so bb restored 1.1.0 and the data it had before the rollback: factory threw",
        },
      },
      message:
        "Error: rolling back to 1.0.0 failed, so bb restored 1.1.0 and the data it had before the rollback: factory threw",
    },
  ])("exits with an error for $name", async ({ job, message }) => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json(available))
      .mockResolvedValueOnce(Response.json(rollbackJob(job), { status: 202 }));

    await expect(
      runCommand(["plugin", "rollback", "notes", "--yes"], register),
    ).rejects.toThrow("process.exit:1");

    expect(vi.mocked(console.error)).toHaveBeenCalledWith(message);
    expect(
      collectLogPayloads(vi.mocked(console.log)).some((line) =>
        line.includes("rolled back"),
      ),
    ).toBe(false);
  });

  it("labels rollback jobs in update-jobs", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        jobs: [
          rollbackJob({ state: "completed", result: reverted }).job,
          {
            id: "update-1",
            pluginId: "notes",
            displayName: "Notes",
            state: "running",
            phase: "checking",
          },
        ],
      }),
    );

    await runCommand(["plugin", "update-jobs"], register);

    const rows = collectLogPayloads(vi.mocked(console.log))
      .join("\n")
      .split("\n");
    expect(rows.find((row) => row.startsWith("rollback-1"))).toMatch(
      /Notes\s+rollback\s+completed\s+reverted$/u,
    );
    expect(rows.find((row) => row.startsWith("update-1"))).toMatch(
      /Notes\s+update\s+running\s+checking$/u,
    );
  });
});
