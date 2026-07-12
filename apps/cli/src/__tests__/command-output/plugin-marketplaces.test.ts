import { describe, expect, it, vi } from "vitest";
import {
  collectLogPayloads,
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
  lastRefreshAt: "2026-07-12T12:00:00.000Z",
  enabled: true,
};

const searchResult = {
  marketplaceId: marketplace.id,
  entryId: "linear",
  displayName: "Linear",
  description: "Linear issue tools",
  source: "npm:@example/linear@1.4.2",
  installed: false,
  compatible: true,
};

const installedPlugin = {
  id: "linear",
  source: "marketplace:market-1/linear",
  rootDir: "/plugins/linear",
  version: "1.4.2",
  enabled: true,
  status: "active",
  statusDetail: null,
  handlerStats: { count: 0, totalMs: 0, maxMs: 0, errorCount: 0 },
  services: [],
  schedules: [],
  cliCommand: null,
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

  it("resolves name@marketplace and passes the requested version", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(json({ marketplaces: [marketplace] }))
      .mockResolvedValueOnce(json({ results: [searchResult] }))
      .mockResolvedValueOnce(json({ ok: true, plugin: installedPlugin }));

    await runCommand(
      [
        "plugin",
        "install",
        "linear@bb-official",
        "--version",
        "^1.4.0",
        "--yes",
      ],
      register,
    );

    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({
      marketplace: { marketplaceId: "market-1", entryId: "linear" },
      version: "^1.4.0",
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

  it.each([
    { flag: "--keep-all", action: "keep" },
    { flag: "--uninstall-all", action: "uninstall" },
  ])("applies the $flag removal policy", async ({ flag, action }) => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(json({ marketplaces: [marketplace] }))
      .mockResolvedValueOnce(
        json(
          {
            error: "policy required",
            affectedPlugins: [{ id: "linear", version: "1.4.2" }],
          },
          422,
        ),
      )
      .mockResolvedValueOnce(json({ kept: [], uninstalled: [] }));

    await runCommand(
      ["plugin", "marketplace", "remove", marketplace.name, flag],
      register,
    );

    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({
      dispositions: [{ pluginId: "linear", action }],
    });
  });

  it("prompts per plugin and fails non-interactively without a policy", async () => {
    const affected = {
      error: "choose dispositions",
      affectedPlugins: [{ id: "linear", version: "1.4.2" }],
    };
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(json({ marketplaces: [marketplace] }))
      .mockResolvedValueOnce(json(affected, 422))
      .mockResolvedValueOnce(json({ kept: ["linear"], uninstalled: [] }));
    readlineMocks.question.mockResolvedValue("keep");
    await runCommand(
      ["plugin", "marketplace", "remove", marketplace.name],
      register,
    );
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({
      dispositions: [{ pluginId: "linear", action: "keep" }],
    });

    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(json({ marketplaces: [marketplace] }))
      .mockResolvedValueOnce(json(affected, 422));
    Object.defineProperty(process.stdin, "isTTY", {
      value: false,
      configurable: true,
    });
    await expect(
      runCommand(
        ["plugin", "marketplace", "remove", marketplace.name],
        register,
      ),
    ).rejects.toThrow("process.exit:1");
    expect(collectLogPayloads(vi.mocked(console.error)).join("\n")).toContain(
      "choose dispositions",
    );
  });
});
