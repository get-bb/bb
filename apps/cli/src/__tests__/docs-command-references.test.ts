import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { describe, expect, it } from "vitest";
import {
  CORE_COMMAND_GROUPS,
  type CommandGroupDeps,
} from "../command-groups.js";
import { TOP_LEVEL_SOFT_ALIASES } from "../command-resolution.js";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

const SCANNED_ROOTS: readonly { dir: string; extensions: readonly string[] }[] =
  [
    { dir: "apps/web/content/docs", extensions: [".md", ".mdx"] },
    { dir: "apps/web/src/guides", extensions: [".ts", ".tsx"] },
    { dir: "packages/templates/src/templates", extensions: [".md"] },
    { dir: ".bb/skills", extensions: [".md", ".mdx"] },
    { dir: "plugins", extensions: [".md"] },
  ];

const SKIPPED_DIRS = new Set(["node_modules", "dist", ".turbo"]);
const GLOBAL_FLAGS = new Set(["--help", "--version"]);
const WORD = /^[a-z][a-z0-9-]*$/u;
const NON_COMMAND_NAMES = new Set(["cloud", "hello", "weather"]);

interface CommandNode {
  children: Map<string, CommandNode>;
  flags: Set<string>;
}

interface Reference {
  file: string;
  text: string;
}

function commandNode(command: Command): CommandNode {
  const children = new Map<string, CommandNode>();
  for (const child of command.commands) {
    const node = commandNode(child);
    for (const name of [child.name(), ...child.aliases()]) {
      children.set(name, node);
    }
  }
  const flags = new Set<string>();
  for (const option of command.options) {
    if (option.long) flags.add(option.long);
    if (option.long?.startsWith("--no-")) {
      flags.add(`--${option.long.slice(5)}`);
    } else if (option.long && option.negate === false) {
      flags.add(`--no-${option.long.slice(2)}`);
    }
  }
  return { children, flags };
}

async function coreCommandTree(): Promise<CommandNode> {
  const program = new Command();
  const deps: CommandGroupDeps = {
    getUrl: () => "http://localhost",
    getContext: () => ({ serverUrl: "http://localhost" }),
  };
  for (const group of CORE_COMMAND_GROUPS) {
    const register = await group.load();
    register(program, deps);
  }
  const root = commandNode(program);
  for (const [alias, target] of Object.entries(TOP_LEVEL_SOFT_ALIASES)) {
    const node = root.children.get(target);
    if (node) root.children.set(alias, node);
  }
  return root;
}

function walkFiles(dir: string, extensions: readonly string[]): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (SKIPPED_DIRS.has(entry.name)) return [];
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return walkFiles(entryPath, extensions);
    return extensions.some((extension) => entry.name.endsWith(extension))
      ? [entryPath]
      : [];
  });
}

function pluginCliNames(): Set<string> {
  const pluginsDir = path.join(REPO_ROOT, "plugins");
  const names = new Set<string>();
  for (const plugin of readdirSync(pluginsDir)) {
    const pluginDir = path.join(pluginsDir, plugin);
    if (!statSync(pluginDir).isDirectory()) continue;
    for (const file of walkFiles(pluginDir, [".ts", ".tsx"])) {
      if (file.includes(".test.")) continue;
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(
        /defineCli\(\s*\{[\s\S]{0,40}?name:\s*(?:"([a-z0-9-]+)"|bb\.pluginId)/gu,
      )) {
        names.add(match[1] ?? plugin);
      }
    }
  }
  return names;
}

function markdownCode(source: string): string[] {
  const code: string[] = [];
  let fence: string | null = null;
  for (const line of source.split("\n")) {
    const marker = /^\s*(`{3,}|~{3,})/u.exec(line)?.[1];
    if (marker !== undefined && (fence === null || marker.startsWith(fence))) {
      fence = fence === null ? marker : null;
      continue;
    }
    if (fence !== null) {
      code.push(line.replace(/^\s*\$\s+/u, ""));
      continue;
    }
    for (const match of line.matchAll(/(`+)([^`]+?)\1/gu)) {
      code.push(match[2]!);
    }
  }
  return code;
}

function tsxCode(source: string): string[] {
  return [
    ...source.matchAll(/\\`([^`\\]+)\\`/gu),
    ...source.matchAll(/<code>([^<]+)<\/code>/gu),
    ...source.matchAll(/command=\{?["'`]([^"'`]+)["'`]/gu),
  ].map((match) => match[1]!);
}

function commandCandidates(file: string, source: string): string[] {
  const code = /\.tsx?$/u.test(file) ? tsxCode(source) : markdownCode(source);
  return code.flatMap((snippet) =>
    snippet
      .split(/\n|&&|\|\||;|\$\(/u)
      .map((part) => part.trim().split(/\s{2,}/u)[0]!)
      .filter((part) => /^bb\s/u.test(part)),
  );
}

function tokens(command: string): string[] {
  return command
    .replace(/\\`/gu, "`")
    .replace(/"[^"]*"|'[^']*'/gu, "VALUE")
    .split(/[|<>]|\s#\s/u)[0]!
    .trim()
    .split(/\s+/u)
    .slice(1);
}

function isReference(command: string): boolean {
  const first = tokens(command)[0];
  return first !== undefined && WORD.test(first);
}

function problem(
  core: CommandNode,
  plugins: ReadonlySet<string>,
  command: string,
): string | null {
  const args = tokens(command);
  const first = args[0]!;
  let node = core.children.get(first);
  if (!node) {
    return plugins.has(first) || NON_COMMAND_NAMES.has(first)
      ? null
      : `unknown command \`bb ${first}\``;
  }
  const path = [first];
  for (const arg of args.slice(1)) {
    if (arg === "--") break;
    if (arg.startsWith("--")) {
      const flag = arg.split("=")[0]!.replace(/[^a-z0-9-]+$/u, "");
      if (!WORD.test(flag.slice(2))) continue;
      if (!node.flags.has(flag) && !GLOBAL_FLAGS.has(flag)) {
        return `unknown flag \`${flag}\` on \`bb ${path.join(" ")}\``;
      }
      continue;
    }
    if (node.children.size === 0 || !WORD.test(arg)) continue;
    const child = node.children.get(arg);
    if (!child) {
      return `unknown command \`bb ${[...path, arg].join(" ")}\``;
    }
    node = child;
    path.push(arg);
  }
  return null;
}

function references(): Reference[] {
  return SCANNED_ROOTS.flatMap(({ dir, extensions }) =>
    walkFiles(path.join(REPO_ROOT, dir), extensions).flatMap((file) =>
      commandCandidates(file, readFileSync(file, "utf8"))
        .filter(isReference)
        .map((text) => ({ file: path.relative(REPO_ROOT, file), text })),
    ),
  );
}

describe("bb commands written in docs, guides, skills and bb guide chapters", () => {
  it("exist in the CLI", async () => {
    const core = await coreCommandTree();
    const plugins = pluginCliNames();
    const found = references();
    const problems = found.flatMap((reference) => {
      const issue = problem(core, plugins, reference.text);
      return issue === null
        ? []
        : [`${reference.file}: ${issue} in \`${reference.text.trim()}\``];
    });
    expect(found.length).toBeGreaterThan(500);
    expect(problems).toEqual([]);
  }, 30_000);

  it("flags a renamed command and an unknown flag", async () => {
    const core = await coreCommandTree();
    const plugins = pluginCliNames();
    expect(problem(core, plugins, "bb thread lsit")).toBe(
      "unknown command `bb thread lsit`",
    );
    expect(problem(core, plugins, "bb thread list --nope")).toBe(
      "unknown flag `--nope` on `bb thread list`",
    );
    expect(problem(core, plugins, "bb nothing-here")).toBe(
      "unknown command `bb nothing-here`",
    );
    expect(problem(core, plugins, "bb thread list --json")).toBeNull();
    expect(problem(core, plugins, "bb keep-awake status")).toBeNull();
  }, 30_000);
});
