import {
  defineRpcContract,
  type BbPluginApi,
  type PluginAgentToolResult,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  DIRECTIVE_ID,
  PLUGIN_ID_PATTERN,
  TOOL_NAME,
  pluginCardDirective,
} from "./shared.js";

const OFFICIAL_MARKETPLACE = "bb-official";
const INSTALL_COUNT_DISPLAY_MINIMUM = 25;
const NEW_PLUGIN_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

const TOOL_DESCRIPTION =
  "Show the user an inline card for an existing bb plugin. The card opens the plugin's detail page, where the user can review, enable, or install it. Pass the exact `pluginId` from `bb plugin search <terms> --json` or `bb plugin list --json`. This never installs or enables anything.";

const AGENT_INSTRUCTIONS = `When you recommend an existing bb plugin, call ${TOOL_NAME} with its pluginId and copy the returned \`::${DIRECTIVE_ID}\` line into your reply on its own line.`;

const pluginCardAuthorSchema = z
  .object({
    name: z.string(),
    github: z.string().nullable(),
    official: z.boolean(),
  })
  .strict();

const pluginCardInstallBadgeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("builtin") }).strict(),
  z.object({ kind: z.literal("new") }).strict(),
  z.object({ kind: z.literal("count"), installs: z.number().int() }).strict(),
]);

const pluginCardSchema = z
  .object({
    pluginId: z.string(),
    displayName: z.string(),
    description: z.string(),
    icon: z.string().nullable(),
    iconUrl: z.string().nullable(),
    iconTinted: z.boolean(),
    author: pluginCardAuthorSchema,
    installed: z.boolean(),
    included: z.boolean(),
    compatible: z.boolean(),
    incompatibleReason: z.string().nullable(),
    installBadge: pluginCardInstallBadgeSchema.nullable(),
  })
  .strict();

export type PluginCard = z.infer<typeof pluginCardSchema>;
type PluginCardInstallBadge = z.infer<typeof pluginCardInstallBadgeSchema>;
type CatalogEntry = Awaited<
  ReturnType<BbPluginApi["sdk"]["plugins"]["catalog"]["search"]>
>["results"][number];

type PluginCardLookup =
  | { kind: "found"; card: PluginCard }
  | { kind: "not-found"; pluginId: string };

export const pluginCardsRpcContract = defineRpcContract({
  getPluginCard: {
    input: z.object({ pluginId: z.string().trim().min(1) }).strict(),
    output: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("found"), card: pluginCardSchema }).strict(),
      z.object({ kind: z.literal("not-found"), pluginId: z.string() }).strict(),
    ]),
  },
});

function catalogAuthor(entry: CatalogEntry): PluginCard["author"] {
  const official = entry.marketplace === OFFICIAL_MARKETPLACE;
  return {
    name: official
      ? "BB Official"
      : (entry.author?.name ?? entry.publisherLabel),
    github: entry.author?.github ?? null,
    official,
  };
}

function localAuthor(
  installed: Awaited<
    ReturnType<BbPluginApi["sdk"]["plugins"]["list"]>
  >["plugins"][number],
): PluginCard["author"] {
  const official = installed.provenance === "builtin";
  return {
    name: official ? "BB Official" : (installed.publisherLabel ?? "Local"),
    github: null,
    official,
  };
}

function catalogInstallBadge(
  entry: CatalogEntry,
  now: number,
): PluginCardInstallBadge | null {
  if (entry.installedByDefault) return { kind: "builtin" };
  const installs = entry.installs ?? null;
  if (installs !== null && installs >= INSTALL_COUNT_DISPLAY_MINIMUM) {
    return { kind: "count", installs };
  }
  const publishedAt =
    entry.publishedAt === undefined ? NaN : Date.parse(entry.publishedAt);
  if (now - publishedAt < NEW_PLUGIN_WINDOW_MS) return { kind: "new" };
  return installs === null ? null : { kind: "count", installs };
}

export async function lookupPluginCard(
  bb: BbPluginApi,
  rawPluginId: string,
): Promise<PluginCardLookup> {
  const pluginId = rawPluginId.trim();
  if (!PLUGIN_ID_PATTERN.test(pluginId)) {
    return { kind: "not-found", pluginId };
  }
  const [{ results }, { plugins }] = await Promise.all([
    bb.sdk.plugins.catalog.search({ query: pluginId }),
    bb.sdk.plugins.list(),
  ]);
  const entry =
    results.find((result) => result.pluginId === pluginId) ??
    results.find((result) => result.entryId === pluginId);
  const installed = plugins.find(
    (plugin) => plugin.id === (entry?.pluginId ?? pluginId),
  );
  if (entry !== undefined) {
    return {
      kind: "found",
      card: {
        pluginId: entry.pluginId,
        displayName: entry.displayName,
        description: entry.description,
        icon: entry.icon,
        iconUrl: entry.iconUrl,
        iconTinted: entry.iconTinted,
        author: catalogAuthor(entry),
        installed: installed !== undefined,
        included: entry.source.startsWith("builtin:"),
        compatible: entry.compatible,
        incompatibleReason: entry.incompatibleReason,
        installBadge: catalogInstallBadge(entry, Date.now()),
      },
    };
  }
  if (installed !== undefined) {
    return {
      kind: "found",
      card: {
        pluginId: installed.id,
        displayName: installed.name ?? installed.id,
        description: installed.description ?? "",
        icon: installed.icon,
        iconUrl: installed.iconUrl,
        iconTinted: false,
        author: localAuthor(installed),
        installed: true,
        included: installed.provenance === "builtin",
        compatible: true,
        incompatibleReason: null,
        installBadge: null,
      },
    };
  }
  return { kind: "not-found", pluginId };
}

function errorResult(message: string): PluginAgentToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

export default function plugin(bb: BbPluginApi) {
  bb.rpc.register(pluginCardsRpcContract, {
    getPluginCard: ({ pluginId }) => lookupPluginCard(bb, pluginId),
  });

  bb.agents.registerTool({
    name: TOOL_NAME,
    description: TOOL_DESCRIPTION,
    presentation: {
      label: { pending: "Finding plugin", completed: "Showed plugin card" },
      icon: { glyph: "Puzzle" },
    },
    parameters: z.object({ pluginId: z.string() }).strict(),
    async execute({ pluginId }) {
      const lookup = await lookupPluginCard(bb, pluginId);
      if (lookup.kind === "not-found") {
        return errorResult(
          `No installed or store-listed plugin has the id ${JSON.stringify(lookup.pluginId)}. Run \`bb plugin search <terms> --json\` and pass a result's exact "pluginId"; do not guess ids.`,
        );
      }
      return [
        `Copy this line verbatim into your reply as a standalone line where the card for ${lookup.card.displayName} should appear:`,
        "",
        pluginCardDirective(lookup.card.pluginId),
      ].join("\n");
    },
  });

  bb.agents.configure(() => ({
    tools: [TOOL_NAME],
    skills: [],
    instructions: AGENT_INSTRUCTIONS,
  }));
}
