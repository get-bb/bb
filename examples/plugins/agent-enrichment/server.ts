// bb-plugin-agent-enrichment — the "agent enrichment" hero plugin.
//
// A dependency-free, headless plugin whose entire surface is agent-facing:
// - bb.cli.register: a `bb docs` command that both humans and agents (via
//   bash) use to search the bundled docs/ folder
// - bb.settings.define: a boolean rendered in BB's settings UI
// - bb.storage.kv: caches the last search
// - skills/repo-conventions: a conventional skills/ directory (auto-imported
//   by BB in a later phase; today it documents the layout)
//
// The type-only import below is erased at load time, so this file runs as-is
// with no build step and no node_modules.
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BbPluginApi } from "@bb/plugin-sdk";

const docsDir = join(dirname(fileURLToPath(import.meta.url)), "docs");

const USAGE = [
  "Usage:",
  "  bb docs search <query...>   Search the bundled docs and print matching lines",
  "  bb docs last                Show the cached last search",
].join("\n");

interface LastSearch {
  query: string;
  matchCount: number;
  at: number;
}

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    caseSensitive: {
      type: "boolean",
      label: "Case-sensitive search",
      description: "Match docs search queries exactly instead of ignoring case.",
      default: false,
    },
  });

  async function search(query: string): Promise<string[]> {
    const { caseSensitive } = await settings.get();
    const needle = caseSensitive ? query : query.toLowerCase();
    const excerpts: string[] = [];
    const files = (await readdir(docsDir))
      .filter((file) => file.endsWith(".md"))
      .sort();
    for (const file of files) {
      const lines = (await readFile(join(docsDir, file), "utf8")).split("\n");
      lines.forEach((line, index) => {
        const haystack = caseSensitive ? line : line.toLowerCase();
        if (haystack.includes(needle)) {
          excerpts.push(`${file}:${index + 1}: ${line.trim()}`);
        }
      });
    }
    return excerpts;
  }

  bb.cli.register({
    name: "docs",
    summary: "Search this plugin's bundled docs",
    commands: [
      {
        name: "search",
        summary: "Search the docs and print matching lines",
        usage: "bb docs search <query...>",
      },
      {
        name: "last",
        summary: "Show the cached last search",
        usage: "bb docs last",
      },
    ],
    async run(argv) {
      const [sub, ...rest] = argv;
      if (sub === undefined || sub === "help" || sub === "--help") {
        return { exitCode: 0, stdout: USAGE };
      }
      if (sub === "search") {
        const query = rest.join(" ").trim();
        if (query.length === 0) {
          return { exitCode: 1, stderr: `Missing query.\n${USAGE}` };
        }
        const excerpts = await search(query);
        await bb.storage.kv.set("last-search", {
          query,
          matchCount: excerpts.length,
          at: Date.now(),
        } satisfies LastSearch);
        if (excerpts.length === 0) {
          return { exitCode: 0, stdout: `No matches for "${query}".` };
        }
        return { exitCode: 0, stdout: excerpts.join("\n") };
      }
      if (sub === "last") {
        const last = await bb.storage.kv.get<LastSearch>("last-search");
        if (!last) return { exitCode: 0, stdout: "No searches yet." };
        return {
          exitCode: 0,
          stdout: `Last search: "${last.query}" (${last.matchCount} matches)`,
        };
      }
      return { exitCode: 1, stderr: `Unknown subcommand "${sub}".\n${USAGE}` };
    },
  });
}
