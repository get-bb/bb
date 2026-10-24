// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

const app = await loadPluginApp(() => import("./app"));

const memory = {
  id: "mem_1",
  scope: "project",
  projectId: "proj_1",
  name: "validation",
  summary: "Run focused tests.",
  details: "Use the repository test command.",
  kind: "procedure",
  tags: ["testing"],
  importance: 60,
  pinned: false,
  version: 1,
  updatedAt: 1_700_000_000_000,
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("memory settings", () => {
  it("lists all memories and saves an inline edit", async () => {
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        rpc: {
          listMemories: () => ({ memories: [memory] }),
          updateMemory: () => ({
            memory: {
              ...memory,
              summary: "Run all focused tests.",
              version: 2,
            },
          }),
        },
      },
    );

    expect(await slot.findByText("validation")).toBeTruthy();
    expect(slot.getByText("project")).toBeTruthy();
    fireEvent.click(slot.getByRole("button", { name: "Edit" }));
    fireEvent.change(slot.getByLabelText("Memory summary"), {
      target: { value: "Run all focused tests." },
    });
    fireEvent.click(slot.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(slot.rpcCalls).toContainEqual({
        method: "updateMemory",
        input: expect.objectContaining({
          id: memory.id,
          expectedVersion: 1,
          summary: "Run all focused tests.",
        }),
      }),
    );
    await slot.findByText("Run all focused tests.");
  });

  it("confirms and deletes a memory", async () => {
    const confirm = vi
      .fn<(message: string) => boolean>()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    vi.stubGlobal("confirm", confirm);
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        rpc: {
          listMemories: () => ({ memories: [memory] }),
          deleteMemory: () => ({ deleted: { id: memory.id, version: 2 } }),
        },
      },
    );

    expect(await slot.findByText("validation")).toBeTruthy();
    fireEvent.click(slot.getByRole("button", { name: "Delete" }));
    expect(confirm).toHaveBeenCalledWith("Delete memory “validation”?");
    expect(
      slot.rpcCalls.filter((call) => call.method === "deleteMemory"),
    ).toEqual([]);
    expect(slot.getByText("validation")).toBeTruthy();

    fireEvent.click(slot.getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(slot.rpcCalls).toContainEqual({
        method: "deleteMemory",
        input: { id: memory.id, expectedVersion: 1 },
      }),
    );
    await waitFor(() => expect(slot.queryByText("validation")).toBeNull());
  });

  it("opens a new thread prefilled with the generic import request", async () => {
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        rpc: { listMemories: () => ({ memories: [] }) },
        sdk: providerFakes(["claude-code", "codex", "pi"]),
      },
    );

    fireEvent.click(
      await slot.findByRole("button", { name: "Import memories" }),
    );

    expect(slot.navigateCalls).toEqual([
      {
        method: "toCompose",
        options: {
          focusPrompt: true,
          initialPrompt:
            "Import my agents' built-in memories into bb Memory. Show me the plan before saving.",
        },
      },
    ]);
    expect(
      slot.getByText("Bring over what your agents already remember."),
    ).toBeTruthy();
    expect(
      slot.getByRole("link", { name: "built-in memory" }).getAttribute("href"),
    ).toBe("/settings/plugins");
    expect(slot.queryByText(/Claude Code|Codex/)).toBeNull();

    const skillDescription = /^description: (.+)$/m.exec(
      readFileSync(
        join(
          dirname(fileURLToPath(import.meta.url)),
          "skills/import-native-memories/SKILL.md",
        ),
        "utf8",
      ),
    )?.[1];
    expect(skillDescription).toContain("built-in memories");
  });

  it("links to the only enabled provider with built-in memory", async () => {
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        rpc: { listMemories: () => ({ memories: [] }) },
        sdk: providerFakes(["codex", "pi"]),
      },
    );

    const link = await slot.findByRole("link", { name: "built-in memory" });
    expect(link.getAttribute("href")).toBe("/settings/plugins/provider-codex");
    expect(slot.getByRole("button", { name: "Import memories" })).toBeTruthy();
    expect(slot.queryByText(/Claude Code|Codex/)).toBeNull();
  });

  it("hides the notice when no enabled provider has built-in memory", async () => {
    const sdk = providerFakes(["pi"]);
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      { rpc: { listMemories: () => ({ memories: [] }) }, sdk },
    );

    await waitFor(() =>
      expect(
        slot.sdkCalls.filter((call) => call.method === "plugins.getSettings"),
      ).toHaveLength(1),
    );
    await slot.findByText("No memories stored yet.");
    expect(slot.queryByRole("button", { name: "Import memories" })).toBeNull();
    expect(slot.queryByText(/built-in memory/)).toBeNull();
  });
});

const PROVIDER_FIXTURES = {
  "claude-code": {
    pluginId: "provider-claude-code",
    displayName: "Claude Code",
    pluginName: "Claude Code provider",
    memoryLabel: "Claude Code memory",
  },
  codex: {
    pluginId: "provider-codex",
    displayName: "Codex",
    pluginName: "Codex provider",
    memoryLabel: "Codex memory",
  },
  pi: {
    pluginId: "provider-pi",
    displayName: "Pi",
    pluginName: "Pi provider",
    memoryLabel: null,
  },
} as const;

type ProviderFixtureId = keyof typeof PROVIDER_FIXTURES;

function providerFakes(enabled: ProviderFixtureId[]) {
  const ids = Object.keys(PROVIDER_FIXTURES) as ProviderFixtureId[];
  return {
    providers: {
      catalog: async () =>
        ids.map((id) => ({
          id,
          displayName: PROVIDER_FIXTURES[id].displayName,
          pluginId: PROVIDER_FIXTURES[id].pluginId,
          pluginName: PROVIDER_FIXTURES[id].pluginName,
          pluginEnabled: true,
          enabled: enabled.includes(id),
          available: true,
          logoUrl: null,
          info: null,
        })),
    },
    plugins: {
      getSettings: async ({ pluginId }: { pluginId: string }) => {
        const fixture = ids
          .map((id) => PROVIDER_FIXTURES[id])
          .find((entry) => entry.pluginId === pluginId);
        const schema: Record<
          string,
          { type: "boolean"; label: string; default: boolean }
        > = {};
        if (fixture?.memoryLabel) {
          schema.memoryEnabled = {
            type: "boolean",
            label: fixture.memoryLabel,
            default: true,
          };
        }
        return { ok: true as const, schema, values: {} };
      },
    },
  };
}
