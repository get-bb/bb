import { readFile, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import {
  CORE_PLUGIN_DIRECTORIES,
  derivePluginId,
  PLUGIN_CATALOG_CATEGORIES,
  pluginPackageJsonSchema,
} from "@bb/domain";
import {
  classifyListingIcon,
  compareVersions,
  imageFormatForPath,
  keywordsToTags,
  LISTING_ICON_MAX_BYTES,
  LISTING_KEYWORD,
  LISTING_OVERVIEW_MAX_BYTES,
  LISTING_TOPIC,
  normalizeGitHubSourceUrl,
  normalizeOverviewText,
  overviewMarkdownProblems,
  parseBbMarketplace,
  parseGitHubRemote,
  releaseTags,
  screenshotDataProblems,
  type GitHubRepository,
  type ReleaseTag,
} from "./listing-rules.js";

export const MARKETPLACE_CATALOG_URL =
  "https://getbb.app/marketplace/v2/marketplace.json";
export const LISTING_REPORT_URL =
  "https://getbb.app/marketplace/index/v1/report.json";
export const LISTING_REPORT_BUCKET_URL =
  "https://getbb.app/marketplace/v1/index/v1/report.json";
export const RESERVED_PLUGIN_IDS_URL =
  "https://raw.githubusercontent.com/get-bb/marketplace/main/reserved-plugin-ids.json";
export const LISTING_REFRESH_MINUTES = 30;

export type PublishCheckCode =
  | "no-release-tag"
  | "no-manifest"
  | "invalid-manifest"
  | "missing-category"
  | "unknown-category"
  | "invalid-screenshot"
  | "invalid-overview"
  | "invalid-icon"
  | "id-claimed"
  | "id-reserved"
  | "blocked"
  | "fork"
  | "archived"
  | "deprecated"
  | "not-opted-in"
  | "not-public"
  | "no-github-remote"
  | "private-package"
  | "overview-missing"
  | "keywords-dropped"
  | "uncommitted-changes"
  | "release-behind-head"
  | "version-mismatch"
  | "version-published"
  | "replaces-listing"
  | "last-crawl"
  | "offline";

export type PublishCheckSeverity = "error" | "warning" | "info";

export interface PublishCheckFinding {
  severity: PublishCheckSeverity;
  code: PublishCheckCode;
  message: string;
}

export type PublishSourceKind = "github" | "npm";

export interface PublishCheckListing {
  id: string;
  packageName: string;
  version: string;
  displayName: string | null;
  description: string | null;
  category: string | null;
  secondaryCategories: string[];
  tags: string[];
  droppedKeywords: string[];
  icon: string | null;
  screenshots: string[];
  hasOverview: boolean;
}

export interface PublishCheckGitHub {
  owner: string;
  repo: string;
  subdir: string | null;
  tagPrefix: string;
  releaseTag: string | null;
  headTag: string | null;
  suggestedTag: string;
  tagPushed: boolean | null;
  hasTopic: boolean | null;
}

export interface PublishCheckNpm {
  packageName: string;
  publishedVersion: string | null;
  tarballChecked: boolean;
}

export interface PublishCheckReport {
  ok: boolean;
  directory: string;
  source: PublishSourceKind;
  sourceKey: string | null;
  listing: PublishCheckListing | null;
  github: PublishCheckGitHub | null;
  npm: PublishCheckNpm | null;
  findings: PublishCheckFinding[];
  nextSteps: string[];
  reportUrl: string;
}

export interface CommandRunResult {
  exitCode: number;
  stdout: string;
}

export interface PublishCheckEnvironment {
  run(
    command: string,
    args: readonly string[],
    cwd: string,
  ): Promise<CommandRunResult>;
  fetchJson(url: string): Promise<{ status: number; body: unknown } | null>;
}

export interface PublishCheckOptions {
  directory: string;
  source: PublishSourceKind | null;
  offline: boolean;
  environment: PublishCheckEnvironment;
}

const catalogDocumentSchema = z.object({
  categories: z.array(z.object({ id: z.string() })).optional(),
  plugins: z.array(
    z.object({
      id: z.string(),
      author: z.object({ github: z.string().optional() }).optional(),
      source: z.unknown(),
    }),
  ),
});

const catalogSourceSchema = z.union([
  z.object({
    git: z.object({ url: z.string(), subdir: z.string().optional() }),
  }),
  z.object({ npm: z.object({ package: z.string() }) }),
  z.object({ bundled: z.object({ plugin: z.string() }) }),
]);

const reservedIdsSchema = z.object({
  reservedPrefix: z.string(),
  bundledPluginIds: z.array(z.string()),
});

const listingReportSchema = z.object({
  sources: z.record(
    z.string(),
    z.object({
      status: z.string(),
      reason: z.string().optional(),
      detail: z.string().optional(),
      version: z.string().optional(),
      replaces: z.string().optional(),
      checkedAt: z.string().optional(),
    }),
  ),
});

const githubRepositorySchema = z.object({
  private: z.boolean().optional(),
  fork: z.boolean().optional(),
  archived: z.boolean().optional(),
  topics: z.array(z.string()).optional(),
});

const npmPackumentSchema = z.object({
  "dist-tags": z.record(z.string(), z.string()).optional(),
  versions: z
    .record(
      z.string(),
      z.object({
        deprecated: z.string().optional(),
        keywords: z.array(z.string()).optional(),
      }),
    )
    .optional(),
});

const npmPackSchema = z.array(
  z.object({ files: z.array(z.object({ path: z.string() })) }),
);

const collectionSchema = z.object({
  plugins: z.array(z.object({ name: z.string(), source: z.string() })),
});

const CORE_DIRECTORY_IDS: ReadonlySet<string> = new Set(
  Object.values(CORE_PLUGIN_DIRECTORIES),
);
const BUILT_IN_CATEGORY_IDS: ReadonlySet<string> = new Set(
  PLUGIN_CATALOG_CATEGORIES.map((category) => category.id),
);

class Findings {
  readonly list: PublishCheckFinding[] = [];
  error(code: PublishCheckCode, message: string): void {
    this.list.push({ severity: "error", code, message });
  }
  warning(code: PublishCheckCode, message: string): void {
    this.list.push({ severity: "warning", code, message });
  }
  info(code: PublishCheckCode, message: string): void {
    this.list.push({ severity: "info", code, message });
  }
  hasErrors(): boolean {
    return this.list.some((finding) => finding.severity === "error");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function insideDirectory(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel.length > 0 && !rel.startsWith("..") && !isAbsolute(rel);
}

function relativePluginPath(reference: string): string | null {
  if (!reference.startsWith("./")) return null;
  const path = reference.slice(2);
  if (path.length === 0 || path.split("/").some((part) => part === "..")) {
    return null;
  }
  return path;
}

async function readPluginFile(
  root: string,
  reference: string,
): Promise<{ data: Buffer; path: string } | { problem: string }> {
  const path = relativePluginPath(reference);
  if (path === null) {
    return {
      problem: `${reference} must be a path inside the plugin directory that starts with "./".`,
    };
  }
  const absolute = resolve(root, path);
  try {
    const real = await realpath(absolute);
    if (!insideDirectory(await realpath(root), real)) {
      return { problem: `${reference} resolves outside the plugin directory.` };
    }
    const info = await stat(real);
    if (!info.isFile()) return { problem: `${reference} is not a file.` };
    return { data: await readFile(real), path };
  } catch {
    return { problem: `${reference} does not exist.` };
  }
}

function packageDirectory(subdir: string | null): string {
  return subdir === null ? "" : `/${subdir}`;
}

function normalizeCollectionSource(source: string): string {
  return source.replace(/^\.\//u, "").replace(/\/+$/u, "").replace(/^\.$/u, "");
}

interface GitState {
  root: string;
  repository: GitHubRepository | null;
  remoteName: string | null;
}

async function readGitState(
  directory: string,
  environment: PublishCheckEnvironment,
): Promise<GitState | null> {
  const top = await environment.run(
    "git",
    ["rev-parse", "--show-toplevel"],
    directory,
  );
  if (top.exitCode !== 0) return null;
  const root = top.stdout.trim();
  const remotes = await environment.run("git", ["remote"], directory);
  const names = remotes.stdout
    .split("\n")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  const ordered = [
    ...names.filter((name) => name === "origin"),
    ...names.filter((name) => name !== "origin"),
  ];
  for (const name of ordered) {
    const url = await environment.run(
      "git",
      ["remote", "get-url", name],
      directory,
    );
    const repository = parseGitHubRemote(url.stdout);
    if (url.exitCode === 0 && repository !== null) {
      return { root, repository, remoteName: name };
    }
  }
  return { root, repository: null, remoteName: null };
}

function catalogSourceOwner(
  source: z.infer<typeof catalogSourceSchema>,
): string | null {
  if ("git" in source) return parseGitHubRemote(source.git.url)?.owner ?? null;
  return null;
}

function describeCatalogSource(source: unknown): string {
  const parsed = catalogSourceSchema.safeParse(source);
  if (!parsed.success) return "another source";
  if ("git" in parsed.data) {
    return `${parsed.data.git.url}${parsed.data.git.subdir === undefined ? "" : ` (${parsed.data.git.subdir})`}`;
  }
  if ("npm" in parsed.data) return `npm:${parsed.data.npm.package}`;
  return `the bundled plugin ${parsed.data.bundled.plugin}`;
}

function npmRepositoryUrl(manifest: Record<string, unknown>): string | null {
  const repository = manifest.repository;
  if (typeof repository === "string") return repository;
  if (isRecord(repository) && typeof repository.url === "string") {
    return repository.url;
  }
  return null;
}

export async function runPublishCheck(
  options: PublishCheckOptions,
): Promise<PublishCheckReport> {
  const { environment, offline } = options;
  const directory = resolve(options.directory);
  const findings = new Findings();
  const nextSteps: string[] = [];
  const fail = (source: PublishSourceKind): PublishCheckReport => ({
    ok: false,
    directory,
    source,
    sourceKey: null,
    listing: null,
    github: null,
    npm: null,
    findings: findings.list,
    nextSteps: [
      "Fix the errors above, then run `bb plugin publish --check` again.",
    ],
    reportUrl: LISTING_REPORT_URL,
  });

  let raw: string;
  try {
    raw = await readFile(join(directory, "package.json"), "utf8");
  } catch {
    findings.error(
      "no-manifest",
      `${join(directory, "package.json")} does not exist. Run the check in a plugin directory.`,
    );
    return fail(options.source ?? "github");
  }
  let manifest: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) throw new Error("not an object");
    manifest = parsed;
  } catch {
    findings.error("invalid-manifest", "package.json is not a JSON object.");
    return fail(options.source ?? "github");
  }

  const packageResult = pluginPackageJsonSchema.safeParse(manifest);
  if (!packageResult.success) {
    for (const issue of packageResult.error.issues) {
      const path = issue.path.join(".");
      findings.error(
        "invalid-manifest",
        `package.json ${path.length === 0 ? "" : `${path}: `}${issue.message}`,
      );
    }
  }
  const packageName =
    typeof manifest.name === "string" ? manifest.name.trim() : "";
  const version =
    typeof manifest.version === "string" ? manifest.version.trim() : "";
  const bb = isRecord(manifest.bb) ? manifest.bb : {};
  const displayName =
    typeof bb.name === "string" && bb.name.trim().length > 0 ? bb.name : null;
  const description =
    typeof bb.description === "string" && bb.description.trim().length > 0
      ? bb.description
      : null;

  let id: string | null = null;
  if (packageName.length > 0) {
    try {
      id = derivePluginId(packageName);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const base = packageName.split("/").at(-1) ?? packageName;
      const stripped = base.replace(/^bb-plugin-/u, "").toLowerCase();
      findings.error(
        CORE_DIRECTORY_IDS.has(stripped) ? "id-reserved" : "invalid-manifest",
        message,
      );
    }
  }
  if (id !== null && id.startsWith("bb--")) {
    findings.error(
      "id-reserved",
      `The id "${id}" starts with "bb--", which is reserved for plugins bundled with BB. Rename the package.`,
    );
  }

  let categoryIds = BUILT_IN_CATEGORY_IDS;
  let catalog: z.infer<typeof catalogDocumentSchema> | null = null;
  let reserved: z.infer<typeof reservedIdsSchema> | null = null;
  if (offline) {
    findings.info(
      "offline",
      "Skipped the online checks: the live catalog, reserved ids, the GitHub repository, and the npm registry.",
    );
  } else {
    const [catalogResponse, reservedResponse] = await Promise.all([
      environment.fetchJson(MARKETPLACE_CATALOG_URL),
      environment.fetchJson(RESERVED_PLUGIN_IDS_URL),
    ]);
    const parsedCatalog =
      catalogResponse?.status === 200
        ? catalogDocumentSchema.safeParse(catalogResponse.body)
        : null;
    if (parsedCatalog?.success === true) {
      catalog = parsedCatalog.data;
      const live = catalog.categories?.map((category) => category.id) ?? [];
      if (live.length > 0) categoryIds = new Set(live);
    } else {
      findings.warning(
        "offline",
        `Could not read the live catalog (${MARKETPLACE_CATALOG_URL}), so the id and categories were checked against this bb's built-in list only.`,
      );
    }
    const parsedReserved =
      reservedResponse?.status === 200
        ? reservedIdsSchema.safeParse(reservedResponse.body)
        : null;
    if (parsedReserved?.success === true) reserved = parsedReserved.data;
  }
  if (id !== null && reserved !== null) {
    if (id.startsWith(reserved.reservedPrefix) && !id.startsWith("bb--")) {
      findings.error(
        "id-reserved",
        `The id "${id}" starts with "${reserved.reservedPrefix}", which is reserved for plugins bundled with BB.`,
      );
    } else if (reserved.bundledPluginIds.includes(id)) {
      findings.error(
        "id-reserved",
        `The id "${id}" belongs to a plugin bundled with BB. Rename the package so the plugin gets a different id.`,
      );
    }
  }

  const marketplace = parseBbMarketplace(manifest.bbMarketplace, categoryIds);
  for (const problem of marketplace.problems) {
    if (problem.severity === "error") {
      findings.error(problem.code, problem.message);
    } else {
      findings.warning(problem.code, problem.message);
    }
  }
  if (
    manifest.bbMarketplace !== undefined &&
    isRecord(manifest.bbMarketplace) &&
    typeof manifest.bbMarketplace.category === "string" &&
    BUILT_IN_CATEGORY_IDS.has(manifest.bbMarketplace.category) &&
    !categoryIds.has(manifest.bbMarketplace.category)
  ) {
    findings.info(
      "unknown-category",
      `"${manifest.bbMarketplace.category}" is a category in this bb but not in the public marketplace.`,
    );
  }

  const screenshotPaths: string[] = [];
  for (const reference of marketplace.screenshots) {
    if (imageFormatForPath(reference) === null) {
      findings.error(
        "invalid-screenshot",
        `${reference} must be a .png, .jpg, .jpeg, or .webp file.`,
      );
      continue;
    }
    const file = await readPluginFile(directory, reference);
    if ("problem" in file) {
      findings.error("invalid-screenshot", file.problem);
      continue;
    }
    screenshotPaths.push(file.path);
    for (const problem of screenshotDataProblems(reference, file.data)) {
      findings.error("invalid-screenshot", problem);
    }
  }

  const branding = isRecord(bb.branding) ? bb.branding : {};
  const iconValue = typeof branding.icon === "string" ? branding.icon : null;
  let iconPath: string | null = null;
  if (iconValue === null) {
    findings.error(
      "invalid-icon",
      'The listing needs "bb.branding.icon": a BB icon name such as "Zap", or a relative .svg file such as "./icon.svg".',
    );
  } else {
    const icon = classifyListingIcon(iconValue);
    if (icon === null) {
      findings.error(
        "invalid-icon",
        `"bb.branding.icon" is "${iconValue}". Use a BB icon name such as "Zap", or a relative .svg, .png, or .webp path that starts with "./".`,
      );
    } else if (icon.kind === "file") {
      const file = await readPluginFile(directory, icon.path);
      if ("problem" in file) {
        findings.error("invalid-icon", file.problem);
      } else {
        iconPath = file.path;
        if (file.data.length > LISTING_ICON_MAX_BYTES) {
          findings.error(
            "invalid-icon",
            `${icon.path} is larger than 256 KiB.`,
          );
        }
      }
    }
  }

  let hasOverview = false;
  const overviewFile = await readPluginFile(directory, "./PLUGIN_OVERVIEW.md");
  if ("problem" in overviewFile) {
    findings.warning(
      "overview-missing",
      "PLUGIN_OVERVIEW.md is missing. The detail page shows only bb.description (or the overview of the entry it replaces).",
    );
  } else {
    hasOverview = true;
    const overviewProblems: string[] = [];
    if (overviewFile.data.length > LISTING_OVERVIEW_MAX_BYTES) {
      overviewProblems.push(
        `PLUGIN_OVERVIEW.md is larger than ${LISTING_OVERVIEW_MAX_BYTES} bytes.`,
      );
    } else {
      let text: string | null = null;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(
          overviewFile.data,
        );
      } catch {
        overviewProblems.push("PLUGIN_OVERVIEW.md is not UTF-8.");
      }
      if (text !== null) {
        overviewProblems.push(
          ...overviewMarkdownProblems(normalizeOverviewText(text)),
        );
      }
    }
    for (const problem of overviewProblems) {
      findings.warning(
        "invalid-overview",
        `${problem} The listing drops the overview until this is fixed.`,
      );
    }
  }

  const rawKeywords = Array.isArray(manifest.keywords) ? manifest.keywords : [];
  if (manifest.keywords !== undefined && !Array.isArray(manifest.keywords)) {
    findings.warning(
      "keywords-dropped",
      '"keywords" is not an array, so the listing gets no tags.',
    );
  }
  const { tags, dropped } = keywordsToTags(rawKeywords);
  if (dropped.length > 0) {
    findings.warning(
      "keywords-dropped",
      `These keywords do not become tags: ${dropped.map((keyword) => JSON.stringify(keyword)).join(", ")}. Tags are lowercase words joined by "-", at most 32 characters, and at most 10 of them.`,
    );
  }
  const hasKeyword = rawKeywords.some(
    (keyword) =>
      typeof keyword === "string" && keyword.toLowerCase() === LISTING_KEYWORD,
  );

  const git = await readGitState(directory, environment);
  const source: PublishSourceKind =
    options.source ?? (git?.repository != null ? "github" : "npm");

  const context: SourceCheckContext = {
    directory,
    offline,
    environment,
    findings,
    nextSteps,
    manifest,
    id,
    packageName,
    version,
    hasKeyword,
    hasOverview,
    iconPath,
    screenshotPaths,
  };
  const checked =
    source === "github"
      ? await checkGitHubSource(context, git)
      : await checkNpmSource(context);
  if (id !== null && catalog !== null) {
    checkCatalogClaim(findings, catalog, id, packageName, source, checked);
  }
  if (!offline && checked.sourceKey !== null) {
    await reportLastCrawl(findings, environment, checked.sourceKey);
  }
  const sourceKey = checked.sourceKey;
  const githubReport = checked.github;
  const npmReport = checked.npm;

  const hasErrors = findings.hasErrors();
  if (hasErrors) {
    nextSteps.unshift(
      "Fix the errors above, then run `bb plugin publish --check` again.",
    );
  }
  nextSteps.push(
    `The listing appears on https://getbb.app/marketplace within about ${LISTING_REFRESH_MINUTES} minutes. Check its status${sourceKey === null ? "" : ` under "${sourceKey}"`} in ${LISTING_REPORT_URL}.`,
  );

  return {
    ok: !hasErrors,
    directory,
    source,
    sourceKey,
    listing:
      id === null
        ? null
        : {
            id,
            packageName,
            version,
            displayName,
            description,
            category: marketplace.category,
            secondaryCategories: marketplace.secondaryCategories,
            tags,
            droppedKeywords: dropped,
            icon: iconValue,
            screenshots: marketplace.screenshots,
            hasOverview,
          },
    github: githubReport,
    npm: npmReport,
    findings: findings.list,
    nextSteps,
    reportUrl: LISTING_REPORT_URL,
  };
}

function safeJson<T>(text: string, schema: z.ZodType<T>): T | null {
  try {
    const parsed = schema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function readGitHubRepository(
  repository: GitHubRepository,
  directory: string,
  environment: PublishCheckEnvironment,
): Promise<z.infer<typeof githubRepositorySchema> | "not-found" | null> {
  const path = `repos/${repository.owner}/${repository.repo}`;
  const viaGh = await environment.run("gh", ["api", path], directory);
  if (viaGh.exitCode === 0) {
    return safeJson(viaGh.stdout, githubRepositorySchema);
  }
  const response = await environment.fetchJson(
    `https://api.github.com/${path}`,
  );
  if (response === null) return null;
  if (response.status === 404) return "not-found";
  if (response.status !== 200) return null;
  const parsed = githubRepositorySchema.safeParse(response.body);
  return parsed.success ? parsed.data : null;
}

interface SourceCheckContext {
  directory: string;
  offline: boolean;
  environment: PublishCheckEnvironment;
  findings: Findings;
  nextSteps: string[];
  manifest: Record<string, unknown>;
  id: string | null;
  packageName: string;
  version: string;
  hasKeyword: boolean;
  hasOverview: boolean;
  iconPath: string | null;
  screenshotPaths: readonly string[];
}

interface CheckedSource {
  sourceKey: string | null;
  sourceOwner: string | null;
  normalizedGitUrl: string | null;
  subdir: string | null;
  github: PublishCheckGitHub | null;
  npm: PublishCheckNpm | null;
}

async function checkGitHubSource(
  context: SourceCheckContext,
  git: GitState | null,
): Promise<CheckedSource> {
  const { directory, offline, environment, findings, nextSteps, id, version } =
    context;
  let githubReport: PublishCheckGitHub | null = null;
  let sourceKey: string | null = null;
  let sourceOwner: string | null = null;
  let normalizedGitUrl: string | null = null;
  let subdir: string | null = null;
  if (git === null || git.repository === null) {
    findings.error(
      "no-github-remote",
      git === null
        ? "This directory is not in a git repository. Publish it to a public GitHub repository, or check it for npm with --source npm."
        : "This repository has no github.com remote. The crawler reads public GitHub repositories only; use --source npm for an npm package.",
    );
  } else {
    const { owner, repo } = git.repository;
    sourceOwner = owner;
    normalizedGitUrl = `https://github.com/${owner}/${repo}.git`.toLowerCase();
    const rel = relative(await realpath(git.root), await realpath(directory));
    subdir = rel.length === 0 ? null : rel.split(sep).join("/");
    sourceKey = `github:${owner}/${repo}${packageDirectory(subdir)}`;

    let collection: z.infer<typeof collectionSchema> | null = null;
    try {
      const parsed = collectionSchema.safeParse(
        JSON.parse(
          await readFile(join(git.root, ".bb", "plugins.json"), "utf8"),
        ),
      );
      collection = parsed.success ? parsed.data : null;
      if (!parsed.success) {
        findings.error(
          "no-manifest",
          ".bb/plugins.json is not a valid collection manifest, so the crawler cannot find the plugins in this repository.",
        );
      }
    } catch {
      collection = null;
    }
    if (collection !== null) {
      const listed = collection.plugins.some(
        (entry) => normalizeCollectionSource(entry.source) === (subdir ?? ""),
      );
      if (!listed) {
        findings.error(
          "no-manifest",
          `.bb/plugins.json does not list ${subdir === null ? "the repository root" : `./${subdir}`}. The crawler reads only the directories it lists.`,
        );
      }
    } else if (subdir !== null) {
      findings.error(
        "no-manifest",
        `This plugin is in ${subdir}/, but the repository has no .bb/plugins.json. Without one, the crawler reads only the repository root. Add the directory to .bb/plugins.json.`,
      );
    }

    const tagList = await environment.run("git", ["tag", "--list"], directory);
    const allTags = tagList.stdout
      .split("\n")
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0);
    const prefixes =
      subdir === null
        ? [""]
        : [`${basename(subdir)}/`, ...(id === null ? [] : [`${id}/`])];
    let tagPrefix = prefixes[0] ?? "";
    let qualifying: ReleaseTag[] = [];
    let bare: ReleaseTag[] = [];
    for (const prefix of prefixes) {
      const found = releaseTags(allTags, prefix);
      if (found.length > 0) {
        tagPrefix = prefix;
        qualifying = found;
        bare = releaseTags(allTags, prefix, "bare");
        break;
      }
    }
    if (qualifying.length === 0) {
      for (const prefix of prefixes) {
        const found = releaseTags(allTags, prefix, "bare");
        if (found.length > 0) {
          tagPrefix = prefix;
          bare = found;
          break;
        }
      }
    }
    const atHead = await environment.run(
      "git",
      ["tag", "--points-at", "HEAD"],
      directory,
    );
    const headTags = new Set(
      atHead.stdout
        .split("\n")
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0),
    );
    const latest = qualifying[0] ?? null;
    const headRelease =
      qualifying.find((release) => headTags.has(release.tag)) ?? null;
    const suggestedTag = `${tagPrefix}v${version.length > 0 ? version : "0.1.0"}`;
    const suggestedExists = allTags.includes(suggestedTag);

    const bareAtHead =
      headRelease === null
        ? (bare.find((release) => headTags.has(release.tag)) ?? null)
        : null;
    const newestBare = bare[0] ?? null;
    const bareHint = (release: ReleaseTag) =>
      `${release.tag} has no "v". bb installs only tags named ${tagPrefix}vX.Y.Z, so the crawler ignores it. Tag ${tagPrefix}v${release.version} instead.`;
    if (latest === null) {
      const ignored = bareAtHead ?? newestBare;
      findings.warning(
        "no-release-tag",
        ignored === null
          ? `No release tag yet. The crawler lists a GitHub plugin only from a tag named ${tagPrefix}vX.Y.Z.`
          : bareHint(ignored),
      );
    } else if (bareAtHead !== null) {
      findings.warning(
        "no-release-tag",
        `${bareHint(bareAtHead)} Until then the listing shows ${latest.tag}.`,
      );
    } else if (
      newestBare !== null &&
      compareVersions(newestBare.version, latest.version) > 0
    ) {
      findings.warning(
        "no-release-tag",
        `${bareHint(newestBare)} Until then the listing shows ${latest.tag}.`,
      );
    } else if (headRelease === null) {
      findings.warning(
        "release-behind-head",
        `HEAD is not tagged. The listing shows ${latest.tag}, the newest release tag, and reads its metadata from that tag, not from this working tree.`,
      );
    }
    if (headRelease !== null && headRelease.version !== version) {
      findings.warning(
        "version-mismatch",
        `HEAD is tagged ${headRelease.tag}, but package.json says version ${version}.`,
      );
    }
    if (
      headRelease === null &&
      latest !== null &&
      version.length > 0 &&
      compareVersions(version, latest.version) <= 0
    ) {
      findings.warning(
        "version-mismatch",
        `package.json version ${version} is not newer than the latest release ${latest.tag}. Raise the version before you tag.`,
      );
    }

    const status = await environment.run(
      "git",
      ["status", "--porcelain", "--", "."],
      directory,
    );
    if (status.exitCode === 0 && status.stdout.trim().length > 0) {
      findings.warning(
        "uncommitted-changes",
        "The plugin directory has uncommitted changes. The crawler reads the tagged commit, so commit them before you tag.",
      );
    }

    let tagPushed: boolean | null = null;
    let hasTopic: boolean | null = null;
    const releaseToPush = headRelease ?? null;
    if (!offline) {
      if (releaseToPush !== null && git.remoteName !== null) {
        const remoteTags = await environment.run(
          "git",
          [
            "ls-remote",
            "--tags",
            git.remoteName,
            `refs/tags/${releaseToPush.tag}`,
          ],
          directory,
        );
        if (remoteTags.exitCode === 0) {
          tagPushed = remoteTags.stdout.trim().length > 0;
        }
      }
      const repository = await readGitHubRepository(
        git.repository,
        directory,
        environment,
      );
      if (repository === "not-found") {
        findings.error(
          "not-public",
          `github.com/${owner}/${repo} does not exist or is not public. The crawler reads public repositories only.`,
        );
      } else if (repository !== null) {
        if (repository.private === true) {
          findings.error(
            "not-public",
            `github.com/${owner}/${repo} is private. The crawler reads public repositories only.`,
          );
        }
        if (repository.fork === true) {
          findings.error(
            "fork",
            `github.com/${owner}/${repo} is a fork. The crawler skips forks; publish from your own repository.`,
          );
        }
        if (repository.archived === true) {
          findings.error(
            "archived",
            `github.com/${owner}/${repo} is archived. The crawler skips archived repositories.`,
          );
        }
        hasTopic = (repository.topics ?? []).includes(LISTING_TOPIC);
        if (!hasTopic) {
          findings.warning(
            "not-opted-in",
            `github.com/${owner}/${repo} does not have the topic "${LISTING_TOPIC}" yet.`,
          );
        }
      }
    }

    githubReport = {
      owner,
      repo,
      subdir,
      tagPrefix,
      releaseTag: latest?.tag ?? null,
      headTag: headRelease?.tag ?? null,
      suggestedTag,
      tagPushed,
      hasTopic,
    };

    if (hasTopic !== true) {
      nextSteps.push(
        `Add the topic "${LISTING_TOPIC}" to the repository: gh repo edit ${owner}/${repo} --add-topic ${LISTING_TOPIC} (or Settings → Topics on github.com).`,
      );
    }
    if (headRelease === null) {
      if (suggestedExists) {
        nextSteps.push(
          `Raise "version" in package.json (the tag ${suggestedTag} already exists), commit, then tag the release: git tag ${tagPrefix}vX.Y.Z`,
        );
      } else {
        nextSteps.push(
          `Commit your changes, then tag the release: git tag ${suggestedTag}`,
        );
      }
      nextSteps.push(
        `Push the commit and the tag: git push ${git.remoteName ?? "origin"} HEAD ${suggestedExists ? `${tagPrefix}vX.Y.Z` : suggestedTag}`,
      );
    } else if (tagPushed !== true) {
      nextSteps.push(
        `Push the tag${tagPushed === null ? " if you have not yet" : ""}: git push ${git.remoteName ?? "origin"} ${headRelease.tag}`,
      );
    }
  }
  return {
    sourceKey,
    sourceOwner,
    normalizedGitUrl,
    subdir,
    github: githubReport,
    npm: null,
  };
}

async function checkNpmSource(
  context: SourceCheckContext,
): Promise<CheckedSource> {
  const {
    directory,
    offline,
    environment,
    findings,
    nextSteps,
    manifest,
    packageName,
    version,
    hasKeyword,
    hasOverview,
    iconPath,
    screenshotPaths,
  } = context;
  let npmReport: PublishCheckNpm | null = null;
  let sourceKey: string | null = null;
  let sourceOwner: string | null = null;
  sourceKey = packageName.length > 0 ? `npm:${packageName}` : null;
  const repositoryUrl = npmRepositoryUrl(manifest);
  const repository =
    repositoryUrl === null ? null : parseGitHubRemote(repositoryUrl);
  sourceOwner = repository?.owner ?? null;
  if (manifest.private === true) {
    findings.error(
      "private-package",
      'package.json has "private": true, so npm will not publish it.',
    );
  }
  if (!hasKeyword) {
    findings.warning(
      "not-opted-in",
      `package.json "keywords" does not include "${LISTING_KEYWORD}".`,
    );
  }

  let tarballChecked = false;
  const pack = await environment.run(
    "npm",
    ["pack", "--dry-run", "--json", "--ignore-scripts"],
    directory,
  );
  const packed =
    pack.exitCode === 0 ? safeJson(pack.stdout, npmPackSchema) : null;
  if (packed === null) {
    findings.warning(
      "no-manifest",
      "`npm pack --dry-run` failed, so the tarball contents were not checked.",
    );
  } else {
    tarballChecked = true;
    const files = new Set(
      packed.flatMap((entry) => entry.files.map((file) => file.path)),
    );
    if (hasOverview && !files.has("PLUGIN_OVERVIEW.md")) {
      findings.warning(
        "invalid-overview",
        'PLUGIN_OVERVIEW.md is not in the npm tarball, so the listing has no overview. Add it to "files" in package.json.',
      );
    }
    if (iconPath !== null && !files.has(iconPath)) {
      findings.error(
        "invalid-icon",
        `${iconPath} is not in the npm tarball. Add it to "files" in package.json.`,
      );
    }
    for (const path of screenshotPaths) {
      if (!files.has(path)) {
        findings.error(
          "invalid-screenshot",
          `${path} is not in the npm tarball. Add it to "files" in package.json.`,
        );
      }
    }
  }

  let publishedVersion: string | null = null;
  if (!offline && packageName.length > 0) {
    const response = await environment.fetchJson(
      `https://registry.npmjs.org/${packageName.replace("/", "%2f")}`,
    );
    const packument =
      response?.status === 200
        ? npmPackumentSchema.safeParse(response.body)
        : null;
    if (packument?.success === true) {
      publishedVersion = packument.data["dist-tags"]?.latest ?? null;
      const latest =
        publishedVersion === null
          ? undefined
          : packument.data.versions?.[publishedVersion];
      if (latest?.deprecated !== undefined) {
        findings.warning(
          "deprecated",
          `The latest published version ${publishedVersion} is deprecated, so the crawler skips the package until you publish a version that is not.`,
        );
      }
      if (
        packument.data.versions !== undefined &&
        version.length > 0 &&
        Object.hasOwn(packument.data.versions, version)
      ) {
        findings.warning(
          "version-published",
          `Version ${version} is already on npm. Raise "version" in package.json before you publish.`,
        );
      }
    }
  }

  npmReport = { packageName, publishedVersion, tarballChecked };
  if (!hasKeyword) {
    nextSteps.push(`Add "${LISTING_KEYWORD}" to "keywords" in package.json.`);
  }
  nextSteps.push(
    "Build and publish the package: bb plugin build && npm publish",
  );
  return {
    sourceKey,
    sourceOwner,
    normalizedGitUrl: null,
    subdir: null,
    github: null,
    npm: npmReport,
  };
}

function checkCatalogClaim(
  findings: Findings,
  catalog: z.infer<typeof catalogDocumentSchema>,
  id: string,
  packageName: string,
  source: PublishSourceKind,
  checked: CheckedSource,
): void {
  const { normalizedGitUrl, subdir, sourceOwner } = checked;
  const held = catalog.plugins.find((entry) => entry.id === id);
  if (held !== undefined) {
    const heldSource = catalogSourceSchema.safeParse(held.source);
    const sameSource =
      heldSource.success &&
      (("git" in heldSource.data &&
        normalizedGitUrl !== null &&
        normalizeGitHubSourceUrl(heldSource.data.git.url) ===
          normalizedGitUrl &&
        (heldSource.data.git.subdir ?? null) === subdir) ||
        ("npm" in heldSource.data &&
          source === "npm" &&
          heldSource.data.npm.package === packageName));
    const heldOwner =
      held.author?.github ??
      (heldSource.success ? catalogSourceOwner(heldSource.data) : null);
    const sameOwner =
      sourceOwner !== null &&
      heldOwner !== null &&
      heldOwner.toLowerCase() === sourceOwner.toLowerCase();
    if (heldSource.success && "bundled" in heldSource.data) {
      findings.error(
        "id-reserved",
        `The id "${id}" belongs to a plugin bundled with BB. Rename the package.`,
      );
    } else if (sameSource || sameOwner) {
      findings.info(
        "replaces-listing",
        `"${id}" is already listed from ${describeCatalogSource(held.source)}. ${sameSource ? "It is the same source" : `It belongs to the same GitHub owner (${heldOwner})`}, so your self-published listing replaces it. The category, icon, screenshots, and overview of the old entry carry over only where your release has none. No pull request to get-bb/marketplace is needed.`,
      );
    } else {
      findings.error(
        "id-claimed",
        `The id "${id}" is already listed from ${describeCatalogSource(held.source)}. Rename the package so the plugin gets a different id.`,
      );
    }
  }
}

async function reportLastCrawl(
  findings: Findings,
  environment: PublishCheckEnvironment,
  sourceKey: string,
): Promise<void> {
  const primary = await environment.fetchJson(LISTING_REPORT_URL);
  const response =
    primary?.status === 200
      ? primary
      : await environment.fetchJson(LISTING_REPORT_BUCKET_URL);
  const report =
    response?.status === 200
      ? listingReportSchema.safeParse(response.body)
      : null;
  const verdict =
    report?.success === true ? report.data.sources[sourceKey] : undefined;
  if (verdict !== undefined) {
    const detail = [
      verdict.status,
      verdict.version,
      verdict.reason,
      verdict.detail,
      verdict.replaces === undefined
        ? undefined
        : `replaces the ${verdict.replaces} entry`,
    ]
      .filter((part): part is string => part !== undefined)
      .join(", ");
    findings.info(
      "last-crawl",
      `The last crawl${verdict.checkedAt === undefined ? "" : ` (${verdict.checkedAt})`} says: ${detail}.`,
    );
  }
}
