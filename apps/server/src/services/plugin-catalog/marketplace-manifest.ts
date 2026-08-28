import { join } from "node:path";
import {
  CURATED_PLUGIN_MARKETPLACE_NAME,
  pluginMarketplaceNameSchema,
  ROOT_PLUGIN_SOURCE_SELECTION,
  type PluginSourceSelection,
} from "@bb/server-contract";
import semver from "semver";
import { z } from "zod";
import { formatIssues } from "../plugins/collection-manifest.js";
import {
  gitRangeSourceSpec,
  gitSemverTagName,
  normalizeGitTagPrefix,
  normalizePluginSubdirectory,
  parsePluginSource,
} from "../plugins/install-sources.js";

const MARKETPLACE_SCHEMA_URL =
  "https://getbb.app/schemas/marketplace.schema.json";

export const CURATED_MARKETPLACE_NAME = CURATED_PLUGIN_MARKETPLACE_NAME;

export const BUILTIN_PUBLISHER_LABEL = "BB Official";

export const BUILTIN_PUBLISHER_KEY = "builtin";

const MARKETPLACE_MAX_ENTRIES = 256;

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/u;
const manifestNameSchema = pluginMarketplaceNameSchema;
const TAG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const GITHUB_LOGIN_PATTERN = /^[A-Za-z0-9](?:-?[A-Za-z0-9]){0,38}$/u;
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

const gitSubdirSchema = z
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
  });

const gitRefSchema = z
  .string()
  .min(1)
  .superRefine((value, ctx) => {
    try {
      const parsed = parsePluginSource(
        `git:https://marketplace.invalid/plugin.git@${value}`,
      );
      if (
        parsed.kind !== "git" ||
        parsed.selector.kind !== "ref" ||
        parsed.selector.ref !== value
      ) {
        throw new Error("git ref is ambiguous");
      }
    } catch (error) {
      ctx.addIssue({
        code: "custom",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

const gitTagPrefixSchema = z
  .string()
  .min(1)
  .superRefine((value, ctx) => {
    try {
      normalizeGitTagPrefix(value);
    } catch (error) {
      ctx.addIssue({
        code: "custom",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

const gitSourceSchema = z.union([
  z
    .object({
      git: z
        .object({
          url: httpsUrl,
          subdir: gitSubdirSchema.optional(),
          ref: gitRefSchema,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      git: z
        .object({
          url: httpsUrl,
          subdir: gitSubdirSchema.optional(),
          range: semverRange,
          tagPrefix: gitTagPrefixSchema.optional(),
        })
        .strict(),
    })
    .strict(),
]);

const entrySchema = z
  .object({
    id: z.string().regex(NAME_PATTERN),
    displayName: z.string().min(1),
    description: z.string().min(1),
    icon: iconSchema,
    tags: z.array(z.string().max(32).regex(TAG_PATTERN)).max(10).optional(),
    author: authorSchema,
    source: z.union([npmSourceSchema, gitSourceSchema]),
  })
  .strict();

const marketplaceManifestSchema = z
  .object({
    $schema: z.literal(MARKETPLACE_SCHEMA_URL).optional(),
    schemaVersion: z.literal(1),
    name: manifestNameSchema,
    displayName: z.string().min(1),
    description: z.string().min(1).optional(),
    plugins: z
      .array(entrySchema)
      .max(
        MARKETPLACE_MAX_ENTRIES,
        `a marketplace may list at most ${MARKETPLACE_MAX_ENTRIES} plugins`,
      )
      .superRefine((entries, ctx) => {
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

export function entryIconName(entry: MarketplaceEntry): string | null {
  return typeof entry.icon === "string" ? entry.icon : null;
}

export function entryIconTinted(contentType: string): boolean {
  return contentType === "image/svg+xml";
}

export type MarketplaceIconBase =
  | { kind: "url"; manifestUrl: string }
  | { kind: "dir"; root: string };

export type MarketplaceIconLocation =
  | { kind: "remote"; url: string }
  | { kind: "local"; path: string; relativePath: string };

export function resolveEntryIcon(
  entry: MarketplaceEntry,
  base: MarketplaceIconBase,
): MarketplaceIconLocation | null {
  if (typeof entry.icon === "string") return null;
  const declared = entry.icon.url;
  const absolute = /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(declared);
  if (base.kind === "url" || absolute) {
    const resolved = new URL(
      declared,
      base.kind === "url" ? base.manifestUrl : "https://marketplace.invalid/",
    );
    if (resolved.protocol !== "https:") {
      throw new Error(
        `icon URL ${JSON.stringify(declared)} resolves to a non-https URL`,
      );
    }
    return { kind: "remote", url: resolved.toString() };
  }
  const resolved = new URL(declared, "https://marketplace.invalid/");
  const relativePath = normalizePluginSubdirectory(
    decodeURIComponent(resolved.pathname).replace(/^\/+/u, ""),
  );
  return {
    kind: "local",
    path: join(base.root, ...relativePath.split("/")),
    relativePath,
  };
}

export function entryRepositoryUrl(entry: MarketplaceEntry): string | null {
  if ("npm" in entry.source) {
    return entry.source.npm.registry === undefined
      ? `https://www.npmjs.com/package/${entry.source.npm.package}`
      : null;
  }
  const git = entry.source.git;
  const repository = git.url.replace(/\.git$/u, "");
  if (git.subdir === undefined) return repository;
  const path = git.subdir.split("/").map(encodeURIComponent).join("/");
  return new URL(repository).host === "github.com"
    ? `${repository}/tree/HEAD/${path}`
    : repository;
}

export function entrySourceDisplay(entry: MarketplaceEntry): string {
  if ("npm" in entry.source) {
    const spec = entry.source.npm.range ?? entry.source.npm.tag ?? "";
    const registry =
      entry.source.npm.registry === undefined
        ? ""
        : ` (registry ${entry.source.npm.registry})`;
    return `npm:${entry.source.npm.package}${spec.length === 0 ? "" : `@${spec}`}${registry}`;
  }
  const git = entry.source.git;
  const subdir = git.subdir === undefined ? "" : `#${git.subdir}`;
  if ("ref" in git) return `git:${git.url}@${git.ref}${subdir}`;
  const prefix = git.tagPrefix ?? "";
  return `git:${git.url}@${git.range}${subdir} (tags ${gitSemverTagName(prefix, "X.Y.Z")})`;
}

interface ResolvedEntrySource {
  source: string;
  selection: PluginSourceSelection;
  npmRegistry?: string;
}

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
  const git = entry.source.git;
  return {
    source:
      "ref" in git
        ? `git:${git.url}@${git.ref}`
        : gitRangeSourceSpec({
            url: git.url,
            range: git.range,
            tagPrefix: git.tagPrefix ?? "",
          }),
    selection:
      git.subdir === undefined
        ? ROOT_PLUGIN_SOURCE_SELECTION
        : { kind: "subdirectory", path: git.subdir },
  };
}
