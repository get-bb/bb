import { describe, expect, it, vi } from "vitest";
import {
  collectLogPayloads,
  getHelpOutput,
  readlineMocks,
  runCommand,
  setupCommandOutputTestEnvironment,
  type CommandRegistrar,
} from "../helpers/command-output-harness.js";
import { registerPluginCommands } from "../../commands/plugin.js";

const version = (value: string) => ({ version: value, display: value });

const pluginList = (id: string, source: string) => ({
  enabled: true,
  plugins: [
    {
      id,
      source,
      rootDir: `/plugins/${id}`,
      version: "1.0.0",
      enabled: true,
      status: "active",
      statusDetail: null,
      handlerStats: { count: 0, totalMs: 0, maxMs: 0, errorCount: 0 },
      services: [],
      schedules: [],
      cliCommand: null,
    },
  ],
});

function jsonResponse(value: object, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("bb plugin update commands", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerPluginCommands(program, () => "http://server");

  it("outdated renders every outcome, reasons, and the dev-build annotation", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        results: [
          { id: "a", outcome: "current", installed: version("1.0.0") },
          {
            id: "b",
            outcome: "update-available",
            installed: version("1.0.0"),
            candidate: version("1.1.0"),
          },
          {
            id: "c",
            outcome: "pinned",
            installed: version("2.0.0"),
            candidate: version("3.0.0"),
          },
          {
            id: "d",
            outcome: "incompatible",
            devMode: true,
            installed: version("1.0.0"),
            blocked: { version: "2.0.0", reasons: ["requires bb >= 9"] },
          },
          {
            id: "e",
            outcome: "unavailable",
            installed: version("1.0.0"),
            detail: "registry offline",
          },
        ],
      }),
    );

    await runCommand(["plugin", "outdated"], register);

    const output = collectLogPayloads(vi.mocked(console.log)).join("\n");
    expect(output).toContain("update available");
    expect(output).toContain("pinned");
    expect(output).toContain("2.0.0: requires bb >= 9");
    expect(output).toContain(
      "incompatible [dev build: engines.bb not enforced]",
    );
    expect(output).toContain("unavailable");
  });

  it("outdated --json prints the raw results and accepts devMode false", async () => {
    const results = [
      {
        id: "notes",
        outcome: "current",
        devMode: false,
        installed: version("1.0.0"),
      },
    ];
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ results }));

    await runCommand(["plugin", "outdated", "--json"], register);

    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      JSON.stringify(results, null, 2),
    ]);
  });

  it("dry-run sends dryRun and explains selection and activation", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          results: [
            {
              id: "notes",
              outcome: "update-available",
              installed: version("1.0.0"),
              candidate: version("1.2.0"),
            },
          ],
        }),
      )
      .mockResolvedValueOnce(jsonResponse(pluginList("notes", "npm:notes@^1")))
      .mockResolvedValueOnce(
        jsonResponse({
          applied: false,
          dryRun: true,
          from: version("1.0.0"),
          to: version("1.2.0"),
          outcome: "update-available",
        }),
      );

    await runCommand(["plugin", "update", "notes", "--dry-run"], register);

    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({
      dryRun: true,
    });
    expect(collectLogPayloads(vi.mocked(console.log)).join("\n")).toContain(
      "would select 1.2.0 from npm:notes@^1, activate 1.0.0 → 1.2.0",
    );
  });

  it("skips pinned by default and confirms both latest intent and execution", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        results: [
          {
            id: "notes",
            outcome: "pinned",
            installed: version("1.0.0"),
            candidate: version("2.0.0"),
            detail: "source pins 1.0.0",
          },
        ],
      }),
    );
    await runCommand(["plugin", "update", "notes"], register);
    expect(collectLogPayloads(vi.mocked(console.log)).join("\n")).toContain(
      "use --latest",
    );

    fetchMock.mockReset();
    readlineMocks.question.mockReset();
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          results: [
            {
              id: "notes",
              outcome: "pinned",
              installed: version("1.0.0"),
              candidate: version("2.0.0"),
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(pluginList("notes", "npm:notes@1.0.0")),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          applied: true,
          dryRun: false,
          from: version("1.0.0"),
          to: version("2.0.0"),
          outcome: "updated",
        }),
      );
    readlineMocks.question.mockResolvedValue("yes");

    await runCommand(["plugin", "update", "notes", "--latest"], register);

    expect(readlineMocks.question).toHaveBeenCalledTimes(2);
    expect(collectLogPayloads(vi.mocked(console.log)).join("\n")).toContain(
      "notes source intent: npm:notes@1.0.0 → latest compatible",
    );
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({
      latest: true,
    });
  });

  it.each([
    { name: "source-intent", answers: ["no"] },
    { name: "full-trust", answers: ["yes", "no"] },
  ])("declining the $name prompt prevents mutation", async ({ answers }) => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          results: [
            {
              id: "notes",
              outcome: "pinned",
              installed: version("1.0.0"),
              candidate: version("2.0.0"),
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(pluginList("notes", "npm:notes@1.0.0")),
      );
    for (const answer of answers) {
      readlineMocks.question.mockResolvedValueOnce(answer);
    }

    await expect(
      runCommand(["plugin", "update", "notes", "--latest"], register),
    ).rejects.toThrow("process.exit:1");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(readlineMocks.question).toHaveBeenCalledTimes(answers.length);
  });

  it("--yes skips both latest prompts", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          results: [
            {
              id: "notes",
              outcome: "pinned",
              installed: version("1.0.0"),
              candidate: version("2.0.0"),
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(pluginList("notes", "npm:notes@1.0.0")),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          applied: true,
          dryRun: false,
          from: version("1.0.0"),
          to: version("2.0.0"),
          outcome: "updated",
        }),
      );

    await runCommand(
      ["plugin", "update", "notes", "--latest", "--yes"],
      register,
    );

    expect(readlineMocks.question).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("rejects --all with --latest before making a request", async () => {
    await expect(
      runCommand(["plugin", "update", "--all", "--latest"], register),
    ).rejects.toThrow("process.exit:1");

    expect(vi.mocked(console.error)).toHaveBeenCalledWith(
      "--latest is only valid when updating one plugin.",
    );
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("--all updates compatible results and skips pinned and incompatible", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          results: [
            { id: "pin", outcome: "pinned", installed: version("1") },
            {
              id: "bad",
              outcome: "incompatible",
              installed: version("1"),
              blocked: { version: "2", reasons: ["requires newer bb"] },
            },
            {
              id: "good",
              outcome: "update-available",
              installed: version("1"),
              candidate: version("2"),
            },
          ],
        }),
      )
      .mockResolvedValueOnce(jsonResponse(pluginList("good", "npm:good@^1")))
      .mockResolvedValueOnce(
        jsonResponse({
          applied: true,
          dryRun: false,
          from: version("1"),
          to: version("2"),
          outcome: "updated",
        }),
      );

    await runCommand(["plugin", "update", "--all", "--yes"], register);

    const output = collectLogPayloads(vi.mocked(console.log)).join("\n");
    expect(output).toContain("pin: skipped — pinned");
    expect(output).toContain("bad: skipped — incompatible: requires newer bb");
    expect(output).toContain("good: updated and activated 1 → 2");
  });

  it("renders a 422 message and refuses non-TTY updates without --yes", async () => {
    const update = {
      results: [
        {
          id: "notes",
          outcome: "update-available",
          installed: version("1"),
          candidate: version("2"),
        },
      ],
    };
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(update))
      .mockResolvedValueOnce(jsonResponse(pluginList("notes", "npm:notes@^1")))
      .mockResolvedValueOnce(
        jsonResponse({ error: "signature verification failed" }, 422),
      );
    await expect(
      runCommand(["plugin", "update", "notes", "--yes"], register),
    ).rejects.toThrow("process.exit:1");
    expect(vi.mocked(console.error)).toHaveBeenCalledWith(
      "signature verification failed",
    );

    vi.clearAllMocks();
    Object.defineProperty(process.stdin, "isTTY", {
      value: false,
      configurable: true,
    });
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(update))
      .mockResolvedValueOnce(jsonResponse(pluginList("notes", "npm:notes@^1")));
    await expect(
      runCommand(["plugin", "update", "notes"], register),
    ).rejects.toThrow("process.exit:1");
    expect(vi.mocked(console.error)).toHaveBeenCalledWith(
      "Refusing to update without confirmation — re-run with --yes.",
    );
  });

  it("documents update commands and flags in help", async () => {
    const pluginHelp = await getHelpOutput(["plugin"], register);
    expect(pluginHelp).toContain("outdated");
    expect(pluginHelp).toContain("update [options] [id]");
    const updateHelp = await getHelpOutput(["plugin", "update"], register);
    expect(updateHelp).toContain("--all");
    expect(updateHelp).toContain("--dry-run");
    expect(updateHelp).toContain("--latest");
    expect(updateHelp).toContain("--yes");
  });
});
