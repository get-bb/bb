import {
  appKeyboardShortcutReference,
  type AppShortcutReferenceKey,
} from "@bb/domain";
import type { StructuredData } from "fumadocs-core/mdx-plugins/remark-structure";
import type { Source } from "fumadocs-core/source";

import { COPY_TOKEN } from "../../../../plugins/plugin-api-docs/src/surface-copy";
import { surfaceDocsPath } from "../../../../plugins/plugin-api-docs/src/surface-docs";
import {
  SURFACE_GROUPS,
  type PluginSurface,
  type SurfaceGroup,
} from "../../../../plugins/plugin-api-docs/src/surfaces";
import cliCommands from "./generated/cli-commands.json";
import { PLUGIN_SDK_SLUG } from "./nav";

export const REPO_BLOB = "https://github.com/get-bb/bb/blob/main";
export const SOURCES_HEADING = "Where this list comes from";

interface CliCommandEntry {
  aliases: string[];
  arguments: string;
  description: string;
  options: string[];
  path: string;
}

interface ReferencePageData {
  title: string;
  description: string;
  type: "reference";
  sources: string[];
  editPath: string;
  markdown: string;
  structuredData: StructuredData;
}

interface ReferenceSection {
  heading: string;
  body: string;
}

const SURFACES_PATH = "plugins/plugin-api-docs/src/surfaces.ts";
const KEYBOARD_SOURCES = [
  "packages/domain/src/app-keybindings.ts",
  "packages/domain/src/app-default-keybindings.ts",
  "packages/domain/src/app-command-metadata.ts",
];

function surfaceDocsSlug(surfaceId: string): string {
  return surfaceDocsPath(surfaceId).replace(/^\/docs\//u, "");
}

function headingId(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");
}

function tableCell(text: string): string {
  return text.replace(/\|/gu, "\\|").replace(/\n/gu, " ");
}

function codeCell(text: string): string {
  return `\`${text.replace(/\|/gu, "\\|")}\``;
}

function table(header: readonly string[], rows: readonly string[][]): string {
  return [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

function sourcesSection(
  paths: readonly string[],
  extra = "",
): ReferenceSection {
  const links = paths
    .map((path) => `- [\`${path}\`](${REPO_BLOB}/${path})`)
    .join("\n");
  return {
    heading: SOURCES_HEADING,
    body: `This page is generated from bb's source on every build, so it always matches \`main\`.${extra}\n\n${links}`,
  };
}

function plainText(markdown: string): string {
  return markdown
    .replace(/\[([^\]]+)\]\([^)]+\)/gu, "$1")
    .replace(/`|\*\*/gu, "");
}

function searchLines(markdown: string): string[] {
  return markdown
    .split("\n")
    .filter((line) => !/^\|?\s*-{3}/u.test(line))
    .map((line) =>
      plainText(line)
        .replace(/^\s*[-|]\s*/u, "")
        .replace(/\s*\|\s*/gu, " · ")
        .replace(/[\s·]+$/u, "")
        .trim(),
    )
    .filter((line) => line.length > 0);
}

function pageData(input: {
  title: string;
  description: string;
  intro: string;
  sources: string[];
  editPath: string;
  sections: ReferenceSection[];
}): ReferencePageData {
  const markdown = [
    input.intro,
    ...input.sections.map(
      (section) => `## ${section.heading}\n\n${section.body}`,
    ),
  ].join("\n\n");
  return {
    title: input.title,
    description: input.description,
    type: "reference",
    sources: input.sources,
    editPath: input.editPath,
    markdown,
    structuredData: {
      headings: input.sections.map((section) => ({
        id: headingId(section.heading),
        content: section.heading,
      })),
      contents: [
        ...searchLines(input.intro).map((content) => ({
          heading: undefined,
          content,
        })),
        ...input.sections.flatMap((section) =>
          searchLines(section.body).map((content) => ({
            heading: headingId(section.heading),
            content,
          })),
        ),
      ],
    },
  };
}

function cliGroups(
  commands: readonly CliCommandEntry[],
): Map<string, CliCommandEntry[]> {
  const groups = new Map<string, CliCommandEntry[]>();
  for (const command of commands) {
    const group = command.path.split(" ")[0]!;
    groups.set(group, [...(groups.get(group) ?? []), command]);
  }
  return groups;
}

function cliUsage(command: CliCommandEntry): string {
  return ["bb", command.path, command.arguments]
    .filter((part) => part.length > 0)
    .join(" ");
}

export function cliReferencePage(
  commands: readonly CliCommandEntry[] = cliCommands,
): ReferencePageData {
  const sections = [...cliGroups(commands)].map(([group, entries]) => ({
    heading: `bb ${group}`,
    body: table(
      ["Command", "What it does", "Flags"],
      entries.map((entry) => [
        codeCell(cliUsage(entry)) +
          (entry.aliases.length > 0
            ? ` (also ${entry.aliases.map((alias) => codeCell(alias)).join(", ")})`
            : ""),
        tableCell(entry.description),
        entry.options.map((option) => codeCell(option)).join(" "),
      ]),
    ),
  }));
  return pageData({
    title: "CLI",
    description:
      "Every core bb command, its arguments and its flags, generated from the CLI itself.",
    intro:
      "Every core `bb` command with its arguments and flags. Run `bb <command> --help` for the full help of one command. Plugins add their own commands; `bb plugin list` shows which plugins are installed.",
    sources: ["apps/cli/src/commands/**", "apps/cli/src/command-groups.ts"],
    editPath: "apps/cli/src/command-groups.ts",
    sections: [
      ...sections,
      sourcesSection(
        ["apps/cli/src/command-groups.ts", "apps/cli/src/commands/guide.ts"],
        " It is the same list `bb guide commands --json` prints.",
      ),
    ],
  });
}

function shortcutCell(keys: readonly AppShortcutReferenceKey[]): string {
  if (keys.length === 0) return "Not assigned";
  return keys
    .map(
      (key) =>
        `${codeCell(key.keys)}${key.surface === "everywhere" ? "" : ` (${key.surface})`}`,
    )
    .join(", ");
}

function keyboardReferencePage(): ReferencePageData {
  const sections = appKeyboardShortcutReference().map((group) => ({
    heading: group.label,
    body: table(
      ["Action", "What it does", "Mac", "Windows and Linux"],
      group.rows.map((row) => [
        tableCell(row.label),
        tableCell(row.description),
        shortcutCell(row.mac),
        shortcutCell(row.windowsLinux),
      ]),
    ),
  }));
  return pageData({
    title: "Keyboard shortcuts",
    description:
      "Every bb keyboard shortcut with its default keys on Mac, Windows and Linux.",
    intro:
      "Every action you can bind to a key, with bb's default keys. Change any of them in Settings → Keyboard. Actions marked Not assigned have no default key; you can give them one there.",
    sources: KEYBOARD_SOURCES,
    editPath: "packages/domain/src/app-default-keybindings.ts",
    sections: [...sections, sourcesSection(KEYBOARD_SOURCES)],
  });
}

function surfaceCopyMarkdown(text: string): string {
  return text
    .split(COPY_TOKEN)
    .filter((part) => part !== undefined)
    .map((part) => {
      if (part === "{experimental}") return "";
      const link = /^\[([^\]]+)\]\(([a-z0-9-]+)\)$/u.exec(part);
      if (link) return `[${link[1]}](/docs/${surfaceDocsSlug(link[2]!)})`;
      return part;
    })
    .join("")
    .replace(/\s{2,}/gu, " ")
    .trim();
}

function surfaceSummary(surface: PluginSurface): string {
  return surfaceCopyMarkdown(surface.summary).replace(
    /\s*With this, a plugin can:$/u,
    "",
  );
}

function surfacePage(
  surface: PluginSurface,
  group: SurfaceGroup,
): ReferencePageData {
  const sections: ReferenceSection[] = [
    {
      heading: "What a plugin can do",
      body: surface.bullets
        .map((bullet) => `- ${surfaceCopyMarkdown(bullet)}`)
        .join("\n"),
    },
  ];
  if (surface.reference) {
    sections.push({
      heading: "API behavior",
      body: surface.reference.map(surfaceCopyMarkdown).join("\n\n"),
    });
  }
  sections.push({
    heading: "SDK symbols",
    body: `Import these from \`@get-bb/plugin-sdk\`.\n\n${surface.apiSymbols
      .map((symbol) => `- \`${symbol}\``)
      .join("\n")}`,
  });
  if (surface.firstParty && surface.firstParty.length > 0) {
    sections.push({
      heading: "Used by",
      body: `bb's own plugins that use this surface: ${surface.firstParty.join(", ")}.`,
    });
  }
  sections.push(
    sourcesSection(
      [SURFACES_PATH],
      ` It is the same text as this surface's card in the [Plugin Guide](/plugin-guide?slide=${group.id}), where you can see where it sits in the app.`,
    ),
  );
  const summary = surfaceSummary(surface);
  return pageData({
    title: surface.title,
    description: plainText(summary),
    intro: `${surface.experimental ? "**Experimental.** Names and behavior may change before this surface is stable.\n\n" : ""}In the [Plugin Guide](/plugin-guide?slide=${group.id}), this surface is under ${group.title}: ${group.blurb}`,
    sources: [SURFACES_PATH],
    editPath: SURFACES_PATH,
    sections,
  });
}

function pluginSdkIndexPage(): ReferencePageData {
  const sections = SURFACE_GROUPS.map((group) => ({
    heading: group.title,
    body: `${group.blurb}\n\n${table(
      ["Surface", "What it adds"],
      group.surfaces.map((surface) => [
        `[${tableCell(surface.title)}](/docs/${surfaceDocsSlug(surface.id)})`,
        tableCell(plainText(surfaceSummary(surface))),
      ]),
    )}`,
  }));
  return pageData({
    title: "Plugin SDK",
    description:
      "Every place a bb plugin can add to the app, with one page per plugin surface and its SDK symbols.",
    intro:
      "A plugin surface is a place in bb a plugin can add to, like a sidebar badge or a thread tab. Each surface below has its own page with what a plugin can do there and the `@get-bb/plugin-sdk` symbols it uses. To see where each one sits in the app, open the [Plugin Guide](/plugin-guide).",
    sources: [SURFACES_PATH],
    editPath: SURFACES_PATH,
    sections: [...sections, sourcesSection([SURFACES_PATH])],
  });
}

function allSurfaces(): {
  surface: PluginSurface;
  group: SurfaceGroup;
}[] {
  return SURFACE_GROUPS.flatMap((group) =>
    group.surfaces.map((surface) => ({ surface, group })),
  );
}

export const referenceSource: Source<{
  pageData: ReferencePageData;
  metaData: { title: string };
}> = {
  files: [
    { type: "page", path: "cli.md", data: cliReferencePage() },
    {
      type: "page",
      path: "keyboard-shortcuts.md",
      data: keyboardReferencePage(),
    },
    {
      type: "page",
      path: `${PLUGIN_SDK_SLUG}/index.md`,
      data: pluginSdkIndexPage(),
    },
    ...allSurfaces().map(({ surface, group }) => ({
      type: "page" as const,
      path: `${surfaceDocsSlug(surface.id)}.md`,
      data: surfacePage(surface, group),
    })),
  ],
};
