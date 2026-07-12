import { describe, expect, it, vi } from "vitest";
import {
  collectLogPayloads,
  getHelpOutput,
  runCommand,
  setupCommandOutputTestEnvironment,
  type CommandRegistrar,
} from "../helpers/command-output-harness.js";
import { registerPluginCommands } from "../../commands/plugin.js";

const marketplace = {
  id: "official",
  name: "bb-official",
  displayName: "BB Official",
  source: "https://example.com/catalog.git",
  pluginCount: 2,
  enabled: true,
  scope: "official",
  autoCheck: false,
  autoApply: false,
};

const event = {
  kind: "activate",
  fromVersion: "1.0.0",
  toVersion: "1.1.0",
  outcome: "updated",
  detail: "compatible patch",
  at: Date.parse("2026-07-12T12:00:00.000Z"),
};

function json(value: object, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("bb plugin automatic updates and history", () => {
  setupCommandOutputTestEnvironment();
  const register: CommandRegistrar = (program) =>
    registerPluginCommands(program, () => "http://server");

  it("sets per-plugin auto-apply and explains an organization override", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ autoApply: true }))
      .mockResolvedValueOnce(
        json({ generalSettings: { pluginAutoApplyDisabled: true } }),
      );

    await runCommand(["plugin", "auto-apply", "notes", "on"], register);

    expect(
      JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body)),
    ).toEqual({
      enabled: true,
    });
    const output = collectLogPayloads(vi.mocked(console.log)).join("\n");
    expect(output).toContain("Auto-apply for notes: on");
    expect(output).toContain("organization policy");
    expect(output).toContain("overrides");
  });

  it("sets marketplace policy, renders it, and notes official bounds", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ marketplaces: [marketplace] }))
      .mockResolvedValueOnce(json({ autoCheck: true, autoApply: true }));

    await runCommand(
      [
        "plugin",
        "marketplace",
        "auto",
        "bb-official",
        "--check",
        "on",
        "--apply",
        "on",
      ],
      register,
    );

    expect(
      JSON.parse(String(vi.mocked(fetch).mock.calls[1]?.[1]?.body)),
    ).toEqual({
      autoCheck: true,
      autoApply: true,
    });
    const output = collectLogPayloads(vi.mocked(console.log)).join("\n");
    expect(output).toContain("Auto-check: on");
    expect(output).toContain("Auto-apply: on");
    expect(output).toContain("compatible, non-major updates");
  });

  it("rejects a mismatched echoed policy", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ marketplaces: [marketplace] }))
      .mockResolvedValueOnce(json({ autoCheck: false, autoApply: false }));

    await expect(
      runCommand(
        ["plugin", "marketplace", "auto", "bb-official", "--check", "on"],
        register,
      ),
    ).rejects.toThrow("process.exit:1");
    expect(collectLogPayloads(vi.mocked(console.error)).join("\n")).toContain(
      "did not match the requested state",
    );
  });

  it("renders plugin history and the cross-plugin audit feed", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ events: [event] }));
    await runCommand(["plugin", "history", "notes"], register);
    let output = collectLogPayloads(vi.mocked(console.log)).join("\n");
    expect(output).toContain("From → to");
    expect(output).toContain("1.0.0 → 1.1.0");
    expect(output).toContain("compatible patch");

    vi.clearAllMocks();
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ events: [{ ...event, pluginId: "notes" }] }),
    );
    await runCommand(["plugin", "history", "--all", "--limit", "12"], register);
    output = collectLogPayloads(vi.mocked(console.log)).join("\n");
    expect(output).toContain("Plugin");
    expect(output).toContain("notes");
    expect(String(vi.mocked(fetch).mock.calls[0]?.[0])).toContain("limit=12");
  });

  it("documents automatic policy and history flags in help", async () => {
    expect(await getHelpOutput(["plugin"], register)).toContain("auto-apply");
    expect(await getHelpOutput(["plugin"], register)).toContain("history");
    const marketplaceHelp = await getHelpOutput(
      ["plugin", "marketplace"],
      register,
    );
    expect(marketplaceHelp).toContain("auto");
    const autoHelp = await getHelpOutput(
      ["plugin", "marketplace", "auto"],
      register,
    );
    expect(autoHelp).toContain("--check");
    expect(autoHelp).toContain("--apply");
    const historyHelp = await getHelpOutput(["plugin", "history"], register);
    expect(historyHelp).toContain("--all");
    expect(historyHelp).toContain("--limit");
    expect(historyHelp).toContain("--json");
  });
});
