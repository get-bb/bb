import { watch } from "node:fs";
import { readFile, realpath } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { Command } from "commander";
import { scaffoldPlugin } from "@bb/templates/plugin-scaffold";
import { action } from "../action.js";
import { buildPluginApp } from "@bb/plugin-build";
import { createPluginDevLoop } from "../plugin-dev-loop.js";
import { runPluginCliCommand } from "../plugin-cli-proxy.js";
import { resolveBbCliVersion } from "../version.js";
import { outputJson, type JsonOutputOptions } from "./helpers.js";

interface PluginEntry {
  id: string;
  source: string;
  rootDir: string;
  version: string;
  enabled: boolean;
  status: string;
  statusDetail: string | null;
  handlerStats: {
    count: number;
    totalMs: number;
    maxMs: number;
    errorCount: number;
  };
  services: Array<{ name: string; state: string }>;
  schedules: Array<{
    name: string;
    cron: string;
    nextRunAt: number;
    lastRunAt: number | null;
    lastStatus: string | null;
    lastError: string | null;
  }>;
  cliCommand: { name: string; summary: string } | null;
}

interface PluginListResponse {
  enabled: boolean;
  plugins: PluginEntry[];
}

interface PluginMutationResult {
  ok: boolean;
  error?: string;
  plugin?: PluginEntry;
  plugins?: PluginEntry[];
}

interface PluginSettingDescriptor {
  type: "string" | "boolean" | "select" | "project";
  label: string;
  description?: string;
  secret?: true;
  default?: string | boolean;
  options?: string[];
}

interface PluginSettingsResult {
  ok: boolean;
  error?: string;
  schema?: Record<string, PluginSettingDescriptor>;
  values?: Record<string, unknown>;
}

async function callPlugins<T>(
  baseUrl: string,
  path: string,
  method: "GET" | "POST" | "PUT" | "DELETE",
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${baseUrl}/api/v1/plugins${path}`, {
    method,
    ...(body === undefined
      ? {}
      : {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      `Unexpected response from /api/v1/plugins${path} (${response.status}): ${text.slice(0, 200)}`,
    );
  }
  // 400/404/422 carry structured { ok: false, error } (disabled experiment,
  // install/validation failures) — let them through so the caller can print
  // the reason.
  if (!response.ok && ![400, 404, 422].includes(response.status)) {
    throw new Error(`/api/v1/plugins${path} failed: HTTP ${response.status}`);
  }
  return parsed as T;
}

function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

function printPlugin(plugin: PluginEntry): void {
  const state = plugin.enabled ? plugin.status : "disabled";
  const detail = plugin.statusDetail ? `  (${plugin.statusDetail})` : "";
  console.log(`${plugin.id}@${plugin.version}  ${state}${detail}`);
  console.log(`  source: ${plugin.source}`);
  const stats = plugin.handlerStats;
  if (stats && stats.count > 0) {
    const errors = stats.errorCount > 0 ? `, ${stats.errorCount} errors` : "";
    console.log(
      `  handlers: ${stats.count} calls / ${formatMs(stats.totalMs)} total / ${formatMs(stats.maxMs)} max${errors}`,
    );
  }
  for (const service of plugin.services ?? []) {
    console.log(`  service ${service.name}: ${service.state}`);
  }
  for (const schedule of plugin.schedules ?? []) {
    const last = schedule.lastStatus ? `, last: ${schedule.lastStatus}` : "";
    const error = schedule.lastError ? ` (${schedule.lastError})` : "";
    console.log(
      `  schedule ${schedule.name} (${schedule.cron}): next ${new Date(schedule.nextRunAt).toISOString()}${last}${error}`,
    );
  }
  if (plugin.cliCommand) {
    console.log(
      `  command: bb ${plugin.cliCommand.name} — ${plugin.cliCommand.summary}`,
    );
  }
}

function exitWithError(result: { error?: string }): never {
  console.error(result.error ?? "Command failed");
  process.exit(1);
}

function printSettings(result: PluginSettingsResult): void {
  const schema = result.schema ?? {};
  const values = result.values ?? {};
  const keys = Object.keys(schema);
  if (keys.length === 0) {
    console.log("This plugin declares no settings.");
    return;
  }
  for (const key of keys) {
    const descriptor = schema[key];
    if (!descriptor) continue;
    const meta = [
      descriptor.type,
      ...(descriptor.secret ? ["secret"] : []),
      ...(descriptor.options ? [`options: ${descriptor.options.join("|")}`] : []),
    ].join(", ");
    let display: string;
    if (descriptor.secret) {
      const value = values[key] as { set?: boolean } | undefined;
      display = value?.set ? "[set]" : "[not set]";
    } else {
      const value = values[key];
      display = value === undefined ? "(unset)" : JSON.stringify(value);
    }
    console.log(`${key} = ${display}  (${meta})`);
    console.log(
      `  ${descriptor.label}${descriptor.description ? ` — ${descriptor.description}` : ""}`,
    );
  }
}

/** Parse a CLI string into the descriptor's value type, or exit with usage. */
function parseSettingValue(
  descriptor: PluginSettingDescriptor,
  key: string,
  raw: string,
): string | boolean {
  if (descriptor.type === "boolean") {
    if (raw === "true") return true;
    if (raw === "false") return false;
    console.error(`Setting "${key}" is a boolean — pass true or false.`);
    process.exit(1);
  }
  if (descriptor.type === "select" && !descriptor.options?.includes(raw)) {
    console.error(
      `Setting "${key}" must be one of: ${descriptor.options?.join(", ") ?? ""}`,
    );
    process.exit(1);
  }
  return raw;
}

export function registerPluginCommands(
  program: Command,
  getUrl: () => string,
): void {
  const plugin = program
    .command("plugin")
    .description("Manage BB plugins (experimental)")
    // Required (with the program's enablePositionalOptions) for `run` to
    // pass flags after <id> through to the plugin command untouched.
    .enablePositionalOptions();

  plugin
    .command("list")
    .description("List installed plugins and their status")
    .option("--json", "Output JSON")
    .action(
      action(async (opts: JsonOutputOptions) => {
        const result = await callPlugins<PluginListResponse>(
          getUrl(),
          "",
          "GET",
        );
        if (opts.json) {
          outputJson(opts, result);
          return;
        }
        if (!result.enabled) {
          console.log(
            'Plugins are disabled — enable the "Plugins" experiment in Settings → Experiments.',
          );
        }
        if (result.plugins.length === 0) {
          console.log("No plugins installed.");
          return;
        }
        for (const entry of result.plugins) {
          printPlugin(entry);
        }
      }),
    );

  plugin
    .command("install <source>")
    .description(
      "Install a plugin from a local path, git:<url>@<ref>, or npm:<name>@<version>",
    )
    .option("--yes", "Skip the confirmation prompt")
    .option("--json", "Output JSON")
    .action(
      action(
        async (
          source: string,
          opts: JsonOutputOptions & { yes?: boolean },
        ) => {
          let normalized: string;
          let summary: string;
          if (source.startsWith("git:") || source.startsWith("npm:")) {
            normalized = source;
            summary = `Installing ${source}`;
          } else {
            const path = resolve(
              source.startsWith("path:") ? source.slice(5) : source,
            );
            normalized = `path:${path}`;
            summary = `Installing ${path}`;
            // Best effort — a missing/invalid manifest is the server's
            // error to report after confirmation.
            try {
              const pkg = JSON.parse(
                await readFile(join(path, "package.json"), "utf8"),
              ) as { name?: unknown; version?: unknown };
              if (typeof pkg.name === "string") {
                summary = `Installing ${pkg.name}@${typeof pkg.version === "string" ? pkg.version : "?"} from ${path}`;
              }
            } catch {
              // fall through to the bare path summary
            }
          }
          console.log(summary);
          console.log(
            "Plugins are full-trust code running inside the BB server. " +
              "They can read all local BB data, including other plugins' secrets.",
          );
          if (!opts.yes) {
            if (!process.stdin.isTTY) {
              console.error(
                "Refusing to install without confirmation — re-run with --yes.",
              );
              process.exit(1);
            }
            const rl = createInterface({
              input: process.stdin,
              output: process.stdout,
            });
            const answer = (await rl.question("Install? [y/N] "))
              .trim()
              .toLowerCase();
            rl.close();
            if (answer !== "y" && answer !== "yes") {
              console.log("Aborted.");
              process.exit(1);
            }
          }
          const result = await callPlugins<PluginMutationResult>(
            getUrl(),
            "/install",
            "POST",
            { source: normalized },
          );
          if (opts.json) {
            outputJson(opts, result);
            if (!result.ok) process.exit(1);
            return;
          }
          if (!result.ok || !result.plugin) exitWithError(result);
          console.log("Installed:");
          printPlugin(result.plugin);
        },
      ),
    );

  plugin
    .command("new <name>")
    .description(
      "Scaffold a new plugin in ./bb-plugin-<name> (no server required)",
    )
    .option("--app", "Also scaffold a frontend entry (app.tsx, built by `bb plugin build`)")
    .action(
      action(async (name: string, opts: { app?: boolean }) => {
        const packageName = name.startsWith("bb-plugin-")
          ? name
          : `bb-plugin-${name}`;
        if (!/^bb-plugin-[a-z0-9][a-z0-9-]*$/.test(packageName)) {
          console.error(
            `Invalid plugin name "${name}" — use lowercase letters, digits, and dashes.`,
          );
          process.exit(1);
        }
        const targetDir = resolve(process.cwd(), packageName);
        await scaffoldPlugin({
          targetDir,
          packageName,
          bbVersion: resolveBbCliVersion(),
          app: opts.app ?? false,
        });
        console.log(`Created ${packageName}/`);
        console.log("Next steps:");
        console.log(`  cd ${packageName}`);
        console.log("  bb plugin install .");
      }),
    );

  plugin
    .command("build [path]")
    .description(
      "Compile the plugin's bb.app frontend entry into dist/ (app.js, app.css, app.meta.json; no server required)",
    )
    .action(
      action(async (path: string | undefined) => {
        const rootDir = resolve(process.cwd(), path ?? ".");
        const result = await buildPluginApp(rootDir);
        for (const file of [result.jsPath, result.cssPath, result.metaPath]) {
          console.log(relative(process.cwd(), file));
        }
      }),
    );

  plugin
    .command("dev [path]")
    .description(
      "Watch a plugin's sources: rebuild its frontend bundle (if it has one) and reload it on every change (Ctrl+C to stop)",
    )
    .action(
      action(async (path: string | undefined) => {
        const rootDir = resolve(process.cwd(), path ?? ".");
        let manifest: { bb?: { server?: unknown; app?: unknown } };
        try {
          manifest = JSON.parse(
            await readFile(join(rootDir, "package.json"), "utf8"),
          ) as { bb?: { server?: unknown; app?: unknown } };
        } catch {
          console.error(
            `No readable package.json in ${rootDir} — run from a plugin directory or pass its path.`,
          );
          process.exit(1);
        }
        if (typeof manifest.bb?.server !== "string") {
          console.error(
            `${rootDir} is not a bb plugin — package.json has no "bb.server" entry.`,
          );
          process.exit(1);
        }
        const hasApp = typeof manifest.bb.app === "string";
        // The dev loop drives an *installed* plugin; match this directory
        // against the server's installed rows (realpath tolerates symlinked
        // checkouts).
        const realDir = await realpath(rootDir).catch(() => rootDir);
        const list = await callPlugins<PluginListResponse>(getUrl(), "", "GET");
        if (!list.enabled) {
          console.error(
            'Plugins are disabled — enable the "Plugins" experiment in Settings → Experiments.',
          );
          process.exit(1);
        }
        const entry = list.plugins.find(
          (candidate) =>
            candidate.rootDir === rootDir || candidate.rootDir === realDir,
        );
        if (!entry) {
          console.error(
            `This directory is not installed as a plugin — run \`bb plugin install ${path ?? "."}\` first, then re-run \`bb plugin dev\`.`,
          );
          process.exit(1);
        }
        const loop = createPluginDevLoop({
          pluginId: entry.id,
          hasApp,
          buildApp: async () => {
            await buildPluginApp(rootDir);
          },
          reloadPlugin: async () => {
            const result = await callPlugins<PluginMutationResult>(
              getUrl(),
              `/reload?id=${encodeURIComponent(entry.id)}`,
              "POST",
            );
            if (!result.ok) throw new Error(result.error ?? "reload failed");
          },
          log: (line) => console.log(line),
        });
        // Node's recursive fs.watch covers macOS/Windows natively and Linux
        // since Node 20 — zero extra dependencies for the CLI.
        const watcher = watch(
          rootDir,
          { recursive: true },
          (_event, filename) => {
            if (typeof filename === "string" && filename.length > 0) {
              loop.handleChange(filename);
            }
          },
        );
        console.log(
          `Watching ${rootDir} for plugin "${entry.id}"${hasApp ? " (frontend rebuild + reload on change)" : " (reload on change)"} — Ctrl+C to stop.`,
        );
        await new Promise<void>((resolveDone) => {
          const stop = (): void => {
            watcher.close();
            loop.dispose();
            resolveDone();
          };
          process.once("SIGINT", stop);
          process.once("SIGTERM", stop);
        });
      }),
    );

  plugin
    .command("reload [id]")
    .description("Reload one plugin, or all plugins")
    .option("--json", "Output JSON")
    .action(
      action(async (id: string | undefined, opts: JsonOutputOptions) => {
        const query = id ? `?id=${encodeURIComponent(id)}` : "";
        const result = await callPlugins<PluginMutationResult>(
          getUrl(),
          `/reload${query}`,
          "POST",
        );
        if (opts.json) {
          outputJson(opts, result);
          if (!result.ok) process.exit(1);
          return;
        }
        if (!result.ok) exitWithError(result);
        for (const entry of result.plugins ?? []) {
          printPlugin(entry);
        }
      }),
    );

  for (const [name, description] of [
    ["enable", "Enable an installed plugin"],
    ["disable", "Disable an installed plugin (its code is unloaded)"],
  ] as const) {
    plugin
      .command(`${name} <id>`)
      .description(description)
      .option("--json", "Output JSON")
      .action(
        action(async (id: string, opts: JsonOutputOptions) => {
          const result = await callPlugins<PluginMutationResult>(
            getUrl(),
            `/${encodeURIComponent(id)}/${name}`,
            "POST",
          );
          if (opts.json) {
            outputJson(opts, result);
            if (!result.ok) process.exit(1);
            return;
          }
          if (!result.ok || !result.plugin) exitWithError(result);
          printPlugin(result.plugin);
        }),
      );
  }

  plugin
    .command("config <id> [action] [key] [value]")
    .description(
      "Show a plugin's settings, or change them: config <id> set <key> <value> | config <id> unset <key>",
    )
    .option("--json", "Output JSON")
    .action(
      action(
        async (
          id: string,
          actionName: string | undefined,
          key: string | undefined,
          value: string | undefined,
          opts: JsonOutputOptions,
        ) => {
          const settingsPath = `/${encodeURIComponent(id)}/settings`;
          if (actionName === undefined) {
            const result = await callPlugins<PluginSettingsResult>(
              getUrl(),
              settingsPath,
              "GET",
            );
            if (opts.json) {
              outputJson(opts, result);
              if (!result.ok) process.exit(1);
              return;
            }
            if (!result.ok) exitWithError(result);
            printSettings(result);
            return;
          }
          if (actionName !== "set" && actionName !== "unset") {
            console.error(
              `Unknown action "${actionName}" — use "set" or "unset".`,
            );
            process.exit(1);
          }
          if (key === undefined || (actionName === "set" && value === undefined)) {
            console.error(
              actionName === "set"
                ? "Usage: bb plugin config <id> set <key> <value>"
                : "Usage: bb plugin config <id> unset <key>",
            );
            process.exit(1);
          }
          let parsedValue: string | boolean | null = null;
          if (actionName === "set") {
            // Fetch the schema first so booleans/selects are parsed and
            // validated client-side with a friendly message.
            const current = await callPlugins<PluginSettingsResult>(
              getUrl(),
              settingsPath,
              "GET",
            );
            if (!current.ok || !current.schema) exitWithError(current);
            const descriptor = current.schema[key];
            if (!descriptor) {
              const known = Object.keys(current.schema).join(", ");
              console.error(
                `Unknown setting "${key}"${known ? ` — known settings: ${known}` : ""}`,
              );
              process.exit(1);
            }
            parsedValue = parseSettingValue(descriptor, key, value as string);
          }
          const result = await callPlugins<PluginSettingsResult>(
            getUrl(),
            settingsPath,
            "PUT",
            { values: { [key]: parsedValue } },
          );
          if (opts.json) {
            outputJson(opts, result);
            if (!result.ok) process.exit(1);
            return;
          }
          if (!result.ok) exitWithError(result);
          printSettings(result);
        },
      ),
    );

  plugin
    .command("token <id>")
    .description(
      'Print the plugin\'s HTTP token (for routes registered with auth: "token")',
    )
    .option("--rotate", "Generate a new token, invalidating the old one")
    .option("--json", "Output JSON")
    .action(
      action(
        async (id: string, opts: JsonOutputOptions & { rotate?: boolean }) => {
          const result = await callPlugins<{
            ok: boolean;
            error?: string;
            token?: string;
          }>(
            getUrl(),
            `/${encodeURIComponent(id)}/token`,
            "POST",
            opts.rotate ? { rotate: true } : {},
          );
          if (opts.json) {
            outputJson(opts, result);
            if (!result.ok) process.exit(1);
            return;
          }
          if (!result.ok || !result.token) exitWithError(result);
          console.log(result.token);
        },
      ),
    );

  plugin
    .command("run <id> [args...]")
    .description(
      "Run a plugin's CLI command (explicit form of `bb <command> ...`)",
    )
    // Flags after <id> belong to the plugin command; parsing is plugin-owned.
    .passThroughOptions()
    .allowUnknownOption()
    .helpOption(false)
    .action(
      action(async (id: string, args: string[]) => {
        process.exit(await runPluginCliCommand(getUrl(), id, args ?? []));
      }),
    );

  plugin
    .command("logs <id>")
    .description("Print a plugin's log (bb.log output)")
    .option("-n, --lines <count>", "Number of lines to show", "100")
    .option("-f, --follow", "Poll for new lines every second (Ctrl+C to stop)")
    .action(
      action(
        async (id: string, opts: { lines: string; follow?: boolean }) => {
          const requested = Number.parseInt(opts.lines, 10);
          const tail =
            Number.isFinite(requested) && requested > 0 ? requested : 100;
          const fetchTail = async (count: number): Promise<string[]> => {
            const result = await callPlugins<{
              ok: boolean;
              error?: string;
              lines?: string[];
            }>(getUrl(), `/${encodeURIComponent(id)}/logs?tail=${count}`, "GET");
            if (!result.ok || !result.lines) exitWithError(result);
            return result.lines;
          };
          let lines = await fetchTail(tail);
          for (const line of lines) console.log(line);
          if (!opts.follow) return;
          for (;;) {
            await sleep(1000);
            const next = await fetchTail(1000);
            // Print the suffix that extends what we already showed: find the
            // last line printed so far and emit everything after it. When it
            // is gone (rotation or a fresh file), print the whole tail.
            const lastPrinted = lines.at(-1);
            const startAfter =
              lastPrinted === undefined ? -1 : next.lastIndexOf(lastPrinted);
            for (const line of next.slice(startAfter + 1)) console.log(line);
            lines = next;
          }
        },
      ),
    );

  plugin
    .command("remove <id>")
    .description(
      "Remove an installed plugin (git:/npm: managed files are deleted; local path sources are left alone)",
    )
    .option("--json", "Output JSON")
    .action(
      action(async (id: string, opts: JsonOutputOptions) => {
        const result = await callPlugins<PluginMutationResult>(
          getUrl(),
          `/${encodeURIComponent(id)}`,
          "DELETE",
        );
        if (opts.json) {
          outputJson(opts, result);
          if (!result.ok) process.exit(1);
          return;
        }
        if (!result.ok) exitWithError(result);
        console.log(`Removed ${id}.`);
      }),
    );
}
