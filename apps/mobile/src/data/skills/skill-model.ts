import type {
  RegistrySkill,
  SkillScope,
  SkillSummary,
} from "@bb/server-contract";

/**
 * Pure helpers for the skills library and the skills.sh registry browse
 * (ports of apps/app `components/tools/skill-taxonomy.ts` and
 * `lib/skills-registry.ts`). No React Native imports.
 */

const SKILL_ROOT_LABELS: Record<
  Exclude<SkillScope, "provider-user" | "provider-project">,
  string
> = {
  "bb-builtin": "Built-in",
  "bb-user": "bb · user",
  "bb-project": "bb · project",
  "shared-user": "Shared · user",
  "shared-project": "Shared · project",
  plugin: "Plugin",
};

/**
 * Provider scopes are labelled from the skill's own `provider` field (any
 * plugin provider id); the roster's display name wins when known.
 */
export function skillScopeLabel(
  skill: Pick<SkillSummary, "scope" | "provider">,
  providerDisplayName?: string,
): string {
  if (skill.scope === "provider-user" || skill.scope === "provider-project") {
    const root = skill.scope === "provider-user" ? "user" : "project";
    const providerLabel =
      providerDisplayName ??
      (skill.provider === null ? "Provider" : skill.provider);
    return `${providerLabel} · ${root}`;
  }
  return SKILL_ROOT_LABELS[skill.scope];
}

/** Local scopes whose SKILL.md bb may edit / delete. */
function isSkillEditable(
  skill: Pick<SkillSummary, "scope" | "manageable">,
): boolean {
  switch (skill.scope) {
    case "bb-user":
    case "bb-project":
      return true;
    case "provider-user":
    case "provider-project":
      return skill.manageable;
    case "shared-user":
    case "shared-project":
    case "bb-builtin":
    case "plugin":
      return false;
  }
}

/** Deletable = user-owned, manageable and editable. */
export function isSkillDeletable(
  skill: Pick<SkillSummary, "scope" | "manageable">,
): boolean {
  return skill.manageable && isSkillEditable(skill);
}

/** Section order of the library: the user's own skills first, built-ins last. */
const SKILL_SCOPE_ORDER: readonly SkillScope[] = [
  "bb-user",
  "bb-project",
  "provider-user",
  "provider-project",
  "shared-user",
  "shared-project",
  "plugin",
  "bb-builtin",
];

export interface SkillLibraryGroup {
  key: string;
  label: string;
  skills: SkillSummary[];
}

export type ProviderDisplayNames = ReadonlyMap<string, string>;

/**
 * Skills grouped by scope label, in {@link SKILL_SCOPE_ORDER}; names sorted
 * inside a group. Provider scopes split per provider (each gets its own
 * label), in provider-name order.
 */
export function groupSkillsByScope(
  skills: readonly SkillSummary[],
  providerDisplayNames: ProviderDisplayNames = new Map(),
): SkillLibraryGroup[] {
  const groups = new Map<string, SkillLibraryGroup & { order: number }>();
  for (const skill of skills) {
    const providerName =
      skill.provider === null
        ? undefined
        : providerDisplayNames.get(skill.provider);
    const label = skillScopeLabel(skill, providerName);
    const key = `${skill.scope}:${skill.provider ?? ""}`;
    const group = groups.get(key);
    if (group) {
      group.skills.push(skill);
      continue;
    }
    groups.set(key, {
      key,
      label,
      skills: [skill],
      order: SKILL_SCOPE_ORDER.indexOf(skill.scope),
    });
  }
  return [...groups.values()]
    .sort(
      (left, right) =>
        left.order - right.order ||
        left.label.localeCompare(right.label, undefined, {
          sensitivity: "base",
        }),
    )
    .map(({ order: _order, ...group }) => ({
      ...group,
      skills: [...group.skills].sort((left, right) =>
        left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
      ),
    }));
}

/** Case-insensitive filter on name and description. */
export function filterSkills(
  skills: readonly SkillSummary[],
  query: string,
): SkillSummary[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [...skills];
  return skills.filter(
    (skill) =>
      skill.name.toLowerCase().includes(needle) ||
      (skill.description?.toLowerCase().includes(needle) ?? false),
  );
}

/**
 * The installed library entry a registry skill installed, if any: the
 * server records the exact registry id on the user-scope install.
 */
export function resolveInstalledRegistrySkill(
  registrySkill: Pick<RegistrySkill, "id">,
  installedSkills: readonly SkillSummary[],
): SkillSummary | null {
  return (
    installedSkills.find(
      (skill) =>
        skill.scope === "bb-user" &&
        skill.provider === null &&
        skill.manageable &&
        skill.registrySkillId === registrySkill.id,
    ) ?? null
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

/** The registry row subtitle: source · N installs (ranking-labelled). */
export function describeRegistrySkill(
  skill: Pick<RegistrySkill, "source" | "installs" | "summary">,
  ranking: "trending" | "all-time",
): string {
  const installs = `${formatInstallCount(skill.installs)} ${ranking === "trending" ? "installs today" : "installs"}`;
  return `${formatRegistrySource(skill.source)} · ${installs}`;
}

/**
 * Loaded registry pages accumulate for "Load more"; a new search or a
 * ranking change (the server can fall back from trending to all-time, whose
 * `installs` count different windows) starts a fresh list. Deduped by id so
 * a refetched page cannot double its rows.
 */
export interface RegistrySkillsAccumulator {
  ranking: "trending" | "all-time";
  search: string;
  skills: RegistrySkill[];
  hasMore: boolean;
}

export function accumulateRegistryPage(
  current: RegistrySkillsAccumulator,
  page: {
    ranking: "trending" | "all-time";
    skills: readonly RegistrySkill[];
    hasMore: boolean;
  },
  search: string,
): RegistrySkillsAccumulator {
  const matches = current.ranking === page.ranking && current.search === search;
  const base = matches ? current.skills : [];
  const seen = new Set(base.map((skill) => skill.id));
  const fresh = page.skills.filter((skill) => !seen.has(skill.id));
  return {
    ranking: page.ranking,
    search,
    skills: fresh.length === 0 && matches ? base : [...base, ...fresh],
    hasMore: page.hasMore,
  };
}

/** The SKILL.md of a registry detail, or the first markdown file. */
export function pickRegistrySkillFile(
  files: readonly { path: string; contents: string }[] | null,
  selectedPath: string | null,
): { path: string; contents: string } | null {
  if (files === null || files.length === 0) return null;
  if (selectedPath !== null) {
    const selected = files.find((file) => file.path === selectedPath);
    if (selected) return selected;
  }
  return (
    files.find((file) => file.path === "SKILL.md") ??
    files.find((file) => /(^|\/)SKILL\.md$/u.test(file.path)) ??
    files.find((file) => file.path.toLowerCase().endsWith(".md")) ??
    files[0] ??
    null
  );
}
