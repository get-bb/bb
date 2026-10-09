// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

const app = await loadPluginApp(() => import("./app"));

afterEach(cleanup);

function agent(
  id: string,
  name: string,
  status: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    name,
    version: "1.0.0",
    description: `${name} description`,
    repository: null,
    website: null,
    authors: [],
    license: null,
    launch: {
      kind: "npx" as const,
      package: `${id}@1.0.0`,
      args: [],
      env: {},
    },
    binaryPlatforms: [],
    providerId: `acp-${id}`,
    status,
    command: `npx -y ${id}@1.0.0`,
    ...overrides,
  };
}

function registry(
  agents: unknown[],
  error: string | null = null,
): { fetchedAt: number; error: string | null; agents: unknown[] } {
  return { fetchedAt: 1, error, agents };
}

describe("ACP agent registry settings", () => {
  it("lists agents with the action each status allows and filters by search", async () => {
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        rpc: {
          listRegistry: () =>
            registry([
              agent("claude-acp", "Claude Agent", "available"),
              agent("gemini", "Gemini CLI", "added"),
              agent("goose", "Goose", "update-available"),
              agent("cursor", "Cursor", "built-in"),
              agent("native", "Native Only", "manual-install", {
                launch: null,
                command: null,
              }),
            ]),
        },
      },
    );
    await waitFor(() => expect(slot.getByText("Claude Agent")).toBeTruthy());

    expect(slot.getByRole("button", { name: "Add Claude Agent" })).toBeTruthy();
    expect(
      slot.getByRole("button", { name: "Remove Gemini CLI" }),
    ).toBeTruthy();
    expect(slot.queryByRole("button", { name: "Add Gemini CLI" })).toBeNull();
    expect(slot.getByRole("button", { name: "Update Goose" })).toBeTruthy();
    expect(slot.getByRole("button", { name: "Remove Goose" })).toBeTruthy();
    expect(slot.queryByRole("button", { name: /Cursor/ })).toBeNull();
    expect(slot.queryByRole("button", { name: /Native Only/ })).toBeNull();
    expect(slot.getByText("Runs npx -y claude-acp@1.0.0")).toBeTruthy();
    expect(
      slot.getByText("bb already ships this agent as a provider."),
    ).toBeTruthy();

    fireEvent.change(slot.getByLabelText("Search agents"), {
      target: { value: "goos" },
    });
    expect(slot.queryByText("Claude Agent")).toBeNull();
    expect(slot.getByText("Goose")).toBeTruthy();

    fireEvent.change(slot.getByLabelText("Search agents"), {
      target: { value: "zzz" },
    });
    expect(slot.getByText("No agent matches that search.")).toBeTruthy();
  });

  it("adds an agent and shows the server's new list, and shows the reason when a change fails", async () => {
    const addRegistryAgent = vi.fn((input: unknown) => {
      if (JSON.stringify(input) === JSON.stringify({ id: "goose" })) {
        throw new Error("The custom agents setting is not valid JSON.");
      }
      return registry([
        agent("claude-acp", "Claude Agent", "added"),
        agent("goose", "Goose", "available"),
      ]);
    });
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        rpc: {
          listRegistry: () =>
            registry([
              agent("claude-acp", "Claude Agent", "available"),
              agent("goose", "Goose", "available"),
            ]),
          addRegistryAgent,
        },
      },
    );
    await waitFor(() => expect(slot.getByText("Claude Agent")).toBeTruthy());

    fireEvent.click(slot.getByRole("button", { name: "Add Claude Agent" }));
    await waitFor(() =>
      expect(
        slot.getByRole("button", { name: "Remove Claude Agent" }),
      ).toBeTruthy(),
    );
    expect(addRegistryAgent.mock.calls[0]?.[0]).toEqual({ id: "claude-acp" });

    fireEvent.click(slot.getByRole("button", { name: "Add Goose" }));
    await waitFor(() =>
      expect(slot.getByRole("alert").textContent).toContain(
        "The custom agents setting is not valid JSON.",
      ),
    );
    expect(slot.getByRole("button", { name: "Add Goose" })).toBeTruthy();
  });

  it("says when it is showing a saved copy because the registry could not be reached", async () => {
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        rpc: {
          listRegistry: () =>
            registry(
              [agent("claude-acp", "Claude Agent", "available")],
              "The ACP registry answered 503.",
            ),
        },
      },
    );
    await waitFor(() =>
      expect(slot.getByRole("status").textContent).toBe(
        "Showing a saved copy. The registry could not be reached: The ACP registry answered 503.",
      ),
    );
  });
});
