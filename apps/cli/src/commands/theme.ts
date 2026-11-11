import type { Command } from "commander";
import {
  builtInThemes,
  defaultAppTheme,
  defaultFaviconColor,
  faviconColorPreferenceSchema,
  FAVICON_COLORS,
  isBuiltInThemeId,
  type AppTheme,
  type FaviconColorPreference,
} from "@bb/domain";
import { arg, flag } from "../cli-door.js";
import {
  clientCommand,
  mountCommands,
  publicCommand,
  type CliClient,
} from "../operation-doors.js";

async function activeTheme(client: CliClient): Promise<AppTheme> {
  return (await client.call("system.config", {})).appearance;
}

function parseFaviconColor(value: string): FaviconColorPreference {
  const parsed = faviconColorPreferenceSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `Invalid favicon color '${value}'. Expected one of: default, ${FAVICON_COLORS.join(
        ", ",
      )}.`,
    );
  }
  return parsed.data;
}

function describeTheme(theme: AppTheme): string {
  if (!isBuiltInThemeId(theme.themeId)) {
    const bytes = theme.customCss?.length ?? 0;
    return `Custom theme '${theme.themeId}' (${bytes} bytes)`;
  }
  const meta = builtInThemes.find((entry) => entry.id === theme.themeId);
  return meta ? `${meta.name} (${meta.id})` : theme.themeId;
}

function describeCodeTheme(theme: AppTheme): string {
  const { dark, light } = theme.resolvedCodeTheme;
  return dark === light ? dark : `${dark} / ${light}`;
}

export const themeCommands = [
  publicCommand("system.themes", {
    path: ["theme", "list"],
    summary: "List built-in and custom themes and the active palette",
    json: (catalog) => ({
      active: catalog.active,
      builtInThemes,
      custom: catalog.custom,
      plugins: catalog.plugins,
      dir: catalog.dir,
    }),
    print(catalog) {
      const active = catalog.active.themeId;
      console.log("");
      console.log("Built-in:");
      for (const entry of builtInThemes) {
        const marker = active === entry.id ? "*" : " ";
        console.log(`${marker} ${entry.id.padEnd(12)} ${entry.description}`);
      }
      console.log("");
      console.log(`Custom (${catalog.dir}):`);
      if (catalog.custom.length === 0) {
        console.log(`  (none — create <name>/theme.css under that directory)`);
      } else {
        for (const name of catalog.custom) {
          const marker = active === name ? "*" : " ";
          console.log(`${marker} ${name}`);
        }
      }
      console.log("");
      console.log("Plugins:");
      if (catalog.plugins.length === 0) console.log("  (none)");
      for (const entry of catalog.plugins) {
        const marker = active === entry.id ? "*" : " ";
        console.log(`${marker} ${entry.id.padEnd(24)} ${entry.name}`);
      }
      console.log("");
      console.log(`Active: ${describeTheme(catalog.active)}`);
      console.log(`Favicon color: ${catalog.active.faviconColor}`);
      console.log(`Code theme: ${describeCodeTheme(catalog.active)}`);
      return null;
    },
  }),
  publicCommand("system.appearance", {
    path: ["theme", "set"],
    summary: "Switch to a built-in, custom, or plugin-contributed theme by id",
    positionals: { id: arg("<id>") },
    options: {
      faviconColor: flag(
        "--favicon-color <color>",
        "Set the favicon color in the same appearance update",
      ),
    },
    async prepare({ positionals, options }, client) {
      const themeId = positionals.id;
      if (options.faviconColor !== undefined) {
        return {
          themeId,
          faviconColor: parseFaviconColor(options.faviconColor),
        };
      }
      return {
        themeId,
        faviconColor: (await activeTheme(client)).faviconColor,
      };
    },
    print: (updated) => `Theme set to ${describeTheme(updated)}`,
  }),
  publicCommand("system.themes", {
    path: ["theme", "dir"],
    summary: "Print the directory where custom themes live",
    json: (catalog) => ({ dir: catalog.dir }),
    print: (catalog) => catalog.dir,
  }),
  publicCommand("system.appearance", {
    path: ["theme", "favicon", "set"],
    summary: `Set the favicon color (${FAVICON_COLORS.join(", ")}, or default)`,
    positionals: { color: arg("<color>") },
    async prepare({ positionals }, client) {
      const faviconColor = parseFaviconColor(positionals.color);
      return { themeId: (await activeTheme(client)).themeId, faviconColor };
    },
    print: (updated) => `Favicon color set to ${updated.faviconColor}`,
  }),
  publicCommand("system.appearance", {
    path: ["theme", "favicon", "reset"],
    summary: "Reset the favicon color without changing the theme",
    async prepare(_values, client) {
      return {
        themeId: (await activeTheme(client)).themeId,
        faviconColor: defaultFaviconColor,
      };
    },
    print: (updated) => `Favicon color reset to ${updated.faviconColor}`,
  }),
  clientCommand({
    path: ["theme", "show"],
    summary:
      "Show the active theme, or resolve a theme by id without activating it",
    positionals: { id: arg("[id]") },
    options: {
      css: flag(
        "--css",
        "Print the theme's CSS (custom and plugin themes only)",
      ),
    },
    run: ({ positionals: { id } }, client) =>
      id === undefined
        ? activeTheme(client)
        : client.call("system.resolveTheme", { id }),
    print(theme, { positionals: { id }, options: { css } }) {
      if (css) {
        return theme.customCss !== null
          ? theme.customCss
          : "// Built-in theme CSS is bundled in the app, not stored on disk.";
      }
      if (id === undefined) {
        console.log(`Active: ${describeTheme(theme)}`);
        console.log(`Favicon color: ${theme.faviconColor}`);
      } else {
        console.log(`Theme: ${describeTheme(theme)}`);
      }
      console.log(`Code theme: ${describeCodeTheme(theme)}`);
      return null;
    },
  }),
  publicCommand("system.appearance", {
    path: ["theme", "reset"],
    summary: "Reset to the Default theme",
    async prepare(_values, client) {
      return {
        themeId: defaultAppTheme.themeId,
        faviconColor: (await activeTheme(client)).faviconColor,
      };
    },
    print: (updated) => `Theme reset to ${describeTheme(updated)}`,
  }),
];

export function registerThemeCommands(
  program: Command,
  getUrl: () => string,
): void {
  const deps = { getUrl };
  const theme = program
    .command("theme")
    .description("Manage the app theme and favicon color");
  mountCommands(program, themeCommands.slice(0, 3), deps);
  theme
    .command("favicon")
    .description("Manage the app favicon color without changing the theme");
  mountCommands(program, themeCommands.slice(3), deps);
}
