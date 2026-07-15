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

const marketplace = {
  id: "market-1",
  name: "bb-official",
  displayName: "BB Official",
  source: "https://example.com/catalog.git",
  resolvedCommit: "abc123",
  pluginCount: 2,
  lastRefreshAt: Date.parse("2026-07-12T12:00:00.000Z"),
};

const searchResult = {
  marketplaceId: marketplace.id,
  entryId: "linear",
  displayName: "Linear",
  description: "Linear issue tools",
  icon: null,
  source: "npm:@example/linear@1.4.2",
  installed: false,
  compatible: true,
};

const installedPlugin = {
  id: "linear",
  source: "marketplace:market-1/linear",
  rootDir: "/plugins/linear",
  version: "1.4.2",
  provenance: "marketplace",
  isOrphanedBuiltin: false,
  marketplaceName: "BB Official",
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

describe("bb plugin marketplaces", () => {
  setupCommandOutputTestEnvironment();
  const register: CommandRegistrar = (program) =>
    registerPluginCommands(program, () => "http://server");

  it("lists the reduced marketplace view", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ marketplaces: [marketplace] }),
    );

    await runCommand(["plugin", "marketplace", "list"], register);

    const output = collectLogPayloads(vi.mocked(console.log)).join("\n");
    expect(output).toContain("Name");
    expect(output).toContain("Source");
    expect(output).toContain("Plugins");
    expect(output).not.toContain("Auto-check");
  });

  it("warns before adding a remote marketplace and says it installs nothing", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ marketplace }, 201));
    readlineMocks.question.mockResolvedValue("yes");

    await runCommand(
      ["plugin", "marketplace", "add", marketplace.source],
      register,
    );

    expect(readlineMocks.question).toHaveBeenCalledWith(
      "Trust and add this marketplace? [y/N] ",
    );
    expect(collectLogPayloads(vi.mocked(console.log)).join("\n")).toContain(
      "installs NOTHING",
    );
  });

  it.each([
    "owner/catalog",
    "ssh://git@example.com/owner/catalog.git",
    "git@github.com:owner/catalog.git",
  ])("--yes explicitly trusts Git marketplace source %s", async (source) => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ marketplace }, 201));

    await runCommand(
      ["plugin", "marketplace", "add", source, "--yes"],
      register,
    );

    expect(readlineMocks.question).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body)),
    ).toEqual({ source });
  });

  it.each([
    "owner/catalog",
    "ssh://git@example.com/owner/catalog.git",
    "git@github.com:owner/catalog.git",
  ])("refuses Git marketplace source %s in non-TTY mode", async (source) => {
    Object.defineProperty(process.stdin, "isTTY", {
      value: false,
      configurable: true,
    });

    await expect(
      runCommand(["plugin", "marketplace", "add", source], register),
    ).rejects.toThrow("process.exit:1");

    expect(fetch).not.toHaveBeenCalled();
    expect(collectLogPayloads(vi.mocked(console.error)).join("\n")).toContain(
      "Refusing to add a remote marketplace without confirmation",
    );
  });

  it("renders search status and marketplace names", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ results: [searchResult] }))
      .mockResolvedValueOnce(json({ marketplaces: [marketplace] }));

    await runCommand(["plugin", "search", "lin"], register);

    const output = collectLogPayloads(vi.mocked(console.log)).join("\n");
    expect(output).toContain("Linear issue tools");
    expect(output).toContain("bb-official");
    expect(output).toContain("compatible");
  });

  it("treats path syntax as a path without marketplace lookup", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ ok: true, plugin: installedPlugin }),
    );

    await runCommand(["plugin", "install", "./linear", "--yes"], register);

    expect(fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body));
    expect(body.source).toMatch(/^path:.*\/linear$/);
  });

  it("resolves name@marketplace without a version override", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(json({ marketplaces: [marketplace] }))
      .mockResolvedValueOnce(json({ results: [searchResult] }))
      .mockResolvedValueOnce(json({ ok: true, plugin: installedPlugin }));

    await runCommand(
      ["plugin", "install", "linear@bb-official", "--yes"],
      register,
    );

    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({
      marketplace: { marketplaceId: "market-1", entryId: "linear" },
    });
    expect(collectLogPayloads(vi.mocked(console.log)).join("\n")).toContain(
      "bb-official",
    );
  });

  it("resolves a unique bare name and reports ambiguous matches", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(json({ results: [searchResult] }))
      .mockResolvedValueOnce(json({ marketplaces: [marketplace] }))
      .mockResolvedValueOnce(json({ ok: true, plugin: installedPlugin }));
    await runCommand(["plugin", "install", "linear", "--yes"], register);
    expect(
      JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body)),
    ).toHaveProperty("marketplace.entryId", "linear");

    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(
        json({
          results: [
            searchResult,
            { ...searchResult, marketplaceId: "market-2" },
          ],
        }),
      )
      .mockResolvedValueOnce(
        json({
          marketplaces: [
            marketplace,
            { ...marketplace, id: "market-2", name: "community" },
          ],
        }),
      );
    await expect(
      runCommand(["plugin", "install", "linear", "--yes"], register),
    ).rejects.toThrow("process.exit:1");
    expect(collectLogPayloads(vi.mocked(console.error)).join("\n")).toContain(
      "linear@community",
    );
  });

  it("reports both interpretations and escape hatches for unknown names", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ marketplaces: [marketplace] }),
    );
    await expect(
      runCommand(["plugin", "install", "missing@unknown", "--yes"], register),
    ).rejects.toThrow("process.exit:1");
    const error = collectLogPayloads(vi.mocked(console.error)).join("\n");
    expect(error).toContain("either a marketplace plugin or a path on disk");
    expect(error).toContain("path:<path>");
    expect(error).toContain("npm:<package>");
    expect(error).toContain("git:<url>@<ref>");
  });

  it("removes a marketplace without a body and reports direct installs", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(json({ marketplaces: [marketplace] }))
      .mockResolvedValueOnce(json({ convertedPluginIds: ["linear"] }));

    await runCommand(
      ["plugin", "marketplace", "remove", marketplace.name],
      register,
    );

    expect(fetchMock.mock.calls[1]?.[1]?.body).toBeUndefined();
    expect(collectLogPayloads(vi.mocked(console.log)).join("\n")).toContain(
      "1 plugins kept as direct installs",
    );
  });

  it("does not advertise removed marketplace and automatic-update surfaces", async () => {
    const pluginHelp = await getHelpOutput(["plugin"], register);
    expect(pluginHelp).not.toContain("auto-apply");
    expect(pluginHelp).toContain("source [options] <id>");

    const marketplaceHelp = await getHelpOutput(
      ["plugin", "marketplace"],
      register,
    );
    expect(marketplaceHelp).not.toContain("auto [options]");

    const installHelp = await getHelpOutput(["plugin", "install"], register);
    expect(installHelp).not.toContain("--version");

    const removeHelp = await getHelpOutput(
      ["plugin", "marketplace", "remove"],
      register,
    );
    expect(removeHelp).not.toContain("--keep-all");
    expect(removeHelp).not.toContain("--uninstall-all");
  });
});
