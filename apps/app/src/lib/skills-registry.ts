import type { SkillSummary } from "@bb/server-contract";
import { RESOURCE_GRID_PAGE_SIZE } from "@bb/shared-ui/resource-pagination";

export interface RegistrySkill {
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

export interface RegistryPagination {
  page: number;
  perPage: number;
  total: number;
  hasMore: boolean;
}

export interface RegistrySkillsPage {
  skills: RegistrySkill[];
  pagination: RegistryPagination;
}

export interface RegistrySkillFile {
  path: string;
  contents: string;
}

export interface RegistrySkillDetail {
  id: string;
  source: string;
  skillId: string;
  hash: string | null;
  files: RegistrySkillFile[] | null;
}

export const REGISTRY_PAGE_SIZE = RESOURCE_GRID_PAGE_SIZE;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseRegistrySkill(value: unknown): RegistrySkill | null {
  if (!isRecord(value)) return null;
  const {
    id,
    source,
    skillId,
    name,
    installs,
    stars,
    installUrl,
    url,
    topic,
    summary,
  } = value;
  if (
    typeof id !== "string" ||
    typeof source !== "string" ||
    typeof skillId !== "string" ||
    typeof name !== "string" ||
    typeof installs !== "number" ||
    (stars !== undefined && stars !== null && typeof stars !== "number") ||
    (installUrl !== null && typeof installUrl !== "string") ||
    typeof url !== "string" ||
    (topic !== null && typeof topic !== "string") ||
    (summary !== null && typeof summary !== "string")
  ) {
    return null;
  }
  return {
    id,
    source,
    skillId,
    name,
    installs,
    stars: typeof stars === "number" ? stars : null,
    installUrl,
    url,
    topic,
    summary,
  };
}

export function parseRegistrySkills(value: unknown): RegistrySkill[] {
  if (!isRecord(value) || !Array.isArray(value.skills)) return [];
  const parsed: RegistrySkill[] = [];
  for (const skill of value.skills) {
    const parsedSkill = parseRegistrySkill(skill);
    if (parsedSkill !== null) parsed.push(parsedSkill);
  }
  return parsed;
}

export async function fetchRegistrySkills(args: {
  query: string;
  page: number;
  perPage?: number;
}): Promise<RegistrySkillsPage> {
  const params = new URLSearchParams();
  if (args.query.trim().length > 0) params.set("q", args.query.trim());
  params.set("page", String(args.page));
  params.set("perPage", String(args.perPage ?? REGISTRY_PAGE_SIZE));
  const response = await fetch(`/api/v1/skills-registry?${params.toString()}`);
  if (!response.ok) throw new Error("Failed to load skills registry");
  const body = await response.json();
  if (!isRecord(body) || !isRecord(body.pagination)) {
    throw new Error("Invalid skills registry response");
  }
  const { page, perPage, total, hasMore } = body.pagination;
  if (
    typeof page !== "number" ||
    !Number.isInteger(page) ||
    page < 0 ||
    typeof perPage !== "number" ||
    !Number.isInteger(perPage) ||
    perPage < 1 ||
    typeof total !== "number" ||
    !Number.isInteger(total) ||
    total < 0 ||
    typeof hasMore !== "boolean"
  ) {
    throw new Error("Invalid skills registry pagination");
  }
  return {
    skills: parseRegistrySkills(body),
    pagination: { page, perPage, total, hasMore },
  };
}

export async function fetchRegistrySkillDetail(args: {
  source: string;
  skillId: string;
}): Promise<RegistrySkillDetail> {
  const params = new URLSearchParams({
    source: args.source,
    skillId: args.skillId,
  });
  const response = await fetch(
    `/api/v1/skills-registry/detail?${params.toString()}`,
  );
  if (!response.ok) throw new Error("Failed to load skill files");
  const body: unknown = await response.json();
  if (
    !isRecord(body) ||
    typeof body.id !== "string" ||
    typeof body.source !== "string" ||
    typeof body.skillId !== "string" ||
    (body.hash !== null && typeof body.hash !== "string") ||
    (body.files !== null && !Array.isArray(body.files))
  ) {
    throw new Error("Invalid skill detail response");
  }
  const files: RegistrySkillFile[] | null =
    body.files === null
      ? null
      : body.files.map((file) => {
          if (
            !isRecord(file) ||
            typeof file.path !== "string" ||
            typeof file.contents !== "string"
          ) {
            throw new Error("Invalid skill detail file");
          }
          return { path: file.path, contents: file.contents };
        });
  return {
    id: body.id,
    source: body.source,
    skillId: body.skillId,
    hash: body.hash,
    files,
  };
}

export async function fetchRegistrySkillEntry(
  id: string,
): Promise<RegistrySkill> {
  const params = new URLSearchParams({ id });
  const response = await fetch(
    `/api/v1/skills-registry/entry?${params.toString()}`,
  );
  if (!response.ok) throw new Error("Failed to load registry skill");
  const skill = parseRegistrySkill(await response.json());
  if (skill === null) throw new Error("Invalid registry skill response");
  return skill;
}

export async function installRegistrySkill(args: { skill: RegistrySkill }) {
  const response = await fetch("/api/v1/skills-registry/install", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      registrySkillId: args.skill.id,
    }),
  });
  const body = (await response.json().catch(() => null)) as {
    ok?: unknown;
    message?: unknown;
    filePath?: unknown;
  } | null;
  if (!response.ok || body?.ok !== true || typeof body.filePath !== "string") {
    throw new Error(
      typeof body?.message === "string" ? body.message : "Skill install failed",
    );
  }
  return { ok: true as const, filePath: body.filePath };
}

export function normalizeSkillName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-");
}

export function resolveInstalledRegistrySkill(
  registrySkill: RegistrySkill,
  installedSkills: readonly SkillSummary[],
): SkillSummary | null {
  return (
    installedSkills.find((installedSkill) => {
      return (
        installedSkill.scope === "bb-user" &&
        installedSkill.provider === null &&
        installedSkill.manageable &&
        installedSkill.registrySkillId === registrySkill.id
      );
    }) ?? null
  );
}

export function formatRegistrySource(source: string): string {
  const githubPrefix = "github.com/";
  return source.startsWith(githubPrefix)
    ? source.slice(githubPrefix.length)
    : source;
}

export function formatInstallCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return String(count);
}
