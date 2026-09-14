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

  it.each(entryPoints)(
    "preserves callbacks through the %s entry point",
    (entryPoint) => {
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
        threadId: "thread-1",
        projectId: "project-1",
        openPanel: vi.fn(() => true),
      };
      const command = collected.commandPaletteActions[0]!;
      expect(command.isAvailable?.(context)).toBe(true);
      command.run(context);
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
