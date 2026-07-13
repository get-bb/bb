import { isAbsolute, relative, resolve, sep } from "node:path";
import semver from "semver";
import { z } from "zod";
import { realPathInside } from "../plugins/install-sources.js";

const semverRange = z
  .string()
  .min(1)
  .refine((value) => semver.validRange(value) !== null, {
    message: "must be a valid semver range",
  });

const npmSourceSchema = z
  .object({
    npm: z
      .object({
        package: z.string().min(1),
        registry: z.string().url().optional(),
        range: semverRange.optional(),
      })
      .strict(),
  })
  .strict();

const gitSourceSchema = z
  .object({
    git: z
      .object({
        url: z.string().min(1),
        subdir: z.string().min(1).optional(),
        ref: z.string().min(1),
      })
      .strict(),
  })
  .strict();

const pathSourceSchema = z
  .object({
    path: z.string().min(1),
  })
  .strict();

const installationSchema = z
  .object({
    engines: z
      .object({
        bb: semverRange.optional(),
        bbPluginSdk: semverRange.optional(),
      })
      .strict(),
  })
  .strict();

const catalogSchema = z
  .object({
    schemaVersion: z.literal(1),
    name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/u),
    displayName: z.string().min(1),
    plugins: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/u),
            displayName: z.string().min(1),
            description: z.string(),
            source: z.union([
              npmSourceSchema,
              gitSourceSchema,
              pathSourceSchema,
            ]),
            installation: installationSchema.optional(),
            category: z.string().min(1).optional(),
          })
          .strict(),
      )
      .superRefine((entries, context) => {
        const seen = new Set<string>();
        for (let index = 0; index < entries.length; index += 1) {
          const id = entries[index]?.id;
          if (id !== undefined && seen.has(id)) {
            context.addIssue({
              code: "custom",
              path: [index, "id"],
              message: `duplicate plugin id "${id}"`,
            });
          }
          if (id !== undefined) seen.add(id);
        }
      }),
  })
  .strict();

export type MarketplaceCatalog = z.infer<typeof catalogSchema>;
export type MarketplaceCatalogEntry = MarketplaceCatalog["plugins"][number];
export type MarketplaceInstallation = NonNullable<
  MarketplaceCatalogEntry["installation"]
>;

export function marketplacePolicyWideningProblem(
  installation: MarketplaceInstallation | undefined,
  manifest: {
    bbEngineRange: string | undefined;
    bbPluginSdkRange: string | undefined;
  },
): string | null {
  for (const [name, catalogRange, manifestRange] of [
    ["bb", installation?.engines.bb, manifest.bbEngineRange],
    [
      "bbPluginSdk",
      installation?.engines.bbPluginSdk,
      manifest.bbPluginSdkRange,
    ],
  ] as const) {
    if (
      catalogRange !== undefined &&
      manifestRange !== undefined &&
      !semver.subset(catalogRange, manifestRange)
    ) {
      return `marketplace engines.${name} range ${JSON.stringify(catalogRange)} widens plugin manifest range ${JSON.stringify(manifestRange)}`;
    }
  }
  return null;
}

function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  const path = issue?.path.join(".");
  return `${path ? `${path}: ` : ""}${issue?.message ?? "invalid catalog"}`;
}

export function parseMarketplaceCatalog(
  input: unknown,
  sourceKind: "path" | "git",
  marketplaceRoot: string,
): MarketplaceCatalog {
  if (
    typeof input === "object" &&
    input !== null &&
    "schemaVersion" in input &&
    input.schemaVersion !== 1
  ) {
    throw new Error(
      `unknown marketplace catalog schemaVersion ${JSON.stringify(input.schemaVersion)}; supported value is 1`,
    );
  }
  const parsed = catalogSchema.safeParse(input);
  if (!parsed.success)
    throw new Error(`invalid marketplace catalog: ${firstIssue(parsed.error)}`);
  for (const entry of parsed.data.plugins) {
    if ("git" in entry.source && entry.source.git.subdir !== undefined) {
      const subdir = entry.source.git.subdir;
      if (
        isAbsolute(subdir) ||
        subdir.split(/[\\/]/u).some((part) => part === "..")
      ) {
        throw new Error(
          `invalid marketplace catalog: entry "${entry.id}" git subdir must stay inside the repository`,
        );
      }
    }
    if (!("path" in entry.source)) continue;
    if (sourceKind !== "path") {
      throw new Error(
        `invalid marketplace catalog: remote entry "${entry.id}" may not use a local path source`,
      );
    }
    const path = entry.source.path;
    if (isAbsolute(path)) {
      throw new Error(
        `invalid marketplace catalog: entry "${entry.id}" path must be relative`,
      );
    }
    const root = resolve(marketplaceRoot);
    const target = resolve(root, path);
    const fromRoot = relative(root, target);
    if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`)) {
      throw new Error(
        `invalid marketplace catalog: entry "${entry.id}" path escapes the marketplace root`,
      );
    }
  }
  return parsed.data;
}

/** Re-check path entries after materialization so symlinks cannot escape. */
export async function validateMarketplaceCatalogRealPaths(
  catalog: MarketplaceCatalog,
  sourceKind: "path" | "git",
  marketplaceRoot: string,
): Promise<void> {
  if (sourceKind !== "path") return;
  for (const entry of catalog.plugins) {
    if (!("path" in entry.source)) continue;
    await realPathInside(
      marketplaceRoot,
      resolve(marketplaceRoot, entry.source.path),
      `marketplace entry "${entry.id}" path`,
    );
  }
}

export function catalogEntrySourceDisplay(
  entry: MarketplaceCatalogEntry,
): string {
  if ("path" in entry.source) return `path:${entry.source.path}`;
  if ("npm" in entry.source) {
    const spec = entry.source.npm.range ?? "";
    return `npm:${entry.source.npm.package}${spec ? `@${spec}` : ""}`;
  }
  const subdir = entry.source.git.subdir ? `#${entry.source.git.subdir}` : "";
  return `git:${entry.source.git.url}@${entry.source.git.ref}${subdir}`;
}

export function resolvedCatalogEntrySource(
  entry: MarketplaceCatalogEntry,
  marketplaceRoot: string,
): { source: string; gitSubdirectory?: string } {
  if ("path" in entry.source) {
    return { source: `path:${resolve(marketplaceRoot, entry.source.path)}` };
  }
  if ("npm" in entry.source) {
    const spec = entry.source.npm.range ?? "";
    return {
      source: `npm:${entry.source.npm.package}${spec ? `@${spec}` : ""}`,
    };
  }
  return {
    source: `git:${entry.source.git.url}@${entry.source.git.ref}`,
    ...(entry.source.git.subdir === undefined
      ? {}
      : { gitSubdirectory: entry.source.git.subdir }),
  };
}
