import { Command } from "commander";
import {
  builtInThemes,
  defaultAppTheme,
  isBuiltInThemeId,
  type AppTheme,
} from "@bb/domain";
import { action } from "../action.js";
import { createCliBbSdk } from "../client.js";
import { outputJson, type JsonOutputOptions } from "./helpers.js";

interface ThemeShowCommandOptions extends JsonOutputOptions {
  css?: boolean;
}

function describeActive(theme: AppTheme): string {
  if (!isBuiltInThemeId(theme.themeId)) {
    const bytes = theme.customCss?.length ?? 0;
    return `Custom theme '${theme.themeId}' (${bytes} bytes)`;
  }
  const meta = builtInThemes.find((entry) => entry.id === theme.themeId);
  return meta ? `${meta.name} (${meta.id})` : theme.themeId;
}

export function registerThemeCommands(
  program: Command,
  getUrl: () => string,
): void {
  const theme = program
    .command("theme")
    .description("Manage the app color palette (built-in themes or custom CSS)");

  theme
    .command("list")
    .description("List built-in and custom themes and the active palette")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: JsonOutputOptions) => {
        const sdk = createCliBbSdk(getUrl());
        const catalog = await sdk.theme.catalog();
        if (
          outputJson(opts, {
            active: catalog.active,
            builtInThemes,
            custom: catalog.custom,
            dir: catalog.dir,
          })
        ) {
          return;
        }
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
        console.log(`Active: ${describeActive(catalog.active)}`);
      }),
    );

  theme
    .command("set <id>")
    .description(
      "Switch to a built-in theme or a custom theme by name " +
        "(a directory under the theme dir with a theme.css)",
    )
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string, opts: JsonOutputOptions) => {
        const sdk = createCliBbSdk(getUrl());
        const updated = await sdk.theme.set(id);
        if (outputJson(opts, updated)) return;
        console.log(`Theme set to ${describeActive(updated)}`);
      }),
    );

  theme
    .command("dir")
    .description("Print the directory where custom themes live")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: JsonOutputOptions) => {
        const sdk = createCliBbSdk(getUrl());
        const catalog = await sdk.theme.catalog();
        if (outputJson(opts, { dir: catalog.dir })) return;
        console.log(catalog.dir);
      }),
    );

  theme
    .command("show")
    .description("Show the active palette")
    .option("--css", "Print the active custom CSS (custom theme only)")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: ThemeShowCommandOptions) => {
        const sdk = createCliBbSdk(getUrl());
        const active = await sdk.theme.get();
        if (outputJson(opts, active)) return;
        if (opts.css) {
          if (active.customCss !== null) {
            console.log(active.customCss);
          } else {
            console.log(
              "// Built-in theme CSS is bundled in the app, not stored on disk.",
            );
          }
          return;
        }
        console.log(`Active: ${describeActive(active)}`);
      }),
    );

  theme
    .command("reset")
    .description("Reset to the Default theme")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: JsonOutputOptions) => {
        const sdk = createCliBbSdk(getUrl());
        const updated = await sdk.theme.set(defaultAppTheme.themeId);
        if (outputJson(opts, updated)) return;
        console.log(`Theme reset to ${describeActive(updated)}`);
      }),
    );
}
