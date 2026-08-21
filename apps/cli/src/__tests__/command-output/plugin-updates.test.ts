import { describe, expect, it, vi } from "vitest";
import {
  collectLogPayloads,
  getHelpOutput,
  runCommand,
  setupCommandOutputTestEnvironment,
  type CommandRegistrar,
} from "../helpers/command-output-harness.js";
import { registerPluginCommands } from "../../commands/plugin.js";

const version = (value: string) => ({ version: value, display: value });

const pluginList = (id: string, source: string) => ({
  plugins: [
    {
      id,
      source,
      rootDir: `/plugins/${id}`,
      version: "1.0.0",
      provenance: "direct",
      publisherLabel: null,
      isOrphanedBuiltin: false,
      sourceDisplay: `npm · ${id} · tracks compatible`,
      updateState: {},
      enabled: true,
      description: null,
      name: null,
      icon: null,
      iconUrl: null,
      status: "running",
      statusDetail: null,
      handlerStats: { count: 0, totalMs: 0, maxMs: 0, errorCount: 0 },
      services: [],
      schedules: [],
      cliCommand: null,
      hasSettings: false,
      app: { hasApp: false, bundle: null },
      logoUrl: null,
      logoDarkUrl: null,
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

  it("outdated --json prints the parsed results", async () => {
    const results = [
      {
        id: "notes",
        outcome: "current",
        installed: version("1.0.0"),
      },
    ];
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ results }));

    await runCommand(["plugin", "outdated", "--json"], register);

    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      JSON.stringify(results, null, 2),
    ]);
  });

  it("source renders resolved source and activation history", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        requested: "npm:notes@^1",
        resolved: "1.2.0",
        integrity: "sha512-test",
        registry: "https://registry.npmjs.org",
        engines: { bb: ">=0.9", bbPluginSdk: "^0.2.0" },
        installedAt: 1_752_300_000_000,
        history: [
          { version: "1.2.0", activatedAt: 1_752_300_000_000 },
          { version: "1.1.0", activatedAt: 1_752_200_000_000 },
        ],
      }),
    );

    await runCommand(["plugin", "source", "notes"], register);

    const output = collectLogPayloads(vi.mocked(console.log)).join("\n");
    expect(output).toContain("requested: npm:notes@^1");
    expect(output).toContain("resolved: 1.2.0");
    expect(output).toContain("engines.bbPluginSdk: ^0.2.0");
    expect(output).toContain("1.1.0");
  });

  it("source --json prints the shared source contract", async () => {
    const source = {
      requested: "path:/plugins/notes",
      resolved: "path:/plugins/notes",
      engines: {},
      installedAt: 1_752_300_000_000,
      history: [{ version: "1.0.0", activatedAt: 1_752_300_000_000 }],
    };
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(source));

    await runCommand(["plugin", "source", "notes", "--json"], register);

    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      JSON.stringify(source, null, 2),
    ]);
  });

  it("reload rejects an unknown id instead of reporting the full inventory", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        plugins: pluginList("other", "path:/other").plugins,
      }),
    );

    await expect(
      runCommand(["plugin", "reload", "missing", "--json"], register),
    ).rejects.toThrow("process.exit:1");

    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      JSON.stringify({ ok: false, error: 'unknown plugin "missing"' }, null, 2),
    ]);
  });

  it("reload prints only the requested plugin in human output", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        plugins: [
          ...pluginList("notes", "path:/notes").plugins,
          ...pluginList("other", "path:/other").plugins,
        ],
      }),
    );

    await runCommand(["plugin", "reload", "notes"], register);

    const output = collectLogPayloads(vi.mocked(console.log)).join("\n");
    expect(output).toContain("notes@1.0.0");
    expect(output).not.toContain("other@1.0.0");
  });

  it("skips pinned plugins with manual reinstall guidance", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        results: [
          {
            id: "notes",
            outcome: "pinned",
            installed: version("1.0.0"),
            detail: "source pins 1.0.0",
          },
        ],
      }),
    );

    await runCommand(["plugin", "update", "notes"], register);

    expect(collectLogPayloads(vi.mocked(console.log)).join("\n")).toContain(
      "remove and reinstall with a tracking npm range, git branch, or git semver range",
    );
    expect(fetch).toHaveBeenCalledTimes(1);
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
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({});
  });

  it("renders a rolled-back server result", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        jsonResponse({
          results: [
            {
              id: "notes",
              outcome: "update-available",
              installed: version("1"),
              candidate: version("2"),
            },
          ],
        }),
      )
      .mockResolvedValueOnce(jsonResponse(pluginList("notes", "npm:notes@^1")))
      .mockResolvedValueOnce(
        jsonResponse({
          applied: false,
          from: version("1"),
          to: version("2"),
          outcome: "rolled-back",
          detail: "activation failed; restored 1",
        }),
      );

    await runCommand(["plugin", "update", "notes", "--yes"], register);

    expect(collectLogPayloads(vi.mocked(console.log)).join("\n")).toContain(
      "notes: rolled-back — activation failed; restored 1",
    );
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
    expect(updateHelp).not.toContain("--dry-run");
    expect(updateHelp).not.toContain("--latest");
    expect(updateHelp).toContain("--yes");
  });
});
