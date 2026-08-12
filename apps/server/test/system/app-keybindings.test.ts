import { describe, expect, it } from "vitest";
import { getAppKeybindingOverrides } from "@bb/db";
import {
  PANE_FOCUS_APP_COMMAND_IDS,
  THREAD_JUMP_APP_COMMAND_IDS,
  applyAppKeybindingOverrides,
  appKeybindingOverridesSchema,
} from "@bb/domain";
import { systemConfigResponseSchema } from "@bb/server-contract";
import { readJson } from "../helpers/json.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("app keybindings", () => {
  it("serves validated explicit defaults from system config", async () => {
    await withTestHarness(async (harness) => {
      const response = await harness.app.request("/api/v1/system/config");
      expect(response.status).toBe(200);
      const config = systemConfigResponseSchema.parse(await readJson(response));
      const assignedDefaultKeybindings = applyAppKeybindingOverrides(
        config.defaultKeybindings,
        [],
      );
      expect(config.keybindingOverrides).toEqual([]);
      expect(assignedDefaultKeybindings).toEqual(config.keybindings);
      for (const command of ["thread.rename", "thread.archive"] as const) {
        expect(
          config.defaultKeybindings.find(
            (binding) => binding.command === command,
          ),
        ).toMatchObject({
          desktopOnly: false,
          shortcut: null,
          when: { all: ["mainSurface"], none: ["modalOpen"] },
        });
        expect(
          config.keybindings.some((binding) => binding.command === command),
        ).toBe(false);
      }
      expect(
        config.keybindings
          .filter((binding) => binding.command === "thread.new")
          .map((binding) => ({
            desktopOnly: binding.desktopOnly,
            key: binding.shortcut.key,
            shift: binding.shortcut.shift,
          })),
      ).toEqual([
        { desktopOnly: false, key: "o", shift: true },
        { desktopOnly: true, key: "n", shift: false },
      ]);
      expect(
        config.keybindings.find((binding) => binding.command === "window.new"),
      ).toMatchObject({
        desktopOnly: true,
        shortcut: { key: "n", mod: true, shift: true },
      });
      expect(
        assignedDefaultKeybindings
          .filter((binding) => binding.command === "thread.previous")
          .map((binding) => ({
            desktopOnly: binding.desktopOnly,
            key: binding.shortcut.key,
          })),
      ).toEqual([
        { desktopOnly: false, key: "ArrowUp" },
        { desktopOnly: true, key: "[" },
      ]);
      expect(
        assignedDefaultKeybindings
          .filter((binding) => binding.command === "thread.next")
          .map((binding) => ({
            desktopOnly: binding.desktopOnly,
            key: binding.shortcut.key,
          })),
      ).toEqual([
        { desktopOnly: false, key: "ArrowDown" },
        { desktopOnly: true, key: "]" },
      ]);
      expect(
        assignedDefaultKeybindings
          .filter((binding) => binding.command.startsWith("thread.jump."))
          .map((binding) => ({
            command: binding.command,
            desktopOnly: binding.desktopOnly,
            key: binding.shortcut.key,
            mod: binding.shortcut.mod,
            control: binding.shortcut.control,
            shift: binding.shortcut.shift,
            when: binding.when,
          })),
      ).toEqual(
        THREAD_JUMP_APP_COMMAND_IDS.flatMap((command, index) => [
          {
            command,
            desktopOnly: false,
            key: String(index + 1),
            mod: false,
            control: true,
            shift: false,
            when: {
              all: ["mainSurface", "webSurface", "macPlatform"],
              none: ["modalOpen"],
            },
          },
          {
            command,
            desktopOnly: false,
            key: String(index + 1),
            mod: true,
            control: false,
            shift: true,
            when: {
              all: ["mainSurface", "webSurface"],
              none: ["modalOpen", "macPlatform"],
            },
          },
          {
            command,
            desktopOnly: true,
            key: String(index + 1),
            mod: true,
            control: false,
            shift: false,
            when: {
              all: ["mainSurface"],
              none: ["modalOpen"],
            },
          },
        ]),
      );
      expect(
        assignedDefaultKeybindings
          .filter((binding) => binding.command === "terminal.open")
          .map((binding) => ({
            desktopOnly: binding.desktopOnly,
            key: binding.shortcut.key,
          })),
      ).toEqual([
        { desktopOnly: false, key: "Enter" },
        { desktopOnly: true, key: "t" },
      ]);
      expect(
        assignedDefaultKeybindings.find(
          (binding) => binding.command === "composer.focus",
        ),
      ).toMatchObject({
        desktopOnly: false,
        shortcut: { key: "c", mod: true, shift: true },
        when: {
          all: ["mainSurface", "promptAvailable"],
          none: ["modalOpen", "terminalFocus", "browserFocus"],
        },
      });
      // The cycle chords must stay on plain Alt and share the scope of
      // `modelPicker.toggle`. Alt is unused elsewhere in bb, so nothing shadows
      // them and they shadow nothing.
      expect(
        assignedDefaultKeybindings
          .filter((binding) => binding.command.startsWith("modelPicker.cycle"))
          .map((binding) => ({
            command: binding.command,
            shortcut: binding.shortcut,
            when: binding.when,
          })),
      ).toEqual([
        {
          command: "modelPicker.cycleModel",
          shortcut: {
            key: "m",
            mod: false,
            meta: false,
            control: false,
            alt: true,
            shift: false,
          },
          when: {
            all: ["mainSurface", "promptAvailable"],
            none: ["modalOpen", "terminalFocus", "browserFocus"],
          },
        },
        {
          command: "modelPicker.cycleReasoning",
          shortcut: {
            key: "t",
            mod: false,
            meta: false,
            control: false,
            alt: true,
            shift: false,
          },
          when: {
            all: ["mainSurface", "promptAvailable"],
            none: ["modalOpen", "terminalFocus", "browserFocus"],
          },
        },
        // The picker popover is modal, so a second scoped copy of each chord
        // keeps cycling alive while it is open.
        {
          command: "modelPicker.cycleModel",
          shortcut: {
            key: "m",
            mod: false,
            meta: false,
            control: false,
            alt: true,
            shift: false,
          },
          when: { all: ["mainSurface", "modelPickerOpen"], none: [] },
        },
        {
          command: "modelPicker.cycleReasoning",
          shortcut: {
            key: "t",
            mod: false,
            meta: false,
            control: false,
            alt: true,
            shift: false,
          },
          when: { all: ["mainSurface", "modelPickerOpen"], none: [] },
        },
      ]);
      // No other default binding may use Alt, so the cycle chords cannot be
      // shadowed by an earlier binding for the same chord.
      expect(
        assignedDefaultKeybindings
          .filter((binding) => binding.shortcut.alt)
          .map((binding) => binding.command),
      ).toEqual([
        "modelPicker.cycleModel",
        "modelPicker.cycleReasoning",
        "modelPicker.cycleModel",
        "modelPicker.cycleReasoning",
      ]);
      expect(
        assignedDefaultKeybindings
          .filter((binding) => binding.command.startsWith("pane."))
          .map((binding) => ({
            command: binding.command,
            desktopOnly: binding.desktopOnly,
            key: binding.shortcut.key,
            mod: binding.shortcut.mod,
            control: binding.shortcut.control,
            shift: binding.shortcut.shift,
            when: binding.when,
          })),
      ).toEqual([
        {
          command: "pane.focus.previous",
          desktopOnly: false,
          key: "[",
          mod: true,
          control: false,
          shift: true,
          when: { all: ["mainSurface", "splitActive"], none: ["modalOpen"] },
        },
        {
          command: "pane.focus.next",
          desktopOnly: false,
          key: "]",
          mod: true,
          control: false,
          shift: true,
          when: { all: ["mainSurface", "splitActive"], none: ["modalOpen"] },
        },
        ...PANE_FOCUS_APP_COMMAND_IDS.flatMap((command, index) => [
          {
            command,
            desktopOnly: false,
            key: String(index + 1),
            mod: false,
            control: true,
            shift: false,
            when: {
              all: ["mainSurface", "splitActive", "webSurface", "macPlatform"],
              none: ["modalOpen"],
            },
          },
          {
            command,
            desktopOnly: false,
            key: String(index + 1),
            mod: true,
            control: false,
            shift: true,
            when: {
              all: ["mainSurface", "splitActive", "webSurface"],
              none: ["modalOpen", "macPlatform"],
            },
          },
          {
            command,
            desktopOnly: true,
            key: String(index + 1),
            mod: true,
            control: false,
            shift: false,
            when: {
              all: ["mainSurface", "splitActive"],
              none: ["modalOpen"],
            },
          },
        ]),
        {
          command: "pane.maximize.toggle",
          desktopOnly: false,
          key: "e",
          mod: true,
          control: false,
          shift: true,
          when: { all: ["mainSurface", "splitActive"], none: ["modalOpen"] },
        },
        {
          command: "pane.close",
          desktopOnly: false,
          key: "x",
          mod: true,
          control: false,
          shift: true,
          when: { all: ["mainSurface", "splitActive"], none: ["modalOpen"] },
        },
      ]);
      expect(
        assignedDefaultKeybindings
          .filter((binding) => binding.desktopOnly)
          .map((binding) => binding.command),
      ).toEqual([
        "thread.new",
        "thread.previous",
        "thread.next",
        ...THREAD_JUMP_APP_COMMAND_IDS,
        ...PANE_FOCUS_APP_COMMAND_IDS,
        "terminal.open",
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

  it("activates an assignable command without a default shortcut", async () => {
    await withTestHarness(async (harness) => {
      const shortcut = {
        key: "r",
        mod: true,
        meta: false,
        control: false,
        alt: false,
        shift: true,
      };
      const response = await harness.app.request("/api/v1/settings/keyboard", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify([{ command: "thread.rename", shortcut }]),
      });
      expect(response.status).toBe(200);

      const configResponse = await harness.app.request("/api/v1/system/config");
      const config = systemConfigResponseSchema.parse(
        await readJson(configResponse),
      );
      expect(
        config.keybindings.filter(
          (binding) => binding.command === "thread.rename",
        ),
      ).toEqual([
        {
          command: "thread.rename",
          desktopOnly: false,
          shortcut,
          when: { all: ["mainSurface"], none: ["modalOpen"] },
        },
      ]);
    });
  });

  it("activates the archive command after assigning a shortcut", async () => {
    await withTestHarness(async (harness) => {
      const shortcut = {
        key: "a",
        mod: true,
        meta: false,
        control: false,
        alt: false,
        shift: true,
      };
      const response = await harness.app.request("/api/v1/settings/keyboard", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify([{ command: "thread.archive", shortcut }]),
      });
      expect(response.status).toBe(200);

      const configResponse = await harness.app.request("/api/v1/system/config");
      const config = systemConfigResponseSchema.parse(
        await readJson(configResponse),
      );
      expect(
        config.keybindings.filter(
          (binding) => binding.command === "thread.archive",
        ),
      ).toEqual([
        {
          command: "thread.archive",
          desktopOnly: false,
          shortcut,
          when: { all: ["mainSurface"], none: ["modalOpen"] },
        },
      ]);
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
      expect(config.keybindings).toEqual(
        applyAppKeybindingOverrides(config.defaultKeybindings, []),
      );
    });
  });
});
