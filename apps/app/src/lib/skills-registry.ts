import {
  registrySkillDetailSchema,
  registrySkillInstallResponseSchema,
  registrySkillSchema,
  registrySkillsPageSchema,
  type SkillSummary,
} from "@bb/server-contract";
import type {
  RegistryPagination,
  RegistrySkill,
  RegistrySkillDetail,
  RegistrySkillFile,
  RegistrySkillsPage,
} from "@bb/server-contract";
import { RESOURCE_GRID_PAGE_SIZE } from "@bb/shared-ui/resource-pagination";

export type {
  RegistryPagination,
  RegistrySkill,
  RegistrySkillDetail,
  RegistrySkillFile,
  RegistrySkillsPage,
};

export const REGISTRY_PAGE_SIZE = RESOURCE_GRID_PAGE_SIZE;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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
  const parsed = registrySkillsPageSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error("Invalid skills registry response");
  }
  return parsed.data;
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
  const parsed = registrySkillDetailSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error("Invalid skill detail response");
  }
  return parsed.data;
}

export async function fetchRegistrySkillEntry(
  id: string,
): Promise<RegistrySkill> {
  const params = new URLSearchParams({ id });
  const response = await fetch(
    `/api/v1/skills-registry/entry?${params.toString()}`,
  );
  if (!response.ok) throw new Error("Failed to load registry skill");
  const parsed = registrySkillSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error("Invalid registry skill response");
  return parsed.data;
}

export async function installRegistrySkill(args: { skill: RegistrySkill }) {
  const response = await fetch("/api/v1/skills-registry/install", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      registrySkillId: args.skill.id,
    }),
  });
  const body: unknown = await response.json().catch(() => null);
  const parsed = registrySkillInstallResponseSchema.safeParse(body);
  if (!response.ok || !parsed.success) {
    throw new Error(
      isRecord(body) && typeof body.message === "string"
        ? body.message
        : "Skill install failed",
    );
  }
  return parsed.data;
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

/**
 * Seeds a new-thread composer to author a distinct skill with a skills.sh
 * entry as inspiration. The registry identity and URL let the agent retrieve
 * the same source without treating it as an install or edit target.
 */
export function buildRegistrySkillReferencePrompt(
  skill: RegistrySkill,
): string {
  return [
    `Create a new, distinct bb skill using "${skill.name}" as a reference.`,
    "",
    `Reference skill: ${skill.id}`,
    `Reference URL: ${skill.url}`,
    "",
    "Do not install, copy, modify, or overwrite the reference skill. Create a separate skill with its own name and files.",
    "",
    "Desired changes: [Describe how your new skill should differ from the reference.]",
  ].join("\n");
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
