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
import { headingId } from "./heading-id";
import { PLUGIN_SDK_SLUG } from "./nav";

export const REPO_BLOB = "https://github.com/get-bb/bb/blob/main";
export const SOURCES_HEADING = "Where this list comes from";

interface CliOption {
  flags: string;
  description: string;
}

interface CliCommandEntry {
  aliases: string[];
  arguments: string;
  description: string;
  optionDetails: CliOption[];
  path: string;
}

export type ReferenceLayout = "default" | "cli";

interface ReferencePageData {
  title: string;
  description: string;
  type: "reference";
  sources: string[];
  editPath: string;
  layout: ReferenceLayout;
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
        .replace(/^\s*(?:[-|]|#{3,6})\s*/u, "")
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
  layout?: ReferenceLayout;
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
    layout: input.layout ?? "default",
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

function sameOption(left: CliOption, right: CliOption): boolean {
  return left.flags === right.flags && left.description === right.description;
}

function commonOptions(entries: readonly CliCommandEntry[]): CliOption[] {
  const [first, ...rest] = entries;
  if (!first || rest.length === 0) return [];
  return first.optionDetails.filter((option) =>
    rest.every((entry) =>
      entry.optionDetails.some((candidate) => sameOption(candidate, option)),
    ),
  );
}

function optionTable(options: readonly CliOption[]): string {
  return table(
    ["Flag", "What it does"],
    options.map((option) => [
      codeCell(option.flags),
      tableCell(option.description),
    ]),
  );
}

function cliCommandBlock(
  entry: CliCommandEntry,
  common: readonly CliOption[],
): string {
  const heading = [`\`bb ${entry.path}\``];
  if (entry.arguments.length > 0) heading.push(codeCell(entry.arguments));
  const description = tableCell(entry.description);
  const aliases =
    entry.aliases.length > 0
      ? `${/[.!?]$/u.test(description) ? "" : "."} Also ${entry.aliases
          .map((alias) =>
            codeCell(
              ["bb", ...entry.path.split(" ").slice(0, -1), alias].join(" "),
            ),
          )
          .join(", ")}.`
      : "";
  const own = entry.optionDetails.filter(
    (option) => !common.some((shared) => sameOption(shared, option)),
  );
  return [
    `### ${heading.join(" ")}`,
    `${description}${aliases}`,
    ...(own.length > 0 ? [optionTable(own)] : []),
  ].join("\n\n");
}

function cliGroupBody(group: string, entries: CliCommandEntry[]): string {
  const common = commonOptions(entries);
  return [
    ...(common.length > 0
      ? [`Common flags on every \`bb ${group}\` command:`, optionTable(common)]
      : []),
    ...entries.map((entry) => cliCommandBlock(entry, common)),
  ].join("\n\n");
}

export function cliReferencePage(
  commands: readonly CliCommandEntry[] = cliCommands,
): ReferencePageData {
  const sections = [...cliGroups(commands)].map(([group, entries]) => ({
    heading: `bb ${group}`,
    body: cliGroupBody(group, entries),
  }));
  return pageData({
    title: "CLI",
    description:
      "Every core bb command, its arguments and its flags, generated from the CLI itself.",
    intro:
      "Run `bb <command> --help` for the full help of one command. Plugins add their own commands; `bb plugin list` shows which plugins are installed.",
    sources: ["apps/cli/src/commands/**", "apps/cli/src/command-groups.ts"],
    editPath: "apps/cli/src/command-groups.ts",
    layout: "cli",
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
      "Change any shortcut in Settings → Keyboard. Actions marked Not assigned have no default key; you can give them one there.",
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
    intro: `${surface.experimental ? "**Experimental.** Names and behavior may change before this surface is stable.\n\n" : ""}See it in place under ${group.title} in the [Plugin Guide](/plugin-guide?slide=${group.id}).`,
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
      "Surfaces are grouped by where they appear, like a sidebar badge or a thread tab. Open the [Plugin Guide](/plugin-guide) to see each one in the app.",
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
