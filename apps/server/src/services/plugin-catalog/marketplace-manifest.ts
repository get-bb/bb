import { join } from "node:path";
import {
  CURATED_PLUGIN_MARKETPLACE_NAME,
  pluginMarketplaceNameSchema,
  ROOT_PLUGIN_SOURCE_SELECTION,
  type PluginSourceSelection,
} from "@bb/server-contract";
import semver from "semver";
import { z } from "zod";
import {
  gitRangeSourceSpec,
  gitSemverTagName,
  normalizeGitTagPrefix,
  normalizePluginSubdirectory,
  parsePluginSource,
} from "../plugins/install-sources.js";

/** Published contract, consumed by the registry repository's CI. */
const MARKETPLACE_SCHEMA_URL =
  "https://getbb.app/schemas/marketplace.schema.json";

/** Reserved name of the marketplace BB itself curates. */
export const CURATED_MARKETPLACE_NAME = CURATED_PLUGIN_MARKETPLACE_NAME;

/**
 * Publisher shown for plugins that ship inside the app. They come from the
 * build, not from a marketplace refresh, so they keep their own label even
 * though the store groups them under the official marketplace.
 */
export const BUILTIN_PUBLISHER_LABEL = "BB Official";

/**
 * Grouping identity of those plugins. It is not a marketplace name, and a
 * marketplace cannot be called this: names are lowercase kebab-case.
 */
export const BUILTIN_PUBLISHER_KEY = "builtin";

/**
 * Entries one manifest may list. The 1 MiB document limit alone still allows
 * thousands of entries, and each entry costs an icon request and an icon row.
 */
export const MARKETPLACE_MAX_ENTRIES = 256;

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/u;
/**
 * A marketplace's own name is the handle every route and command addresses it
 * by, so the manifest must accept exactly what those contracts accept. A name
 * bb stored but could not refresh or remove by name would be unmanageable.
 */
const manifestNameSchema = pluginMarketplaceNameSchema;
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
 * the schema enforces shape here and {@link resolveEntryIcon} enforces the
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

/**
 * An SVG icon is single-color artwork: BB masks it with the surrounding text
 * color, the same way it renders a plugin's own compact `branding.icon`, so a
 * black-on-transparent glyph stays visible on a dark theme. Raster icons
 * (PNG, WebP) keep their own colors: a mask reads alpha only and would
 * flatten an opaque image into a solid block, and a raster is the form for
 * multi-color artwork. The object stays strict: an older desktop rejects the
 * whole manifest on an unknown field, so a per-entry opt-out needs a new
 * schemaVersion.
 */
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

/**
 * A ref must survive BB's `git:<url>@<ref>` syntax unchanged, so a listing
 * cannot smuggle a range, a `semver:` selector, or a second `@` past it.
 */
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

/** `ref` and `range` are mutually exclusive; strict objects enforce the XOR. */
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
          /** Monorepo tagging: `notes/` matches `notes/vX.Y.Z` tags. */
          tagPrefix: gitTagPrefixSchema.optional(),
        })
        .strict(),
    })
    .strict(),
]);

/**
 * A listing describes a plugin and where to get it; it does not declare
 * compatibility. A listing's copy of an `engines` range is a second source of
 * truth that goes stale the moment the plugin publishes a new version, and it
 * hid a compatible plugin behind an out-of-date manifest. BB reads
 * `engines.bb` and `engines.bbPluginSdk` from the fetched plugin's own
 * package.json and refuses the install there instead.
 */
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
 * Whether BB masks a cached image icon with the surrounding text color. Only
 * an SVG is tinted; see {@link iconSchema}. `contentType` is the validated
 * type BB serves the cached bytes as.
 */
export function entryIconTinted(contentType: string): boolean {
  return contentType === "image/svg+xml";
}

/**
 * Where an entry's icon is read from. A marketplace bb fetched over HTTPS
 * resolves relative icons against the manifest URL; one bb read from a git
 * checkout or a directory resolves them beside the manifest on disk.
 */
export type MarketplaceIconBase =
  | { kind: "url"; manifestUrl: string }
  | { kind: "dir"; root: string };

export type MarketplaceIconLocation =
  | { kind: "remote"; url: string }
  | { kind: "local"; path: string; relativePath: string };

/**
 * Where an entry's image icon lives, or null when the entry names a host icon
 * instead. Absolute URLs are always https and always remote; relative URLs
 * follow the manifest's own base.
 */
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
  // A local base reads the icon beside the manifest, which sits at the
  // checkout root. Resolving through URL drops any query or fragment and
  // collapses "." and ".." against that root, so the result names a path
  // inside the checkout; realPathInside enforces the same bound at read time.
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

/**
 * Where a person can read an entry's code before an install. A git entry
 * links its repository; a subdirectory links the directory on GitHub, and the
 * repository root elsewhere, because only GitHub's tree URL shape is known. An
 * npm entry on the default registry links its public package page. A private
 * registry has no public page bb can name, so that entry gets null.
 */
export function entryRepositoryUrl(entry: MarketplaceEntry): string | null {
  if ("npm" in entry.source) {
    return entry.source.npm.registry === undefined
      ? `https://www.npmjs.com/package/${entry.source.npm.package}`
      : null;
  }
  const git = entry.source.git;
  const repository = git.url.replace(/\.git$/u, "");
  if (git.subdir === undefined) return repository;
  // The schema accepts `#` and `?` in a subdirectory; raw interpolation would
  // turn them into a fragment or a query, so each segment is encoded.
  const path = git.subdir.split("/").map(encodeURIComponent).join("/");
  return new URL(repository).host === "github.com"
    ? `${repository}/tree/HEAD/${path}`
    : repository;
}

/** Human-readable source of an entry, shown before anything is installed. */
export function entrySourceDisplay(entry: MarketplaceEntry): string {
  if ("npm" in entry.source) {
    const spec = entry.source.npm.range ?? entry.source.npm.tag ?? "";
    // A listing that pins its own registry replaces the host's npm
    // configuration, so the confirmation must name that registry.
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
  const git = entry.source.git;
  return {
    // A range entry always uses the explicit `semver:` spec: the listing said
    // range, so a repository that also has a ref of that name must not win.
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
