import { makeActionContext, makePanelController } from "../testing/fixtures.js";
import { describe, expect, it, vi } from "vitest";
import type {
  PluginAppBuilder,
  PluginCommandRegistration,
} from "../app-contract.js";
import { collectPluginAppRegistrations } from "./plugin-app-collector.js";

const entryPoints = ["commands", "legacy"] as const;

function register(
  app: PluginAppBuilder,
  entryPoint: (typeof entryPoints)[number],
  command: PluginCommandRegistration,
) {
  if (entryPoint === "commands") app.commands.register(command);
  else app.slots.commandPaletteAction(command);
}

describe("app.commands.register", () => {
  it("normalizes shortcut modifiers and rejects unsafe or malformed defaults", () => {
    const collect = (
      defaultShortcut: PluginCommandRegistration["defaultShortcut"],
    ) =>
      collectPluginAppRegistrations({
        __bbPluginApp: true,
        setup(app) {
          app.commands.register({
            id: "open",
            title: "Open",
            defaultShortcut,
            run() {},
          });
        },
      });
    expect(
      collect({ key: "i", mod: true }).commandPaletteActions[0]
        ?.defaultShortcut,
    ).toEqual({
      key: "i",
      mod: true,
      meta: false,
      control: false,
      alt: false,
      shift: false,
    });
    expect(
      collect(undefined).commandPaletteActions[0]?.defaultShortcut,
    ).toBeNull();
    for (const keys of [
      { key: "i" },
      { key: "" },
      { key: "Shift", mod: true },
    ]) {
      expect(() => collect(keys)).toThrow();
    }
  });

  it("accepts a bare-key default only under the plugin page key scope", () => {
    const collect = (
      registration: Pick<
        PluginCommandRegistration,
        "defaultShortcut" | "experimental_keyScope"
      >,
    ) =>
      collectPluginAppRegistrations({
        __bbPluginApp: true,
        setup(app) {
          app.commands.register({
            id: "new-task",
            title: "New task",
            ...registration,
            run() {},
          });
        },
      }).commandPaletteActions[0];
    expect(
      collect({
        defaultShortcut: { key: "c" },
        experimental_keyScope: "pluginPage",
      }),
    ).toMatchObject({
      defaultShortcut: { key: "c", mod: false, alt: false, shift: false },
      experimental_keyScope: "pluginPage",
    });
    expect(
      collect({
        defaultShortcut: { key: "c", shift: true },
        experimental_keyScope: "pluginPage",
      })?.defaultShortcut,
    ).toMatchObject({ key: "c", shift: true });
    expect(
      collect({ defaultShortcut: { key: "k", mod: true } }),
    ).not.toHaveProperty("experimental_keyScope");
    expect(() => collect({ defaultShortcut: { key: "c" } })).toThrow(
      /experimental_keyScope: "pluginPage"/,
    );
    expect(() =>
      collect({ defaultShortcut: { key: "c", shift: true } }),
    ).toThrow(/experimental_keyScope/);
    expect(() =>
      collect({
        defaultShortcut: { key: "Shift" },
        experimental_keyScope: "pluginPage",
      }),
    ).toThrow();
    expect(() =>
      collect({
        defaultShortcut: { key: "c" },
        experimental_keyScope: "app" as "pluginPage",
      }),
    ).toThrow(/experimental_keyScope/);
  });

  it.each(entryPoints)(
    "preserves callbacks through the %s entry point",
    async (entryPoint) => {
      const run = vi.fn();
      const isAvailable = vi.fn(() => true);
      const collected = collectPluginAppRegistrations({
        __bbPluginApp: true,
        setup(app) {
          register(app, entryPoint, {
            id: "open-issue",
            title: "Open issue",
            run,
            isAvailable,
          });
        },
      });
      const context = {
        ...makeActionContext({
          panel: makePanelController({
            openTab: vi.fn(() => true),
            toggleTab: vi.fn(() => true),
            close: vi.fn(() => true),
          }),
        }),
        threadId: "thread-1",
        projectId: "project-1",
      };
      const command = collected.commandPaletteActions[0]!;
      if (command.target !== "app") throw new Error("expected an app command");
      expect(command.isAvailable?.(context)).toBe(true);
      await command.run(context);
      expect(isAvailable).toHaveBeenCalledWith(context);
      expect(run).toHaveBeenCalledWith(context);
      expect(collected.commandPaletteActions).toHaveLength(1);
    },
  );

  it.each(
    entryPoints.flatMap((first) =>
      entryPoints.map((second) => [first, second] as const),
    ),
  )("rejects duplicate IDs registered through %s then %s", (first, second) => {
    expect(() =>
      collectPluginAppRegistrations({
        __bbPluginApp: true,
        setup(app) {
          const command = {
            id: "open-issue",
            title: "Open issue",
            run: vi.fn(),
          };
          register(app, first, command);
          register(app, second, command);
        },
      }),
    ).toThrow(/duplicate/i);
  });

  it("collects composer commands in the shared command namespace", () => {
    const run = vi.fn();
    const collected = collectPluginAppRegistrations({
      __bbPluginApp: true,
      setup(app) {
        app.composer.experimental_registerCommand({
          id: "search",
          title: "Search prompts",
          defaultShortcut: { key: "r", control: true },
          run,
        });
      },
    });
    expect(collected.commandPaletteActions).toEqual([
      {
        target: "composer",
        id: "search",
        title: "Search prompts",
        defaultShortcut: {
          key: "r",
          mod: false,
          meta: false,
          control: true,
          alt: false,
          shift: false,
        },
        run,
      },
    ]);
    expect(() =>
      collectPluginAppRegistrations({
        __bbPluginApp: true,
        setup(app) {
          app.commands.register({ id: "search", title: "Search", run() {} });
          app.composer.experimental_registerCommand({
            id: "search",
            title: "Search prompts",
            run() {},
          });
        },
      }),
    ).toThrow(/duplicate/i);
  });

  it("keeps a composer command's scopes and isAvailable and rejects invalid ones", () => {
    const isAvailable = vi.fn(() => true);
    const run = vi.fn();
    const collected = collectPluginAppRegistrations({
      __bbPluginApp: true,
      setup(app) {
        app.composer.experimental_registerCommand({
          id: "toggle",
          title: "Toggle widget",
          scopes: ["thread", "queued-message"],
          isAvailable,
          run,
        });
      },
    });
    expect(collected.commandPaletteActions).toEqual([
      {
        target: "composer",
        id: "toggle",
        title: "Toggle widget",
        defaultShortcut: null,
        scopes: ["thread", "queued-message"],
        isAvailable,
        run,
      },
    ]);
    for (const invalid of [
      { scopes: ["side-panel"] },
      { scopes: "thread" },
      { isAvailable: true },
    ]) {
      expect(() =>
        collectPluginAppRegistrations({
          __bbPluginApp: true,
          setup(app) {
            app.composer.experimental_registerCommand({
              id: "toggle",
              title: "Toggle widget",
              run,
              ...(invalid as object),
            });
          },
        }),
      ).toThrow(/composer\.experimental_registerCommand/);
    }
  });

  it.each(entryPoints)(
    "validates IDs and titles through the %s entry point",
    (entryPoint) => {
      for (const command of [
        { id: "invalid/id", title: "Open issue", run: vi.fn() },
        { id: "open-issue", title: "", run: vi.fn() },
      ]) {
        expect(() =>
          collectPluginAppRegistrations({
            __bbPluginApp: true,
            setup: (app) => register(app, entryPoint, command),
          }),
        ).toThrow();
      }
    },
  );
});
