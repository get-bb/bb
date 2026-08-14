import {
  ROOT_PLUGIN_SOURCE_SELECTION,
  type PluginSourceSelection,
} from "@bb/server-contract";
import semver from "semver";
import { z } from "zod";
import {
  normalizePluginSubdirectory,
  parsePluginSource,
} from "../plugins/install-sources.js";

/** Published contract, consumed by the registry repository's CI. */
const MARKETPLACE_SCHEMA_URL =
  "https://getbb.app/schemas/marketplace.schema.json";

/** Reserved name of the marketplace BB itself curates. */
export const OFFICIAL_MARKETPLACE_NAME = "bb-official";

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/u;
/** Lowercase kebab-case, the store's grouping vocabulary. */
const TAG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
/** A GitHub login or organization, as GitHub itself accepts them. */
const GITHUB_LOGIN_PATTERN = /^[A-Za-z0-9](?:-?[A-Za-z0-9]){0,38}$/u;
/** A host icon name such as `ZoomIn`; never a path or a URL. */
const ICON_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9]*$/u;
const ICON_EXTENSIONS = [".svg", ".png", ".webp"] as const;

const semverRange = z
  .string()
  .min(1)
  .refine((value) => semver.validRange(value) !== null, {
    message: "must be a valid semver range",
  });

const httpsUrl = z
  .string()
  .min(1)
  .refine(
    (value) => {
      try {
        return new URL(value).protocol === "https:";
      } catch {
        return false;
      }
    },
    { message: "must be an https URL" },
  );

function iconExtensionProblem(pathname: string): string | null {
  const lower = pathname.toLowerCase();
  return ICON_EXTENSIONS.some((extension) => lower.endsWith(extension))
    ? null
    : `must point at a ${ICON_EXTENSIONS.join(", ")} file`;
}

/**
 * An icon URL is absolute `https:` or relative to the manifest's own URL, so a
 * git-hosted marketplace can keep icons beside its manifest. Plain `http:` is
 * rejected; the relative form is only checkable once a base URL is known, so
 * the schema enforces shape here and {@link resolveEntryIconUrl} enforces the
 * resolved protocol.
 */
const iconUrlSchema = z
  .string()
  .min(1)
  .superRefine((value, ctx) => {
    const absolute = /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(value);
    if (absolute && !value.toLowerCase().startsWith("https:")) {
      ctx.addIssue({ code: "custom", message: "must be an https URL" });
      return;
    }
    let pathname: string;
    try {
      pathname = new URL(value, "https://marketplace.invalid/base/").pathname;
    } catch {
      ctx.addIssue({ code: "custom", message: "is not a valid URL" });
      return;
    }
    const problem = iconExtensionProblem(pathname);
    if (problem !== null) ctx.addIssue({ code: "custom", message: problem });
  });

const iconSchema = z.union([
  z.string().regex(ICON_NAME_PATTERN, "must be a host icon name"),
  z.object({ url: iconUrlSchema }).strict(),
]);

const authorSchema = z
  .object({
    name: z.string().min(1),
    github: z.string().regex(GITHUB_LOGIN_PATTERN).optional(),
    url: httpsUrl.optional(),
  })
  .strict();

const enginesSchema = z
  .object({
    bb: semverRange.optional(),
    bbPluginSdk: semverRange.optional(),
  })
  .strict();

const npmSourceSchema = z
  .object({
    npm: z
      .object({
        package: z
          .string()
          .min(1)
          .superRefine((value, ctx) => {
            try {
              const parsed = parsePluginSource(`npm:${value}`);
              if (
                parsed.kind !== "npm" ||
                parsed.name !== value ||
                parsed.spec.length !== 0
              ) {
                throw new Error("package name is ambiguous");
              }
            } catch (error) {
              ctx.addIssue({
                code: "custom",
                message: error instanceof Error ? error.message : String(error),
              });
            }
          }),
        range: semverRange.optional(),
        /** An npm dist-tag such as `beta`; mutually exclusive with `range`. */
        tag: z
          .string()
          .min(1)
          .regex(/^[A-Za-z][A-Za-z0-9._-]*$/u)
          .optional(),
        registry: httpsUrl.optional(),
      })
      .strict()
      .refine((npm) => npm.range === undefined || npm.tag === undefined, {
        message: "range and tag are mutually exclusive",
      }),
  })
  .strict();

const gitSourceSchema = z
  .object({
    git: z
      .object({
        url: httpsUrl,
        subdir: z
          .string()
          .min(1)
          .superRefine((value, ctx) => {
            try {
              normalizePluginSubdirectory(value);
            } catch (error) {
              ctx.addIssue({
                code: "custom",
                message: error instanceof Error ? error.message : String(error),
              });
            }
          })
          .optional(),
        ref: z
          .string()
          .min(1)
          .superRefine((value, ctx) => {
            try {
              const parsed = parsePluginSource(
                `git:https://marketplace.invalid/plugin.git@${value}`,
              );
              if (parsed.kind !== "git" || parsed.ref !== value) {
                throw new Error("git ref is ambiguous");
              }
            } catch (error) {
              ctx.addIssue({
                code: "custom",
                message: error instanceof Error ? error.message : String(error),
              });
            }
          }),
      })
      .strict(),
  })
  .strict();

const entrySchema = z
  .object({
    id: z.string().regex(NAME_PATTERN),
    displayName: z.string().min(1),
    description: z.string().min(1),
    icon: iconSchema,
    tags: z.array(z.string().max(32).regex(TAG_PATTERN)).max(10).optional(),
    author: authorSchema,
    engines: enginesSchema.optional(),
    source: z.union([npmSourceSchema, gitSourceSchema]),
  })
  .strict();

const marketplaceManifestSchema = z
  .object({
    $schema: z.literal(MARKETPLACE_SCHEMA_URL).optional(),
    schemaVersion: z.literal(1),
    name: z.string().regex(NAME_PATTERN),
    displayName: z.string().min(1),
    description: z.string().min(1).optional(),
    plugins: z.array(entrySchema).superRefine((entries, ctx) => {
      const seen = new Set<string>();
      entries.forEach((entry, index) => {
        if (seen.has(entry.id)) {
          ctx.addIssue({
            code: "custom",
            path: [index, "id"],
            message: `duplicate plugin id "${entry.id}"`,
          });
        }
        seen.add(entry.id);
      });
    }),
  })
  .strict();

export type MarketplaceManifest = z.infer<typeof marketplaceManifestSchema>;
export type MarketplaceEntry = MarketplaceManifest["plugins"][number];
export type MarketplaceEngines = z.infer<typeof enginesSchema>;

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join(".");
      return path.length === 0 ? issue.message : `${path}: ${issue.message}`;
    })
    .join("; ");
}

/**
 * Parse a marketplace manifest. The document is rejected whole: consumers see
 * either a fully validated catalog or the previous last-known-good one.
 */
export function parseMarketplaceManifest(
  input: unknown,
  location: string,
): MarketplaceManifest {
  if (
    typeof input === "object" &&
    input !== null &&
    "schemaVersion" in input &&
    input.schemaVersion !== 1
  ) {
    throw new Error(
      `invalid ${location}: unknown schemaVersion ${JSON.stringify(input.schemaVersion)}; supported value is 1`,
    );
  }
  const parsed = marketplaceManifestSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(`invalid ${location}: ${formatIssues(parsed.error)}`);
  }
  return parsed.data;
}

export function parseMarketplaceManifestJson(
  raw: string,
  location: string,
): MarketplaceManifest {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `invalid ${location}: not valid JSON (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  return parseMarketplaceManifest(json, location);
}

/** The entry's declared host icon name, or null when it ships an image. */
export function entryIconName(entry: MarketplaceEntry): string | null {
  return typeof entry.icon === "string" ? entry.icon : null;
}

/**
 * Absolute https URL of an entry's image icon, or null when the entry names a
 * host icon instead. Relative URLs resolve against the manifest's own URL.
 */
export function resolveEntryIconUrl(
  entry: MarketplaceEntry,
  manifestUrl: string,
): string | null {
  if (typeof entry.icon === "string") return null;
  const resolved = new URL(entry.icon.url, manifestUrl);
  if (resolved.protocol !== "https:") {
    throw new Error(
      `icon URL ${JSON.stringify(entry.icon.url)} resolves to a non-https URL`,
    );
  }
  return resolved.toString();
}

/**
 * A marketplace may narrow the plugin manifest's engine ranges, never widen
 * them: a listing must not promise compatibility the plugin itself denies.
 */
export function marketplacePolicyWideningProblem(
  engines: MarketplaceEngines | undefined,
  manifest: {
    bbEngineRange: string | undefined;
    bbPluginSdkRange: string | undefined;
  },
): string | null {
  for (const [name, entryRange, manifestRange] of [
    ["bb", engines?.bb, manifest.bbEngineRange],
    ["bbPluginSdk", engines?.bbPluginSdk, manifest.bbPluginSdkRange],
  ] as const) {
    if (
      entryRange !== undefined &&
      manifestRange !== undefined &&
      !semver.subset(entryRange, manifestRange)
    ) {
      return `marketplace engines.${name} range ${JSON.stringify(entryRange)} widens plugin manifest range ${JSON.stringify(manifestRange)}`;
    }
  }
  return null;
}

/** Human-readable source of an entry, shown before anything is installed. */
export function entrySourceDisplay(entry: MarketplaceEntry): string {
  if ("npm" in entry.source) {
    const spec = entry.source.npm.range ?? entry.source.npm.tag ?? "";
    return `npm:${entry.source.npm.package}${spec.length === 0 ? "" : `@${spec}`}`;
  }
  const subdir =
    entry.source.git.subdir === undefined ? "" : `#${entry.source.git.subdir}`;
  return `git:${entry.source.git.url}@${entry.source.git.ref}${subdir}`;
}

interface ResolvedEntrySource {
  /** Install-pipeline source spec. */
  source: string;
  /** Which plugin of the source the entry lists. */
  selection: PluginSourceSelection;
  /** Registry override for npm entries that name one. */
  npmRegistry?: string;
}

/** Translate an entry's source into install-pipeline inputs. */
export function resolvedEntrySource(
  entry: MarketplaceEntry,
): ResolvedEntrySource {
  if ("npm" in entry.source) {
    const spec = entry.source.npm.range ?? entry.source.npm.tag ?? "";
    return {
      source: `npm:${entry.source.npm.package}${spec.length === 0 ? "" : `@${spec}`}`,
      selection: ROOT_PLUGIN_SOURCE_SELECTION,
      ...(entry.source.npm.registry === undefined
        ? {}
        : { npmRegistry: entry.source.npm.registry }),
    };
  }
  return {
    source: `git:${entry.source.git.url}@${entry.source.git.ref}`,
    selection:
      entry.source.git.subdir === undefined
        ? ROOT_PLUGIN_SOURCE_SELECTION
        : { kind: "subdirectory", path: entry.source.git.subdir },
  };
}
