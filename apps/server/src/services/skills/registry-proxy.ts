import { ApiError } from "../../errors.js";
import {
  githubRepoForSource,
  hasLoadableSkillContent,
  isApiSkill,
  isRecord,
  packageRefForSource,
  parsePageParameter,
  parsePerPageParameter,
  parsePublicDetail,
  parsePublicDetailSkill,
  parsePublicHomepageSkills,
  parsePublicSkillMarkdown,
  parseRegistryDetailFiles,
  parseRegistrySkillId,
  REGISTRY_DETAIL_FILE_SIZE_LIMIT,
  REGISTRY_SKILL_NAME_PATTERN,
  REGISTRY_SOURCE_PATTERN,
  registrySkillUrl,
  SKILLS_BASE_URL,
  type RegistryPagination,
  type RegistrySkill,
  type RegistrySkillDetail,
  type RegistrySkillFile,
  type RegistrySkillsPage,
  type SkillsApiPage,
} from "./registry-parse.js";

const MAX_SEARCH_RESULTS = 200;
const DETAIL_PREVIEW_LIMIT = 10;
const GITHUB_STARS_PREVIEW_LIMIT = 48;
const GITHUB_STARS_CACHE_TTL_MS = 30 * 60 * 1000;
const GITHUB_SKILL_PATH_CACHE_TTL_MS = 30 * 60 * 1000;
const REGISTRY_DETAIL_CACHE_TTL_MS = 30 * 60 * 1000;
const REGISTRY_FETCH_TIMEOUT_MS = 10_000;
const REGISTRY_FETCH_CONCURRENCY = 6;

const githubStarsCache = new Map<
  string,
  { stars: number | null; expiresAt: number }
>();
const registryDetailCache = new Map<
  string,
  { detail: RegistrySkillDetail; expiresAt: number }
>();
const githubSkillPathCache = new Map<
  string,
  { paths: string[]; expiresAt: number }
>();
const githubSkillPathRequests = new Map<string, Promise<string[] | null>>();

export {
  hasLoadableSkillContent,
  isRecord,
  packageRefForSource,
  parsePageParameter,
  parsePerPageParameter,
  REGISTRY_SKILL_NAME_PATTERN,
  REGISTRY_SOURCE_PATTERN,
};

export function registryFetch(
  input: string | URL,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(input, {
    ...init,
    signal: AbortSignal.timeout(REGISTRY_FETCH_TIMEOUT_MS),
  });
}

export async function fetchRegistryJson(
  url: URL,
): Promise<SkillsApiPage | null> {
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

export async function fetchAuthenticatedRegistryDetail(
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

export async function fetchGithubSkillMarkdown(
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
  const candidates = await Promise.all(
    candidatePaths.map(async (candidatePath) => {
      const url = `https://raw.githubusercontent.com/${repo}/HEAD/${candidatePath
        .split("/")
        .map((segment) => encodeURIComponent(segment))
        .join("/")}`;
      try {
        const response = await registryFetch(url, {
          headers: { "user-agent": "bb-skills-registry" },
        });
        if (!response.ok) return null;
        const contents = await response.text();
        if (contents.length > REGISTRY_DETAIL_FILE_SIZE_LIMIT) return null;
        return [{ path: "SKILL.md", contents }];
      } catch {
        return null;
      }
    }),
  );
  const directMatch = candidates.find((candidate) => candidate !== null);
  if (directMatch) return directMatch;

  const repositoryPaths = await fetchGithubSkillPaths(repo);
  if (repositoryPaths === null) return null;
  const normalizedSkillId = skillId.toLowerCase();
  const nestedPath = repositoryPaths
    .filter((path) => {
      const normalizedPath = path.replaceAll("\\", "/").toLowerCase();
      return (
        normalizedPath === `${normalizedSkillId}/skill.md` ||
        normalizedPath.endsWith(`/${normalizedSkillId}/skill.md`)
      );
    })
    .sort(
      (left, right) =>
        left.split("/").length - right.split("/").length ||
        left.localeCompare(right),
    )[0];
  if (!nestedPath) return null;

  try {
    const response = await registryFetch(
      `https://raw.githubusercontent.com/${repo}/HEAD/${nestedPath
        .split("/")
        .map((segment) => encodeURIComponent(segment))
        .join("/")}`,
      { headers: { "user-agent": "bb-skills-registry" } },
    );
    if (!response.ok) return null;
    const contents = await response.text();
    if (contents.length > REGISTRY_DETAIL_FILE_SIZE_LIMIT) return null;
    return [{ path: "SKILL.md", contents }];
  } catch {
    return null;
  }
}

export async function fetchPublicSkillMarkdown(
  source: string,
  skillId: string,
): Promise<RegistrySkillFile[] | null> {
  try {
    const response = await registryFetch(
      registrySkillUrl(`${source}/${skillId}`),
    );
    if (!response.ok) return null;
    return parsePublicSkillMarkdown(await response.text());
  } catch {
    return null;
  }
}

export async function fetchGithubSkillPaths(
  repo: string,
): Promise<string[] | null> {
  const cached = githubSkillPathCache.get(repo);
  if (cached && cached.expiresAt > Date.now()) return cached.paths;

  const inFlight = githubSkillPathRequests.get(repo);
  if (inFlight) return inFlight;

  const request = (async () => {
    try {
      const response = await registryFetch(
        `https://api.github.com/repos/${repo}/git/trees/HEAD?recursive=1`,
        {
          headers: {
            accept: "application/vnd.github+json",
            "user-agent": "bb-skills-registry",
          },
        },
      );
      if (!response.ok) return null;
      const body: unknown = await response.json().catch(() => null);
      if (!isRecord(body) || !Array.isArray(body.tree)) return null;
      const paths = body.tree.flatMap((entry) =>
        isRecord(entry) &&
        entry.type === "blob" &&
        typeof entry.path === "string"
          ? [entry.path]
          : [],
      );
      githubSkillPathCache.set(repo, {
        paths,
        expiresAt: Date.now() + GITHUB_SKILL_PATH_CACHE_TTL_MS,
      });
      return paths;
    } catch {
      return null;
    } finally {
      githubSkillPathRequests.delete(repo);
    }
  })();
  githubSkillPathRequests.set(repo, request);
  return request;
}

export async function fetchRegistrySkillDetail(
  source: string,
  skillId: string,
): Promise<RegistrySkillDetail> {
  const id = `${source}/${skillId}`;
  const cached = registryDetailCache.get(id);
  if (cached && cached.expiresAt > Date.now()) return cached.detail;
  const authenticated = await fetchAuthenticatedRegistryDetail(source, skillId);
  const authenticatedIsLoadable =
    authenticated !== null && hasLoadableSkillContent(authenticated);
  const publicFiles = authenticatedIsLoadable
    ? null
    : ((await fetchGithubSkillMarkdown(source, skillId)) ??
      (await fetchPublicSkillMarkdown(source, skillId)));
  const detail = authenticatedIsLoadable
    ? authenticated
    : ({
        id,
        source,
        skillId,
        hash: null,
        files: publicFiles,
      } satisfies RegistrySkillDetail);
  registryDetailCache.set(id, {
    detail,
    expiresAt: Date.now() + REGISTRY_DETAIL_CACHE_TTL_MS,
  });
  return detail;
}

export async function fetchPublicDirectorySkills(
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
  // The public directory includes package hosts that only its authenticated
  // API can resolve. Exclude those records before deriving page boundaries;
  // filtering them after slicing produced sparse middle pages and false totals.
  const supported = ranked.filter(
    (skill) => githubRepoForSource(skill.source) !== null,
  );
  const start = page * perPage;
  return {
    skills: supported.slice(start, start + perPage),
    pagination: {
      page,
      perPage,
      total: supported.length,
      hasMore: start + perPage < supported.length,
    },
  };
}

export async function hydrateDetails(
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

export async function fetchGithubStars(source: string): Promise<number | null> {
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

export async function mapWithConcurrency<T>(
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

export async function hydrateGithubStars(
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

export async function filterSkillsWithLoadableDetails(
  skills: RegistrySkill[],
): Promise<RegistrySkill[]> {
  const loadable = new Array<boolean>(skills.length).fill(false);
  await mapWithConcurrency(
    skills.map((skill, index) => ({ skill, index })),
    REGISTRY_FETCH_CONCURRENCY,
    async ({ skill, index }) => {
      try {
        loadable[index] = hasLoadableSkillContent(
          await fetchRegistrySkillDetail(skill.source, skill.skillId),
        );
      } catch {
        loadable[index] = false;
      }
    },
  );
  return skills.filter((_, index) => loadable[index]);
}

export async function listRegistrySkills(
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
  const fetchedTotal =
    normalizedQuery.length > 0 && mappedApiSkills !== null
      ? mappedApiSkills.length
      : (apiPage?.total ?? skills.length);
  const pagination =
    publicPage?.pagination ??
    ({
      page,
      perPage,
      total: fetchedTotal,
      hasMore:
        normalizedQuery.length > 0
          ? start + perPage < fetchedTotal
          : (apiPage?.hasMore ?? false),
    } satisfies RegistryPagination);
  const availableSkills = await filterSkillsWithLoadableDetails(skills);
  const hydrated = await hydrateGithubStars(
    await hydrateDetails(availableSkills),
  );
  // Preserve the registry's stable ranking/page boundaries while browsing,
  // then correct the count once its terminal page proves the eligible total.
  // This keeps every loadable entry reachable without eagerly resolving the
  // entire catalog before page one can render.
  const eligiblePagination =
    !pagination.hasMore && skills.length > 0
      ? {
          ...pagination,
          total: page * perPage + availableSkills.length,
        }
      : pagination;
  return { skills: hydrated, pagination: eligiblePagination };
}

export async function resolveRegistrySkillById(
  id: string,
): Promise<RegistrySkill> {
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
