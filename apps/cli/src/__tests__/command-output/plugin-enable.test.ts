import { describe, expect, it, vi } from "vitest";
import {
  collectLogPayloads,
  runCommand,
  setupCommandOutputTestEnvironment,
  type CommandRegistrar,
} from "../helpers/command-output-harness.js";
import { registerPluginCommands } from "../../commands/plugin.js";

const enableResponse = (status: string, statusDetail: string | null) =>
  Response.json({
    ok: true,
    plugin: {
      id: "boom",
      source: "path:/plugins/boom",
      rootDir: "/plugins/boom",
      version: "0.0.1",
      provenance: "direct",
      publisherLabel: null,
      isOrphanedBuiltin: false,
      sourceDisplay: "path · /plugins/boom",
      updateState: {},
      enabled: true,
      description: null,
      name: null,
      icon: null,
      iconUrl: null,
      status,
      statusDetail,
      handlerStats: { count: 0, totalMs: 0, maxMs: 0, errorCount: 0 },
      services: [],
      schedules: [],
      cliCommand: null,
      hasSettings: false,
      app: { hasApp: false, bundle: null },
      logoUrl: null,
      logoDarkUrl: null,
    },
  });

describe("bb plugin enable", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerPluginCommands(program, () => "http://server");

  it("exits 1 with the load error when the enabled plugin fails to load", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(enableResponse("error", "boom"));

    await expect(
      runCommand(["plugin", "enable", "boom"], register),
    ).rejects.toThrow("process.exit:1");

    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      "boom@0.0.1  error  (boom)",
      "  source: path:/plugins/boom",
    ]);
    expect(console.error).toHaveBeenCalledWith("boom");
  });

  it("reports ok false in JSON when the enabled plugin fails to load", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(enableResponse("error", "boom"));

    await expect(
      runCommand(["plugin", "enable", "boom", "--json"], register),
    ).rejects.toThrow("process.exit:1");

    const [payload] = collectLogPayloads(vi.mocked(console.log));
    expect(JSON.parse(payload ?? "")).toMatchObject({
      ok: false,
      error: "boom",
      plugin: { id: "boom", status: "error" },
    });
  });

  it("succeeds when safe mode holds the enabled plugin back", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      enableResponse("disabled", "held by plugin safe mode"),
    );

    await runCommand(["plugin", "enable", "boom"], register);

    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      "boom@0.0.1  disabled  (held by plugin safe mode)",
      "  source: path:/plugins/boom",
    ]);
    expect(console.error).not.toHaveBeenCalled();
  });
});
