import semver from "semver";
import { z } from "zod";
import { githubReleaseRegistryUrl } from "../plugins/github-release-source.js";

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

const versionTemplate = z
  .string()
  .min(1)
  .refine((value) => value.split("{version}").length === 2, {
    message: "must contain {version} exactly once",
  });

const githubReleaseSourceSchema = z
  .object({
    githubRelease: z
      .object({
        repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u),
        package: z.string().min(1),
        range: semverRange,
        tagTemplate: versionTemplate,
        assetTemplate: versionTemplate,
      })
      .strict(),
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
    plugins: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/u),
            displayName: z.string().min(1),
            description: z.string(),
            icon: z.string().min(1).optional(),
            source: z.union([
              npmSourceSchema,
              gitSourceSchema,
              githubReleaseSourceSchema,
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

const legacyOfficialCatalogSchema = catalogSchema
  .extend({
    name: z.literal("bb-official"),
    displayName: z.string().min(1),
  })
  .strict();

export type PluginCatalog = z.infer<typeof catalogSchema>;
export type PluginCatalogEntry = PluginCatalog["plugins"][number];
export type PluginCatalogInstallation = NonNullable<
  PluginCatalogEntry["installation"]
>;

export function catalogPolicyWideningProblem(
  installation: PluginCatalogInstallation | undefined,
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
      return `catalog engines.${name} range ${JSON.stringify(catalogRange)} widens plugin manifest range ${JSON.stringify(manifestRange)}`;
    }
  }
  return null;
}

function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  const path = issue?.path.join(".");
  return `${path ? `${path}: ` : ""}${issue?.message ?? "invalid catalog"}`;
}

export function parsePluginCatalog(input: unknown): PluginCatalog {
  if (
    typeof input === "object" &&
    input !== null &&
    "schemaVersion" in input &&
    input.schemaVersion !== 1
  ) {
    throw new Error(
      `unknown plugin catalog schemaVersion ${JSON.stringify(input.schemaVersion)}; supported value is 1`,
    );
  }
  const parsed = catalogSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(`invalid plugin catalog: ${firstIssue(parsed.error)}`);
  }
  for (const entry of parsed.data.plugins) {
    if ("git" in entry.source && entry.source.git.subdir !== undefined) {
      const subdir = entry.source.git.subdir;
      if (subdir.startsWith("/") || subdir.split(/[\\/]/u).includes("..")) {
        throw new Error(
          `invalid plugin catalog: entry "${entry.id}" git subdir must stay inside the repository`,
        );
      }
    }
  }
  return parsed.data;
}

/**
 * Accept the one legacy persisted official shape and strip its retired
 * marketplace identity fields. Network catalogs still use parsePluginCatalog
 * and therefore must satisfy the current strict shape.
 */
export function normalizePersistedPluginCatalog(input: unknown): {
  catalog: PluginCatalog;
  normalizedLegacyShape: boolean;
} {
  const current = catalogSchema.safeParse(input);
  if (current.success) {
    return {
      catalog: parsePluginCatalog(current.data),
      normalizedLegacyShape: false,
    };
  }
  const legacy = legacyOfficialCatalogSchema.safeParse(input);
  if (!legacy.success)
    return { catalog: parsePluginCatalog(input), normalizedLegacyShape: false };
  const normalized = {
    schemaVersion: legacy.data.schemaVersion,
    plugins: legacy.data.plugins,
  };
  return {
    catalog: parsePluginCatalog(normalized),
    normalizedLegacyShape: true,
  };
}

export function catalogEntrySourceDisplay(entry: PluginCatalogEntry): string {
  if ("npm" in entry.source) {
    const spec = entry.source.npm.range ?? "";
    return `npm:${entry.source.npm.package}${spec ? `@${spec}` : ""}`;
  }
  if ("githubRelease" in entry.source) {
    const release = entry.source.githubRelease;
    return `github-release:${release.repository}/${release.assetTemplate}@${release.range}`;
  }
  const subdir = entry.source.git.subdir ? `#${entry.source.git.subdir}` : "";
  return `git:${entry.source.git.url}@${entry.source.git.ref}${subdir}`;
}

export function resolvedCatalogEntrySource(entry: PluginCatalogEntry): {
  source: string;
  gitSubdirectory?: string;
  npmRegistry?: string;
} {
  if ("npm" in entry.source) {
    const spec = entry.source.npm.range ?? "";
    return {
      source: `npm:${entry.source.npm.package}${spec ? `@${spec}` : ""}`,
      ...(entry.source.npm.registry === undefined
        ? {}
        : { npmRegistry: entry.source.npm.registry }),
    };
  }
  if ("githubRelease" in entry.source) {
    const release = entry.source.githubRelease;
    return {
      source: `npm:${release.package}@${release.range}`,
      npmRegistry: githubReleaseRegistryUrl({
        repository: release.repository,
        tagTemplate: release.tagTemplate,
        assetTemplate: release.assetTemplate,
        bbEngineRange: entry.installation?.engines.bb,
        pluginSdkEngineRange: entry.installation?.engines.bbPluginSdk,
      }),
    };
  }
  return {
    source: `git:${entry.source.git.url}@${entry.source.git.ref}`,
    ...(entry.source.git.subdir === undefined
      ? {}
      : { gitSubdirectory: entry.source.git.subdir }),
  };
}
