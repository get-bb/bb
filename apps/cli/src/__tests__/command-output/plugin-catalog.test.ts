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

const catalog = {
  pluginCount: 2,
  lastRefreshAt: Date.parse("2026-07-12T12:00:00.000Z"),
  lastAttemptAt: Date.parse("2026-07-12T12:00:00.000Z"),
  lastError: null,
};

const searchResult = {
  entryId: "linear",
  displayName: "Linear",
  description: "Linear issue tools",
  icon: null,
  category: null,
  source: "npm:@example/linear@1.4.2",
  installed: false,
  compatible: true,
  incompatibleReason: null,
};

const installedPlugin = {
  id: "linear",
  source: "catalog:linear",
  rootDir: "/plugins/linear",
  version: "1.4.2",
  provenance: "catalog",
  isOrphanedBuiltin: false,
  catalogEntryId: "linear",
  sourceDisplay: "npm · @example/linear · tracks compatible",
  updateState: {},
  enabled: true,
  description: "Linear issue tools",
  name: "Linear",
  icon: null,
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
};

function json(value: object, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("bb plugin catalog", () => {
  setupCommandOutputTestEnvironment();
  const register: CommandRegistrar = (program) =>
    registerPluginCommands(program, () => "http://server");

  it("shows singleton catalog status", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ catalog }));

    await runCommand(["plugin", "catalog", "status"], register);

    const output = collectLogPayloads(vi.mocked(console.log)).join("\n");
    expect(output).toContain("Plugin catalog");
    expect(output).toContain("plugins: 2");
  });

  it("refreshes the singleton catalog with a strict empty body", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ catalog }));

    await runCommand(["plugin", "catalog", "refresh"], register);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      "http://server/api/v1/plugin-catalog/refresh",
      expect.objectContaining({ method: "POST", body: "{}" }),
    );
  });

  it("renders catalog search without marketplace qualifiers", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ results: [searchResult] }));

    await runCommand(["plugin", "search", "lin"], register);

    const output = collectLogPayloads(vi.mocked(console.log)).join("\n");
    expect(output).toContain("Linear issue tools");
    expect(output).toContain("compatible");
    expect(output).not.toContain("Marketplace");
  });

  it("outputs raw catalog search results as JSON", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ results: [searchResult] }));

    await runCommand(["plugin", "search", "lin", "--json"], register);

    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      JSON.stringify([searchResult], null, 2),
    ]);
  });

  it("treats path syntax as a path without catalog lookup", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ ok: true, plugin: installedPlugin }),
    );

    await runCommand(["plugin", "install", "./linear", "--yes"], register);

    expect(fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body));
    expect(body.source).toMatch(/^path:.*\/linear$/);
  });

  it("keeps install --json free of human trust preamble output", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ ok: true, plugin: installedPlugin }),
    );

    await runCommand(
      ["plugin", "install", "path:/linear", "--yes", "--json"],
      register,
    );

    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      JSON.stringify({ ok: true, plugin: installedPlugin }, null, 2),
    ]);
  });

  it("installs an exact bare catalog entry", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(json({ results: [searchResult] }))
      .mockResolvedValueOnce(json({ ok: true, plugin: installedPlugin }));

    await runCommand(["plugin", "install", "linear", "--yes"], register);

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://server/api/v1/plugin-catalog/search?q=linear",
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "http://server/api/v1/plugin-catalog/install",
    );
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      entryId: "linear",
    });
    expect(collectLogPayloads(vi.mocked(console.log)).join("\n")).toContain(
      "from the plugin catalog",
    );
  });

  it("preserves full-trust confirmation for catalog installs", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(json({ results: [searchResult] }))
      .mockResolvedValueOnce(json({ ok: true, plugin: installedPlugin }));
    readlineMocks.question.mockResolvedValue("yes");

    await runCommand(["plugin", "install", "linear"], register);

    expect(readlineMocks.question).toHaveBeenCalledWith("Install? [y/N] ");
  });

  it("does not resolve the removed entry@marketplace syntax", async () => {
    await expect(
      runCommand(
        ["plugin", "install", "linear@bb-official", "--yes"],
        register,
      ),
    ).rejects.toThrow("process.exit:1");

    expect(fetch).not.toHaveBeenCalled();
    expect(collectLogPayloads(vi.mocked(console.error)).join("\n")).toContain(
      "either a catalog plugin or a path on disk",
    );
  });

  it("reports both interpretations and direct-source escape hatches", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ results: [] }));

    await expect(
      runCommand(["plugin", "install", "missing", "--yes"], register),
    ).rejects.toThrow("process.exit:1");

    const error = collectLogPayloads(vi.mocked(console.error)).join("\n");
    expect(error).toContain("either a catalog plugin or a path on disk");
    expect(error).toContain("path:<path>");
    expect(error).toContain("npm:<package>");
    expect(error).toContain("git:<url>@<ref>");
  });

  it("advertises only singleton catalog commands", async () => {
    const pluginHelp = await getHelpOutput(["plugin"], register);
    expect(pluginHelp).toContain("catalog");
    expect(pluginHelp).not.toContain("marketplace");

    const catalogHelp = await getHelpOutput(["plugin", "catalog"], register);
    expect(catalogHelp).toContain("status");
    expect(catalogHelp).toContain("refresh");
    expect(catalogHelp).not.toContain("add");
    expect(catalogHelp).not.toContain("remove");

    const installHelp = await getHelpOutput(["plugin", "install"], register);
    expect(installHelp).not.toContain("--version");
  });
});
