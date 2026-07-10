import { describe, expect, it } from "vitest";
import { getAppKeybindingOverrides } from "@bb/db";
import { appKeybindingOverridesSchema } from "@bb/domain";
import { systemConfigResponseSchema } from "@bb/server-contract";
import { readJson } from "../helpers/json.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("app keybindings", () => {
  it("serves validated explicit defaults from system config", async () => {
    await withTestHarness(async (harness) => {
      const response = await harness.app.request("/api/v1/system/config");
      expect(response.status).toBe(200);
      const config = systemConfigResponseSchema.parse(await readJson(response));
      expect(config.keybindingOverrides).toEqual([]);
      expect(config.defaultKeybindings).toEqual(config.keybindings);
      expect(
        config.keybindings.find((binding) => binding.command === "thread.new"),
      ).toMatchObject({
        desktopOnly: false,
        shortcut: { key: "n", mod: true, shift: false },
        when: { all: ["mainSurface"], none: ["modalOpen"] },
      });
      expect(
        config.keybindings.find((binding) => binding.command === "window.new"),
      ).toMatchObject({
        desktopOnly: true,
        shortcut: { key: "n", mod: true, shift: true },
      });
      expect(
        config.defaultKeybindings
          .filter((binding) => binding.desktopOnly)
          .map((binding) => binding.command),
      ).toEqual([
        "browser.focusLocation",
        "browser.reload",
        "window.new",
      ]);
    });
  });

  it("persists command overrides and resolves every scoped binding", async () => {
    await withTestHarness(async (harness) => {
      const shortcut = {
        key: "u",
        mod: true,
        meta: false,
        control: false,
        alt: false,
        shift: true,
      };
      const overrides = [
        { command: "thread.new" as const, shortcut },
        { command: "modelPicker.toggle" as const, shortcut },
      ];
      const response = await harness.app.request("/api/v1/settings/keyboard", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(overrides),
      });
      expect(response.status).toBe(200);
      expect(
        appKeybindingOverridesSchema.parse(await readJson(response)),
      ).toEqual(overrides);
      expect(getAppKeybindingOverrides(harness.db)).toEqual(overrides);

      const configResponse = await harness.app.request("/api/v1/system/config");
      const config = systemConfigResponseSchema.parse(
        await readJson(configResponse),
      );
      expect(config.keybindingOverrides).toEqual(overrides);
      expect(
        config.keybindings.find((binding) => binding.command === "thread.new"),
      ).toMatchObject({ shortcut });
      expect(
        config.keybindings.filter(
          (binding) => binding.command === "modelPicker.toggle",
        ),
      ).toHaveLength(2);
      expect(
        config.keybindings
          .filter((binding) => binding.command === "modelPicker.toggle")
          .every((binding) => binding.shortcut.key === "u"),
      ).toBe(true);
    });
  });

  it("uses null overrides to disable a command", async () => {
    await withTestHarness(async (harness) => {
      const response = await harness.app.request("/api/v1/settings/keyboard", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify([{ command: "panel.newTab", shortcut: null }]),
      });
      expect(response.status).toBe(200);

      const configResponse = await harness.app.request("/api/v1/system/config");
      const config = systemConfigResponseSchema.parse(
        await readJson(configResponse),
      );
      expect(
        config.keybindings.some(
          (binding) => binding.command === "panel.newTab",
        ),
      ).toBe(false);
      expect(
        config.defaultKeybindings.some(
          (binding) => binding.command === "panel.newTab",
        ),
      ).toBe(true);
    });
  });

  it("rejects duplicate command overrides", async () => {
    await withTestHarness(async (harness) => {
      const shortcut = {
        key: "n",
        mod: true,
        meta: false,
        control: false,
        alt: false,
        shift: false,
      };
      const response = await harness.app.request("/api/v1/settings/keyboard", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify([
          { command: "thread.new", shortcut },
          { command: "thread.new", shortcut },
        ]),
      });
      expect(response.status).toBe(400);
    });
  });

  it("falls back to defaults when stored overrides are corrupt", async () => {
    await withTestHarness(async (harness) => {
      harness.db.$client
        .prepare(
          "INSERT INTO app_settings (id, caffeinate, keybinding_overrides, updated_at) VALUES (?, ?, ?, ?)",
        )
        .run("current", 0, "not-json", Date.now());

      const response = await harness.app.request("/api/v1/system/config");
      expect(response.status).toBe(200);
      const config = systemConfigResponseSchema.parse(await readJson(response));
      expect(config.keybindingOverrides).toEqual([]);
      expect(config.keybindings).toEqual(config.defaultKeybindings);
    });
  });
});
