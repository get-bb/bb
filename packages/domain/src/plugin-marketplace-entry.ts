import { z } from "zod";
import { pluginCatalogCategoryIdSchema } from "./plugin-catalog-category.js";

const MARKETPLACE_MAX_SCREENSHOTS = 6;
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/u;
const TAG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const GITHUB_LOGIN_PATTERN = /^[A-Za-z0-9](?:-?[A-Za-z0-9]){0,38}$/u;
const HOST_ICON_PATTERN = /^[A-Za-z][A-Za-z0-9]*$/u;
const HTTPS_URL_PATTERN = /^https:\/\//u;
const ICON_URL_PATTERN =
  /^(?:(?![A-Za-z][A-Za-z0-9+.-]*:)|(?=[Hh][Tt][Tt][Pp][Ss]:))[^\s]*\.(?:[Ss][Vv][Gg]|[Pp][Nn][Gg]|[Ww][Ee][Bb][Pp])(?:[?#][^\s]*)?$/u;
const V2_ICON_URL_PATTERN =
  /^(?:(?![A-Za-z][A-Za-z0-9+.-]*:)|(?=[Hh][Tt][Tt][Pp][Ss]:\/\/[^/?#\s]+\/))[^\s?#]*\.(?:[Ss][Vv][Gg]|[Pp][Nn][Gg]|[Ww][Ee][Bb][Pp])(?:[?#][^\s]*)?$/u;
const SCREENSHOT_URL_PATTERN =
  /^(?:(?![A-Za-z][A-Za-z0-9+.-]*:)|(?=[Hh][Tt][Tt][Pp][Ss]:\/\/[^/?#\s]+\/))[^\s?#]*\.(?:[Pp][Nn][Gg]|[Jj][Pp][Ee]?[Gg]|[Ww][Ee][Bb][Pp])(?:[?#][^\s]*)?$/u;
const NPM_PACKAGE_PATTERN =
  /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/u;
const GIT_SUBDIR_PATTERN =
  /^(?![A-Za-z]:)(?!\/)(?!(?:[^/]+\/)*(?:\.|\.\.|\.git)(?:\/|$))[^/\\]+(?:\/[^/\\]+)*$/u;
const GIT_REF_PATTERN =
  /^(?!-)(?![\s\S]*\.\.)(?![\s\S]*@)(?![\s\S]*:)[\s\S]+$/u;
const GIT_TAG_PREFIX_PATTERN =
  /^(?!.*\.\.)(?!.*\/\/)(?!.*\/\.)(?![^/]*\.lock(?:\/|$))(?!.*\/[^/]*\.lock(?:\/|$))(?!.*\.$)[A-Za-z0-9][A-Za-z0-9._/-]*$/u;

function rejectKeyConflicts(
  input: unknown,
  conflicts: readonly (readonly [string, string])[],
  ctx: z.RefinementCtx,
): unknown {
  if (typeof input !== "object" || input === null) return input;
  for (const [left, right] of conflicts) {
    if (left in input && right in input) {
      ctx.addIssue({
        code: "custom",
        message: `${left} and ${right} are mutually exclusive`,
      });
    }
  }
  return input;
}

const SEMVER_NUMBER = String.raw`(?:0|[1-9]\d*|[xX*])`;
const SEMVER_PRERELEASE = String.raw`(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?`;
const SEMVER_BUILD = String.raw`(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?`;
const SEMVER_VERSION = String.raw`v?${SEMVER_NUMBER}(?:\.${SEMVER_NUMBER}(?:\.${SEMVER_NUMBER})?)?${SEMVER_PRERELEASE}${SEMVER_BUILD}`;
const SEMVER_COMPARATOR = String.raw`(?:[<>]=?|=|~>?|\^)?\s*${SEMVER_VERSION}`;
const SEMVER_SET = String.raw`(?:\*|${SEMVER_VERSION}\s+-\s+${SEMVER_VERSION}|${SEMVER_COMPARATOR}(?:\s+${SEMVER_COMPARATOR})*|)`;

export const MARKETPLACE_SEMVER_RANGE_PATTERN = new RegExp(
  String.raw`^\s*${SEMVER_SET}(?:\s*\|\|\s*${SEMVER_SET})*\s*$`,
  "u",
);

const INVALID_PARTIAL_PRERELEASE_PATTERN = new RegExp(
  String.raw`(?:^|[\s|<>=~^])v?(?!(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)-)(?:0|[1-9]\d*|[xX*])(?:\.(?:0|[1-9]\d*|[xX*])(?:\.(?:0|[1-9]\d*|[xX*]))?)?-[0-9A-Za-z-]+`,
  "u",
);

const semverRangeSchema = z
  .string()
  .min(1)
  .regex(MARKETPLACE_SEMVER_RANGE_PATTERN);
const semverRangeV2Schema = semverRangeSchema.refine(
  (value) => !INVALID_PARTIAL_PRERELEASE_PATTERN.test(value),
  "prerelease ranges require three numeric version parts",
);
const httpsUrlSchema = z.string().regex(HTTPS_URL_PATTERN);
const validHttpsUrlSchema = httpsUrlSchema.refine((value) => {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}, "must be a valid https URL");
const marketplaceScreenshotSchema = z
  .string()
  .min(1)
  .regex(
    SCREENSHOT_URL_PATTERN,
    "must be an https URL or relative .png, .jpg, .jpeg, or .webp asset",
  );

function marketplaceIconSchema(strict: boolean) {
  const url = z
    .string()
    .min(1)
    .regex(
      strict ? ICON_URL_PATTERN : V2_ICON_URL_PATTERN,
      "must be an https URL or relative .svg, .png, or .webp asset",
    );
  const object = z.object({ url });
  return z.union([
    z.string().regex(HOST_ICON_PATTERN),
    strict ? object.strict() : object,
  ]);
}

function marketplaceAuthorSchema(strict: boolean) {
  const object = z.object({
    name: z.string().min(1),
    github: z.string().regex(GITHUB_LOGIN_PATTERN).optional(),
    url: (strict ? httpsUrlSchema : validHttpsUrlSchema).optional(),
  });
  return strict ? object.strict() : object;
}

function marketplaceNpmSourceSchema(strict: boolean) {
  const npm = z
    .object({
      package: z
        .string()
        .regex(NPM_PACKAGE_PATTERN, "must be an unambiguous npm package name"),
      range: (strict ? semverRangeSchema : semverRangeV2Schema).optional(),
      tag: z
        .string()
        .regex(/^[A-Za-z][A-Za-z0-9._-]*$/u)
        .optional(),
      registry: (strict ? httpsUrlSchema : validHttpsUrlSchema).optional(),
    })
    .refine((value) => value.range === undefined || value.tag === undefined, {
      message: "range and tag are mutually exclusive",
    });
  const nested = strict ? npm.strict() : npm;
  const object = z.object({ npm: nested });
  return strict ? object.strict() : object;
}

function marketplaceGitSourceSchema(strict: boolean) {
  const base = {
    url: strict ? httpsUrlSchema : validHttpsUrlSchema,
    subdir: z.string().regex(GIT_SUBDIR_PATTERN).optional(),
  };
  const ref = z.object({
    ...base,
    ref: z
      .string()
      .regex(GIT_REF_PATTERN, "git ref must round-trip through install syntax"),
  });
  const range = z.object({
    ...base,
    range: strict ? semverRangeSchema : semverRangeV2Schema,
    tagPrefix: z.string().max(128).regex(GIT_TAG_PREFIX_PATTERN).optional(),
  });
  const refObject = z.object({ git: strict ? ref.strict() : ref });
  const rangeObject = z.object({ git: strict ? range.strict() : range });
  return z.union([
    strict ? refObject.strict() : refObject,
    strict ? rangeObject.strict() : rangeObject,
  ]);
}

function marketplaceSourceSchema(strict: boolean) {
  const source = z.union([
    marketplaceNpmSourceSchema(strict),
    marketplaceGitSourceSchema(strict),
  ]);
  if (strict) return source;
  return z.preprocess((input, ctx) => {
    rejectKeyConflicts(input, [["npm", "git"]], ctx);
    if (typeof input === "object" && input !== null && "git" in input) {
      rejectKeyConflicts(
        input.git,
        [
          ["ref", "range"],
          ["ref", "tagPrefix"],
        ],
        ctx,
      );
    }
    return input;
  }, source);
}

const marketplaceEntryIdentityShape = (strict: boolean) => ({
  id: z.string().regex(NAME_PATTERN),
  displayName: z.string().min(1),
  description: z.string().min(1),
  icon: marketplaceIconSchema(strict),
});

const marketplaceEntryMetadataShape = (strict: boolean) => ({
  tags: z.array(z.string().max(32).regex(TAG_PATTERN)).max(10).optional(),
  author: marketplaceAuthorSchema(strict),
  source: marketplaceSourceSchema(strict),
});

export const marketplaceEntryV1Schema = z
  .object({
    ...marketplaceEntryIdentityShape(true),
    ...marketplaceEntryMetadataShape(true),
  })
  .strict();

export const marketplaceEntryV2Schema = z.object({
  ...marketplaceEntryIdentityShape(false),
  category: pluginCatalogCategoryIdSchema.optional(),
  screenshots: z
    .array(marketplaceScreenshotSchema)
    .max(MARKETPLACE_MAX_SCREENSHOTS)
    .optional(),
  publishedAt: z.iso.datetime({ offset: true }).optional(),
  updatedAt: z.iso.datetime({ offset: true }).optional(),
  ...marketplaceEntryMetadataShape(false),
});

export type MarketplaceEntryV1 = z.infer<typeof marketplaceEntryV1Schema>;
export type MarketplaceEntryV2 = z.infer<typeof marketplaceEntryV2Schema>;
export type MarketplaceEntrySource = MarketplaceEntryV1["source"];
