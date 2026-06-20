import { readFile } from "node:fs/promises";
import { Command } from "commander";
import {
  BUILTIN_THEME_IDS,
  builtInThemes,
  defaultAppTheme,
  type AppTheme,
  type AppThemeId,
} from "@bb/domain";
import { action } from "../action.js";
import { createCliBbSdk } from "../client.js";
import { outputJson, type JsonOutputOptions } from "./helpers.js";

interface ThemeSetCustomCommandOptions extends JsonOutputOptions {
  file: string;
}

interface ThemeShowCommandOptions extends JsonOutputOptions {
  css?: boolean;
}

function describeActive(theme: AppTheme): string {
  if (theme.themeId === "custom") {
    const bytes = theme.customCss?.length ?? 0;
    return `Custom stylesheet (${bytes} bytes)`;
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
    .description("List built-in themes and the active palette")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: JsonOutputOptions) => {
        const sdk = createCliBbSdk(getUrl());
        const active = await sdk.theme.get();
        if (
          outputJson(opts, {
            active,
            builtInThemes,
            customLoaded: active.customCss !== null,
          })
        ) {
          return;
        }
        console.log("");
        for (const entry of builtInThemes) {
          const marker = active.themeId === entry.id ? "*" : " ";
          console.log(`${marker} ${entry.id.padEnd(10)} ${entry.description}`);
        }
        const customMarker = active.themeId === "custom" ? "*" : " ";
        const customState =
          active.customCss !== null ? "loaded" : "not set — use set-custom";
        console.log(`${customMarker} ${"custom".padEnd(10)} ${customState}`);
        console.log("");
        console.log(`Active: ${describeActive(active)}`);
      }),
    );

  theme
    .command("set <id>")
    .description(`Switch to a built-in theme (${BUILTIN_THEME_IDS.join(", ")})`)
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string, opts: JsonOutputOptions) => {
        if (!(BUILTIN_THEME_IDS as readonly string[]).includes(id)) {
          throw new Error(
            `Unknown theme '${id}'. Expected one of: ${BUILTIN_THEME_IDS.join(", ")}.`,
          );
        }
        const sdk = createCliBbSdk(getUrl());
        // Preserve any previously loaded custom CSS so it can be re-selected.
        const current = await sdk.theme.get();
        const updated = await sdk.theme.set({
          themeId: id as AppThemeId,
          customCss: current.customCss,
        });
        if (outputJson(opts, updated)) return;
        console.log(`Theme set to ${describeActive(updated)}`);
      }),
    );

  theme
    .command("set-custom")
    .description("Load a custom stylesheet from a file and activate it")
    .requiredOption("--file <path>", "Path to a CSS file")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: ThemeSetCustomCommandOptions) => {
        const customCss = await readFile(opts.file, "utf8");
        const sdk = createCliBbSdk(getUrl());
        const updated = await sdk.theme.set({ themeId: "custom", customCss });
        if (outputJson(opts, updated)) return;
        console.log(
          `Custom stylesheet loaded (${customCss.length} bytes) and activated`,
        );
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
          if (active.themeId === "custom" && active.customCss !== null) {
            console.log(active.customCss);
          } else {
            console.log(
              "// Built-in theme CSS is bundled in the app, not stored server-side.",
            );
          }
          return;
        }
        console.log(`Active: ${describeActive(active)}`);
      }),
    );

  theme
    .command("reset")
    .description("Reset to the Default theme and clear any custom stylesheet")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: JsonOutputOptions) => {
        const sdk = createCliBbSdk(getUrl());
        const updated = await sdk.theme.set(defaultAppTheme);
        if (outputJson(opts, updated)) return;
        console.log(`Theme reset to ${describeActive(updated)}`);
      }),
    );
}
