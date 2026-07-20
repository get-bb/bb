import type { Hono } from "hono";
import { ApiError } from "../errors.js";
import type { AppDeps } from "../types.js";
import { requirePublicProject } from "../services/lib/entity-lookup.js";
import { installServerRegistrySkill } from "../services/skills/registry-skill-install.js";

const SKILLS_BASE_URL = "https://www.skills.sh";
const DEFAULT_PAGE_SIZE = 24;
const MAX_PAGE = 100_000;
const MAX_PAGE_SIZE = 100;
const MAX_SEARCH_RESULTS = 200;
const DETAIL_PREVIEW_LIMIT = 10;
const GITHUB_STARS_PREVIEW_LIMIT = 48;
const GITHUB_STARS_CACHE_TTL_MS = 30 * 60 * 1000;
const REGISTRY_FETCH_TIMEOUT_MS = 10_000;
const REGISTRY_FETCH_CONCURRENCY = 6;
const REGISTRY_DETAIL_FILE_LIMIT = 200;
const REGISTRY_DETAIL_FILE_SIZE_LIMIT = 1_000_000;
const REGISTRY_DETAIL_TOTAL_SIZE_LIMIT = 5_000_000;
const REGISTRY_SKILL_NAME_PATTERN =
  /^(?!.*--)[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u;
const REGISTRY_SOURCE_PATTERN = /^(?!-)\S+$/u;

interface RegistrySkill {
  id: string;
  source: string;
  skillId: string;
  name: string;
  installs: number;
  stars: number | null;
  installUrl: string | null;
  url: string;
  topic: string | null;
  summary: string | null;
}

interface RegistryPagination {
  page: number;
  perPage: number;
  total: number;
  hasMore: boolean;
}

interface RegistrySkillsPage {
  skills: RegistrySkill[];
  pagination: RegistryPagination;
}

interface SkillsApiSkill {
  id: string;
  slug: string;
  name: string;
  source: string;
  installs: number;
  installUrl: string | null;
  url: string;
}

interface SkillsApiPage {
  skills: SkillsApiSkill[];
  total: number;
  hasMore: boolean;
}

interface RegistrySkillFile {
  path: string;
  contents: string;
}

interface RegistrySkillDetail {
  id: string;
  source: string;
  skillId: string;
  hash: string | null;
  files: RegistrySkillFile[] | null;
}

const githubStarsCache = new Map<
  string,
  { stars: number | null; expiresAt: number }
>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function decodeHtml(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&#39;", "'");
}

function stripTags(value: string): string {
  return decodeHtml(value.replace(/<[^>]*>/gu, " "))
    .replace(/\s+/gu, " ")
    .trim();
}

function registrySkillUrl(id: string): string {
  return `${SKILLS_BASE_URL}/${id
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;
}

function registryFetch(
  input: string | URL,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(input, {
    ...init,
    signal: AbortSignal.timeout(REGISTRY_FETCH_TIMEOUT_MS),
  });
}

function parsePublicHomepageSkills(html: string): RegistrySkill[] {
  const byId = new Map<string, RegistrySkill>();
  const pattern =
    /\\"source\\":\\"([^"\\]+)\\",\\"skillId\\":\\"([^"\\]+)\\",\\"name\\":\\"([^"\\]+)\\",\\"installs\\":(\d+)/gu;
  for (const match of html.matchAll(pattern)) {
    const source = match[1];
    const skillId = match[2];
    const name = match[3];
    const installs = Number(match[4]);
    if (!source || !skillId || !name || !Number.isFinite(installs)) continue;
    const id = `${source}/${skillId}`;
    if (byId.has(id)) continue;
    byId.set(id, {
      id,
      source,
      skillId,
      name,
      installs,
      stars: null,
      installUrl: source.includes(".")
        ? `https://${source}`
        : `https://github.com/${source}`,
      url: registrySkillUrl(id),
      topic: null,
      summary: null,
    });
  }
  return [...byId.values()];
}

function parsePublicDetail(
  html: string,
): Pick<RegistrySkill, "topic" | "summary"> {
  const topic = html.match(/href="\/topic\/[^"]+">([^<]+)</u)?.[1] ?? null;
  const summarySection = html.match(
    /Summary<\/div>(?<summary>[\s\S]*?)SKILL\.md/u,
  )?.groups?.summary;
  const summary =
    summarySection === undefined
      ? null
      : stripTags(summarySection)
          .replace(/\bShow more\b$/u, "")
          .trim();
  return {
    topic: topic === null ? null : decodeHtml(topic),
    summary: summary && summary.length > 0 ? summary.slice(0, 280) : null,
  };
}

function parsePublicDetailSkill(
  html: string,
  id: string,
  source: string,
  skillId: string,
): RegistrySkill | null {
  const scripts = html.matchAll(
    /<script type="application\/ld\+json">(?<json>[\s\S]*?)<\/script>/gu,
  );
  for (const match of scripts) {
    const body: unknown = JSON.parse(match.groups?.json ?? "null");
    if (
      !isRecord(body) ||
      body["@type"] !== "SoftwareApplication" ||
      body.url !== registrySkillUrl(id) ||
      typeof body.name !== "string" ||
      !isRecord(body.interactionStatistic) ||
      typeof body.interactionStatistic.userInteractionCount !== "number"
    ) {
      continue;
    }
    const detail = parsePublicDetail(html);
    return {
      id,
      source,
      skillId,
      name: body.name,
      installs: body.interactionStatistic.userInteractionCount,
      stars: null,
      installUrl: null,
      url: registrySkillUrl(id),
      topic: detail.topic,
      summary:
        typeof body.description === "string"
          ? body.description.slice(0, 280)
          : detail.summary,
    };
  }
  return null;
}

function isApiSkill(value: unknown): value is SkillsApiSkill {
  if (typeof value !== "object" || value === null) return false;
  const skill = value as Record<string, unknown>;
  return (
    typeof skill.id === "string" &&
    typeof skill.slug === "string" &&
    typeof skill.name === "string" &&
    typeof skill.source === "string" &&
    typeof skill.installs === "number" &&
    (skill.installUrl === null || typeof skill.installUrl === "string") &&
    typeof skill.url === "string"
  );
}

async function fetchRegistryJson(url: URL): Promise<SkillsApiPage | null> {
  const token = process.env.VERCEL_OIDC_TOKEN;
  if (!token) return null;
  const response = await registryFetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return null;
  const body = (await response.json().catch(() => null)) as {
    data?: unknown;
    count?: unknown;
    pagination?: unknown;
  } | null;
  if (!Array.isArray(body?.data)) return null;
  const skills = body.data.filter(isApiSkill);
  const pagination = isRecord(body.pagination) ? body.pagination : null;
  const total =
    pagination && typeof pagination.total === "number"
      ? pagination.total
      : typeof body.count === "number"
        ? body.count
        : skills.length;
  const hasMore =
    pagination && typeof pagination.hasMore === "boolean"
      ? pagination.hasMore
      : false;
  return { skills, total, hasMore };
}

function parseRegistryDetailFiles(value: unknown): RegistrySkillFile[] | null {
  if (!Array.isArray(value) || value.length > REGISTRY_DETAIL_FILE_LIMIT) {
    return null;
  }
  let totalSize = 0;
  const files: RegistrySkillFile[] = [];
  for (const file of value) {
    if (
      !isRecord(file) ||
      typeof file.path !== "string" ||
      file.path.length === 0 ||
      typeof file.contents !== "string" ||
      file.contents.length > REGISTRY_DETAIL_FILE_SIZE_LIMIT
    ) {
      return null;
    }
    totalSize += file.contents.length;
    if (totalSize > REGISTRY_DETAIL_TOTAL_SIZE_LIMIT) return null;
    files.push({ path: file.path, contents: file.contents });
  }
  return files;
}

async function fetchAuthenticatedRegistryDetail(
  source: string,
  skillId: string,
): Promise<RegistrySkillDetail | null> {
  const token = process.env.VERCEL_OIDC_TOKEN;
  if (!token) return null;
  const id = `${source}/${skillId}`;
  const url = new URL(
    `/api/v1/skills/${id
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/")}`,
    SKILLS_BASE_URL,
  );
  const response = await registryFetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return null;
  const body: unknown = await response.json().catch(() => null);
  if (!isRecord(body)) return null;
  const files = parseRegistryDetailFiles(body.files);
  if (body.files !== null && files === null) return null;
  return {
    id,
    source,
    skillId,
    hash: typeof body.hash === "string" ? body.hash : null,
    files,
  };
}

async function fetchGithubSkillMarkdown(
  source: string,
  skillId: string,
): Promise<RegistrySkillFile[] | null> {
  const repo = githubRepoForSource(source);
  if (repo === null) return null;
  const candidatePaths = [
    `skills/${skillId}/SKILL.md`,
    `.agents/skills/${skillId}/SKILL.md`,
    `.claude/skills/${skillId}/SKILL.md`,
    `.github/skills/${skillId}/SKILL.md`,
    `${skillId}/SKILL.md`,
  ];
  for (const candidatePath of candidatePaths) {
    const url = `https://raw.githubusercontent.com/${repo}/HEAD/${candidatePath
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/")}`;
    try {
      const response = await registryFetch(url, {
        headers: { "user-agent": "bb-skills-registry" },
      });
      if (!response.ok) continue;
      const contents = await response.text();
      if (contents.length > REGISTRY_DETAIL_FILE_SIZE_LIMIT) return null;
      return [{ path: "SKILL.md", contents }];
    } catch {
      continue;
    }
  }
  return null;
}

async function fetchRegistrySkillDetail(
  source: string,
  skillId: string,
): Promise<RegistrySkillDetail> {
  const authenticated = await fetchAuthenticatedRegistryDetail(source, skillId);
  if (authenticated) return authenticated;
  return {
    id: `${source}/${skillId}`,
    source,
    skillId,
    hash: null,
    files: await fetchGithubSkillMarkdown(source, skillId),
  };
}

async function fetchPublicDirectorySkills(
  query: string,
  page: number,
  perPage: number,
): Promise<RegistrySkillsPage> {
  const response = await registryFetch(`${SKILLS_BASE_URL}/`);
  if (!response.ok) {
    throw new ApiError(
      503,
      "skills_registry_unavailable",
      "skills.sh is unavailable",
    );
  }
  const skills = parsePublicHomepageSkills(await response.text());
  const normalizedQuery = query.trim().toLowerCase();
  const filtered =
    normalizedQuery.length === 0
      ? skills
      : skills.filter(
          (skill) =>
            skill.name.toLowerCase().includes(normalizedQuery) ||
            skill.source.toLowerCase().includes(normalizedQuery),
        );
  const ranked = [...filtered].sort(
    (left, right) =>
      right.installs - left.installs || left.name.localeCompare(right.name),
  );
  const start = page * perPage;
  return {
    skills: ranked.slice(start, start + perPage),
    pagination: {
      page,
      perPage,
      total: ranked.length,
      hasMore: start + perPage < ranked.length,
    },
  };
}

async function hydrateDetails(
  skills: RegistrySkill[],
): Promise<RegistrySkill[]> {
  const hydrated = await Promise.all(
    skills.slice(0, DETAIL_PREVIEW_LIMIT).map(async (skill) => {
      try {
        const response = await registryFetch(skill.url);
        if (!response.ok) return skill;
        return { ...skill, ...parsePublicDetail(await response.text()) };
      } catch {
        return skill;
      }
    }),
  );
  return [...hydrated, ...skills.slice(DETAIL_PREVIEW_LIMIT)];
}

function githubRepoForSource(source: string): string | null {
  const githubHostPrefix = "github.com/";
  const githubUrlPrefix = "https://github.com/";
  const normalized = source.startsWith(githubUrlPrefix)
    ? source.slice(githubUrlPrefix.length)
    : source.startsWith(githubHostPrefix)
      ? source.slice(githubHostPrefix.length)
      : source;
  if (normalized.includes(".")) return null;

  const [owner, repo] = normalized.split("/");
  if (!owner || !repo) return null;
  const safeSegment = /^[A-Za-z0-9_.-]+$/u;
  if (!safeSegment.test(owner) || !safeSegment.test(repo)) return null;
  return `${owner}/${repo}`;
}

async function fetchGithubStars(source: string): Promise<number | null> {
  const repo = githubRepoForSource(source);
  if (repo === null) return null;

  const cached = githubStarsCache.get(repo);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.stars;

  let stars: number | null = null;
  try {
    const separatorIndex = repo.indexOf("/");
    const owner = repo.slice(0, separatorIndex);
    const repoName = repo.slice(separatorIndex + 1);
    const response = await registryFetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}`,
      {
        headers: {
          accept: "application/vnd.github+json",
          "user-agent": "bb-skills-registry",
        },
      },
    );
    if (response.ok) {
      const body = await response.json().catch(() => null);
      if (isRecord(body) && typeof body.stargazers_count === "number") {
        stars = body.stargazers_count;
      }
    }
  } catch {
    stars = null;
  }

  githubStarsCache.set(repo, {
    stars,
    expiresAt: now + GITHUB_STARS_CACHE_TTL_MS,
  });
  return stars;
}

async function mapWithConcurrency<T>(
  values: readonly T[],
  concurrency: number,
  task: (value: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (nextIndex < values.length) {
        const value = values[nextIndex];
        nextIndex += 1;
        if (value !== undefined) await task(value);
      }
    },
  );
  await Promise.all(workers);
}

async function hydrateGithubStars(
  skills: RegistrySkill[],
): Promise<RegistrySkill[]> {
  const sources = [
    ...new Set(
      skills.slice(0, GITHUB_STARS_PREVIEW_LIMIT).map((skill) => skill.source),
    ),
  ];
  const starsBySource = new Map<string, number | null>();
  await mapWithConcurrency(
    sources,
    REGISTRY_FETCH_CONCURRENCY,
    async (source) => {
      starsBySource.set(source, await fetchGithubStars(source));
    },
  );
  return skills.map((skill) =>
    starsBySource.has(skill.source)
      ? { ...skill, stars: starsBySource.get(skill.source) ?? null }
      : skill,
  );
}

async function listRegistrySkills(
  query: string,
  page: number,
  perPage: number,
): Promise<RegistrySkillsPage> {
  const normalizedQuery = query.trim();
  const apiUrl = new URL(
    normalizedQuery.length > 0 ? "/api/v1/skills/search" : "/api/v1/skills",
    SKILLS_BASE_URL,
  );
  if (normalizedQuery.length > 0) {
    apiUrl.searchParams.set("q", normalizedQuery);
    apiUrl.searchParams.set("limit", String(MAX_SEARCH_RESULTS));
  } else {
    apiUrl.searchParams.set("view", "all-time");
    apiUrl.searchParams.set("page", String(page));
    apiUrl.searchParams.set("per_page", String(perPage));
  }
  const apiPage = await fetchRegistryJson(apiUrl);
  const publicPage = apiPage
    ? null
    : await fetchPublicDirectorySkills(normalizedQuery, page, perPage);
  const mappedApiSkills =
    apiPage?.skills.map((skill) => ({
      id: skill.id,
      source: skill.source,
      skillId: skill.slug,
      name: skill.name,
      installs: skill.installs,
      stars: null,
      installUrl: skill.installUrl,
      url: skill.url,
      topic: null,
      summary: null,
    })) ?? null;
  const start = page * perPage;
  const skills =
    mappedApiSkills === null
      ? (publicPage?.skills ?? [])
      : normalizedQuery.length > 0
        ? mappedApiSkills.slice(start, start + perPage)
        : mappedApiSkills;
  const pagination =
    publicPage?.pagination ??
    ({
      page,
      perPage,
      total: apiPage?.total ?? skills.length,
      hasMore:
        normalizedQuery.length > 0
          ? start + perPage < (apiPage?.total ?? 0)
          : (apiPage?.hasMore ?? false),
    } satisfies RegistryPagination);
  const hydrated = await hydrateGithubStars(await hydrateDetails(skills));
  return { skills: hydrated, pagination };
}

function parseRegistrySkillId(id: string): { source: string; skillId: string } {
  const separatorIndex = id.lastIndexOf("/");
  const source = id.slice(0, separatorIndex);
  const skillId = id.slice(separatorIndex + 1);
  if (
    id.length === 0 ||
    id.length > 2_048 ||
    separatorIndex < 1 ||
    source.length > 2_048 ||
    !REGISTRY_SOURCE_PATTERN.test(source) ||
    !REGISTRY_SKILL_NAME_PATTERN.test(skillId)
  ) {
    throw new ApiError(
      400,
      "invalid_request",
      "Expected a valid registry skill ID",
    );
  }
  return { source, skillId };
}

async function resolveRegistrySkillById(id: string): Promise<RegistrySkill> {
  const { source, skillId } = parseRegistrySkillId(id);
  const response = await registryFetch(registrySkillUrl(id));
  if (!response.ok) {
    throw new ApiError(
      404,
      "registry_skill_not_found",
      "Registry skill not found",
    );
  }
  const html = await response.text();
  const skill = parsePublicDetailSkill(html, id, source, skillId);
  if (!skill) {
    throw new ApiError(
      404,
      "registry_skill_not_found",
      "Registry skill not found",
    );
  }
  return { ...skill, ...parsePublicDetail(html) };
}

function packageRefForSource(source: string): string {
  const githubPrefix = "github.com/";
  if (source.startsWith(githubPrefix)) return source.slice(githubPrefix.length);
  return source.includes(".") ? `https://${source}` : source;
}

function parsePageParameter(value: string | undefined): number {
  if (value === undefined) return 0;
  const page = Number(value);
  if (!/^\d+$/u.test(value) || !Number.isSafeInteger(page) || page > MAX_PAGE) {
    throw new ApiError(
      400,
      "invalid_request",
      `page must be a nonnegative integer no greater than ${MAX_PAGE}`,
    );
  }
  return page;
}

function parsePerPageParameter(value: string | undefined): number {
  if (value === undefined) return DEFAULT_PAGE_SIZE;
  if (!/^\d+$/u.test(value)) {
    throw new ApiError(
      400,
      "invalid_request",
      "perPage must be a positive integer",
    );
  }
  const perPage = Number(value);
  if (
    !Number.isSafeInteger(perPage) ||
    perPage < 1 ||
    perPage > MAX_PAGE_SIZE
  ) {
    throw new ApiError(
      400,
      "invalid_request",
      `perPage must be between 1 and ${MAX_PAGE_SIZE}`,
    );
  }
  return perPage;
}

export function registerSkillsRegistryRoutes(app: Hono, deps: AppDeps): void {
  app.get("/skills-registry", async (context) => {
    const query = context.req.query("q") ?? "";
    const page = parsePageParameter(context.req.query("page"));
    const perPage = parsePerPageParameter(context.req.query("perPage"));
    try {
      return context.json(await listRegistrySkills(query, page, perPage));
    } catch (error) {
      if (error instanceof ApiError && error.status < 500) throw error;
      deps.logger.warn(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        "skills.sh registry fetch failed",
      );
      throw new ApiError(
        503,
        "skills_registry_unavailable",
        "skills.sh is unavailable",
      );
    }
  });

  app.get("/skills-registry/entry", async (context) => {
    const id = context.req.query("id");
    if (id === undefined) {
      throw new ApiError(
        400,
        "invalid_request",
        "Expected a registry skill ID",
      );
    }
    return context.json(await resolveRegistrySkillById(id));
  });

  app.get("/skills-registry/detail", async (context) => {
    const source = context.req.query("source");
    const skillId = context.req.query("skillId");
    if (
      source === undefined ||
      source.length === 0 ||
      source.length > 2_048 ||
      !REGISTRY_SOURCE_PATTERN.test(source) ||
      skillId === undefined ||
      !REGISTRY_SKILL_NAME_PATTERN.test(skillId)
    ) {
      throw new ApiError(
        400,
        "invalid_request",
        "Expected a valid source and skillId",
      );
    }
    return context.json(await fetchRegistrySkillDetail(source, skillId));
  });

  app.post("/skills-registry/install", async (context) => {
    const body: unknown = await context.req.json().catch(() => null);
    const allowedKeys = new Set(["registrySkillId", "projectId"]);
    if (
      !isRecord(body) ||
      Object.keys(body).some((key) => !allowedKeys.has(key)) ||
      typeof body.registrySkillId !== "string" ||
      typeof body.projectId !== "string"
    ) {
      throw new ApiError(
        400,
        "invalid_request",
        "Expected registrySkillId and projectId",
      );
    }
    requirePublicProject(deps.db, body.projectId);
    const registrySkill = await resolveRegistrySkillById(body.registrySkillId);
    const result = await installServerRegistrySkill({
      dataDir: deps.config.dataDir,
      packageRef: packageRefForSource(registrySkill.source),
      skillId: registrySkill.skillId,
    });
    return context.json({ ok: true, filePath: result.filePath });
  });
}
