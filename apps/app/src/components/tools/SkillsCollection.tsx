import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { SkillProvider, SkillSummary } from "@bb/server-contract";
import bbLogoUrl from "../../../../../assets/bb-logo.svg";
import {
  ResourceInfiniteScrollSentinel,
  useResourceInfiniteItems,
  useResourceViewportPageSize,
} from "@bb/shared-ui/resource-pagination";
import {
  ResourceCollectionPage,
  ResourceCollectionViewport,
  ResourceListPanel,
  ResourceFilterMenu,
  ResourceListState,
  ResourceOverflowMenu,
  ResourceRow,
  ResourceRowDetailChevron,
  ResourceSortMenu,
  ResourceToolbar,
} from "@bb/shared-ui/resource-list";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  ConfirmDeleteDialog,
  ConfirmDeleteDialogContent,
} from "@/components/dialogs/ConfirmDeleteDialog";
import { CreateWithTemplatesButton } from "@/components/create-via-prompt-examples";
import { ProvenancePill } from "@/components/tools/ProvenancePill";
import { SkillDetailView } from "@/components/tools/SkillDetailView";
import { TOOLS_PAGE_BAND_CLASSES } from "@/components/tools/tools-navigation";
import { skillScopeLabel } from "@/components/tools/skill-taxonomy";
import {
  getProviderIconColorClass,
  getProviderIconInfo,
} from "@/lib/provider-icon";

type ResourceProviderFilter = "bb" | SkillProvider;
/** Provider id → the server's display name, for every listed provider. */
export type ProviderDisplayNames = ReadonlyMap<string, string>;
type ResourceSkillSourceFilter = "included" | "bb-official" | "user";
type ResourceSortMode = "provider" | "alpha";
type ResourceSortDirection = "asc" | "desc";

const RESOURCE_SKILL_SOURCE_FILTERS: readonly ResourceSkillSourceFilter[] = [
  "included",
  "bb-official",
  "user",
];

/**
 * Names a provider the way the rest of the app does: the server's display name
 * first. The icon's aria label is a per-tier fallback — every unknown `acp-*`
 * id shares one ("ACP provider"), so two custom ACP agents would otherwise be
 * indistinguishable in the filter menu, the scope label, and search.
 */
function providerLabel(
  provider: SkillProvider | null,
  providerDisplayNames: ProviderDisplayNames,
): string {
  if (provider === null) return "bb";
  return (
    providerDisplayNames.get(provider) ??
    getProviderIconInfo(provider)?.ariaLabel ??
    provider
  );
}

function skillProviderFilterId(skill: SkillSummary): ResourceProviderFilter {
  return skill.provider ?? "bb";
}

function providerFilterLabel(
  provider: ResourceProviderFilter,
  providerDisplayNames: ProviderDisplayNames,
): string {
  return provider === "bb"
    ? "bb"
    : providerLabel(provider, providerDisplayNames);
}

function skillSourceFilterId(skill: SkillSummary): ResourceSkillSourceFilter {
  if (skill.scope === "bb-builtin") return "bb-official";
  if (skill.scope === "plugin") return "included";
  // Every remaining scope is authored by the user, so the bucket is total and
  // the filter can never strand a skill.
  return "user";
}

function skillSourceFilterLabel(source: ResourceSkillSourceFilter): string {
  switch (source) {
    case "bb-official":
      return "BB Official";
    case "included":
      return "Included in plugin";
    case "user":
      return "User";
  }
}

function isResourceSkillSourceFilter(
  value: string,
): value is ResourceSkillSourceFilter {
  return value === "included" || value === "bb-official" || value === "user";
}

// The filter menu hands back plain strings. Provider ids are an open
// vocabulary now, so completeness of the option list comes from deriving it
// from the listed skills rather than from a closed table; this only rejects
// the empty string, which is not a provider id.
function isResourceProviderFilter(
  value: string,
): value is ResourceProviderFilter {
  return value !== "";
}

export function ProviderLogo({
  providerId,
  className,
}: {
  providerId: SkillProvider;
  className?: string;
}) {
  const info = getProviderIconInfo(providerId);
  if (!info) {
    return null;
  }
  const LogoIcon = info.icon;
  return (
    <LogoIcon
      className={cn(getProviderIconColorClass(providerId), className)}
    />
  );
}

export function BbLogo({ className = "size-4" }: { className?: string }) {
  return (
    <img
      src={bbLogoUrl}
      alt=""
      aria-hidden="true"
      className={cn(className, "object-contain dark:invert")}
    />
  );
}

export function SkillProvenanceTooltip({
  prefix,
  providerId,
  name,
}: {
  prefix: string;
  providerId: SkillProvider | null;
  name: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span>{prefix}</span>
      <span data-provider-icon={providerId ?? "bb"} aria-hidden="true">
        {providerId === null ? (
          <BbLogo className="size-3.5 brightness-0 invert" />
        ) : (
          <ProviderLogo
            providerId={providerId}
            className={cn("size-3.5", providerId === "codex" && "text-white")}
          />
        )}
      </span>
      <span>{name}</span>
    </span>
  );
}

function SkillLeading({ skill }: { skill: SkillSummary }) {
  if (skill.provider !== null) {
    return <ProviderLogo providerId={skill.provider} className="size-6" />;
  }
  return <BbLogo className="size-6" />;
}

function skillDescription(
  skill: SkillSummary,
  providerDisplayNames: ProviderDisplayNames,
): string {
  return (
    skill.description ??
    skillScopeLabel(skill, providerLabelForScope(skill, providerDisplayNames))
  );
}

function providerLabelForScope(
  skill: SkillSummary,
  providerDisplayNames: ProviderDisplayNames,
): string | undefined {
  return skill.provider === null
    ? undefined
    : providerDisplayNames.get(skill.provider);
}

function providerPluginNameForSkill(skill: SkillSummary): string {
  if (skill.pluginId !== null) return skill.pluginId;
  const separatorIndex = skill.name.indexOf(":");
  return separatorIndex > 0 ? skill.name.slice(0, separatorIndex) : skill.name;
}

function providerPluginDisplayName(skill: SkillSummary): string {
  const name = providerPluginNameForSkill(skill).replace(/[-_]+/gu, " ");
  return name.length === 0 ? name : name[0].toUpperCase() + name.slice(1);
}

function includedPluginDescription(
  skill: SkillSummary,
  providerDisplayNames: ProviderDisplayNames,
): string {
  return `${providerPluginDisplayName(skill)} (${providerLabel(skill.provider, providerDisplayNames)} plugin)`;
}

function skillMutationDisabledReason(skill: SkillSummary): string {
  if (skill.scope === "bb-builtin") return "Built-in skill";
  if (skill.scope === "plugin") return "Bundled with plugin";
  return `Bundled with ${skill.provider === "claude-code" ? "Claude Code" : "Codex"}`;
}

/**
 * Each Skills page describes its own purpose: Browse speaks to discovery from
 * the open ecosystem, the library to managing what this host already has.
 */
const SKILLS_BROWSE_DESCRIPTION = (
  <>
    Trending agent skills from{" "}
    <a
      href="https://skills.sh"
      target="_blank"
      rel="noreferrer"
      className="rounded-sm underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      skills.sh
    </a>
    . Install one and every agent you use in bb can run it.
  </>
);
const SKILLS_LIBRARY_DESCRIPTION =
  "The skills on this bb host — yours, your providers', and those bundled with plugins. They work with every agent you use in bb.";

/**
 * How long the pointer (or focus) must rest on a row before its detail
 * queries warm. Raw enter events would turn one sweep of the cursor down the
 * list into a prefetch per row — two requests each — for rows the user never
 * meant to open.
 */
const PREFETCH_HOVER_INTENT_MS = 150;

function SkillRow({
  skill,
  providerDisplayNames,
  onSelect,
  onPrefetch,
}: {
  skill: SkillSummary;
  providerDisplayNames: ProviderDisplayNames;
  onSelect: () => void;
  /** Warms the detail queries on intent; the connected layer supplies it. */
  onPrefetch?: (skill: SkillSummary) => void;
}) {
  const description = skillDescription(skill, providerDisplayNames);
  const prefetchTimer = useRef<number | null>(null);
  const cancelScheduledPrefetch = () => {
    if (prefetchTimer.current === null) return;
    window.clearTimeout(prefetchTimer.current);
    prefetchTimer.current = null;
  };
  const schedulePrefetch = () => {
    if (prefetchTimer.current !== null) return;
    prefetchTimer.current = window.setTimeout(() => {
      prefetchTimer.current = null;
      onPrefetch?.(skill);
    }, PREFETCH_HOVER_INTENT_MS);
  };
  useEffect(() => cancelScheduledPrefetch, []);
  return (
    // ResourceRow keeps its narrow prop surface; the intent listeners live on
    // a wrapper (React delegates these events, so this covers the whole row).
    <div
      onPointerEnter={schedulePrefetch}
      onPointerLeave={cancelScheduledPrefetch}
      onFocus={schedulePrefetch}
      onBlur={cancelScheduledPrefetch}
    >
      <ResourceRow
        leading={<SkillLeading skill={skill} />}
        title={skill.name}
        titleMeta={
          skill.scope === "bb-builtin" ? (
            <ProvenancePill label="BB Official" />
          ) : skill.scope === "plugin" ? (
            <ProvenancePill
              label="Included"
              tooltip={
                <SkillProvenanceTooltip
                  prefix="Included with"
                  providerId={skill.provider}
                  name={`${providerPluginDisplayName(skill)} plugin.`}
                />
              }
              accessibleLabel={`${skill.name} is included with ${includedPluginDescription(skill, providerDisplayNames)}`}
            />
          ) : undefined
        }
        description={description}
        onOpen={onSelect}
        trailingVisual={<ResourceRowDetailChevron />}
      />
    </div>
  );
}

export interface SkillsOverviewProps {
  skills: readonly SkillSummary[];
  /**
   * Provider display names from the server roster. Provider ids are
   * open-ended (every custom ACP agent is one), so without the roster two
   * agents share one per-tier fallback label ("ACP provider").
   */
  providerDisplayNames: ProviderDisplayNames;
  isLoading: boolean;
  hasError: boolean;
  query?: string;
  activeMode?: SkillsCollectionMode;
  browseContent?: ReactNode;
  /** Unused since the mode tabs moved to the Extensions top nav. */
  onModeChange?: (mode: SkillsCollectionMode) => void;
  /** Opens the composer to create a skill, optionally seeded with a full prompt. */
  onCreateSkill: (prompt?: string) => void;
  onSelectSkill: (skill: SkillSummary) => void;
  /** Warms a skill's detail queries from row hover/focus. */
  onPrefetchSkill?: (skill: SkillSummary) => void;
  onQueryChange?: (query: string) => void;
  /** Refetch after a load failure — gives the error state a way out. */
  onRetry?: () => void;
}

type SkillsCollectionMode = "library" | "browse";

/**
 * Presentational Skills list: provider-grouped, searchable, typeahead-style
 * rows. Split from the data-fetching container so it renders in tests/stories.
 */
export function SkillsOverview({
  skills,
  providerDisplayNames,
  isLoading,
  hasError,
  query = "",
  activeMode = "library",
  browseContent,
  onCreateSkill,
  onSelectSkill,
  onPrefetchSkill,
  onQueryChange = () => {},
  onRetry,
}: SkillsOverviewProps) {
  const [providerFilters, setProviderFilters] = useState<
    ResourceProviderFilter[]
  >(["bb"]);
  // Empty means unfiltered: the menu has no explicit "All" row.
  const [sourceFilters, setSourceFilters] = useState<
    ResourceSkillSourceFilter[]
  >([]);
  const [sortMode, setSortMode] = useState<ResourceSortMode>("alpha");
  const [sortDirection, setSortDirection] =
    useState<ResourceSortDirection>("asc");
  const [libraryViewport, setLibraryViewport] = useState<HTMLDivElement | null>(
    null,
  );
  const normalizedQuery = query.trim().toLowerCase();
  // One projection identity for both the page selection and the row heights
  // the page size is measured from.
  const libraryResetKey = [
    normalizedQuery,
    providerFilters.join(","),
    sourceFilters.join(","),
    sortMode,
    sortDirection,
  ].join("\u0000");
  const libraryPageSize = useResourceViewportPageSize(libraryViewport, {
    resetKey: libraryResetKey,
  });
  const providerCounts = useMemo(() => {
    const counts = new Map<ResourceProviderFilter, number>();
    for (const skill of skills) {
      const provider = skillProviderFilterId(skill);
      counts.set(provider, (counts.get(provider) ?? 0) + 1);
    }
    return counts;
  }, [skills]);
  const providerBucketCount = providerCounts.size;
  // Derived from the listed skills (plus any still-selected filter) so a
  // provider bb has never heard of still gets a filter row. "bb" leads;
  // the rest sort by display label, which reproduces the order the old
  // hardcoded table hardcoded.
  const providerOptions = useMemo(() => {
    const present = new Set<ResourceProviderFilter>([
      "bb",
      ...providerCounts.keys(),
      ...providerFilters,
    ]);
    const ordered = [...present].sort((left, right) =>
      left === "bb" || right === "bb"
        ? Number(left !== "bb") - Number(right !== "bb")
        : providerFilterLabel(left, providerDisplayNames).localeCompare(
            providerFilterLabel(right, providerDisplayNames),
          ),
    );
    return ordered.map((provider) => ({
      id: provider,
      label: providerFilterLabel(provider, providerDisplayNames),
      leading:
        provider === "bb" ? (
          <BbLogo className="size-4" />
        ) : (
          <ProviderLogo providerId={provider} className="size-4" />
        ),
      disabled:
        !providerCounts.has(provider) && !providerFilters.includes(provider),
    }));
  }, [providerCounts, providerDisplayNames, providerFilters]);
  const sourceOptions = useMemo(
    () =>
      RESOURCE_SKILL_SOURCE_FILTERS.map((source) => ({
        id: source,
        label: skillSourceFilterLabel(source),
      })),
    [],
  );
  useEffect(() => {
    if (sortMode === "provider" && providerBucketCount <= 1) {
      setSortMode("alpha");
      setSortDirection("asc");
    }
  }, [providerBucketCount, sortMode]);
  const visibleSkills = useMemo(() => {
    const filtered = skills.filter((skill) => {
      const source = skillSourceFilterId(skill);
      if (sourceFilters.length > 0 && !sourceFilters.includes(source)) {
        return false;
      }
      if (
        providerFilters.length > 0 &&
        !providerFilters.includes(skillProviderFilterId(skill))
      ) {
        return false;
      }
      return (
        normalizedQuery === "" ||
        [
          skill.name,
          skill.description ?? "",
          providerLabel(skill.provider, providerDisplayNames),
          skillScopeLabel(
            skill,
            providerLabelForScope(skill, providerDisplayNames),
          ),
        ]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery)
      );
    });
    return [...filtered].sort((left, right) => {
      if (providerFilters.length === 1 && providerFilters[0] === "bb") {
        const officialResult =
          Number(left.scope !== "bb-builtin") -
          Number(right.scope !== "bb-builtin");
        if (officialResult !== 0) return officialResult;
      }
      const base =
        sortMode === "provider"
          ? providerLabel(left.provider, providerDisplayNames).localeCompare(
              providerLabel(right.provider, providerDisplayNames),
            ) || left.name.localeCompare(right.name)
          : left.name.localeCompare(right.name);
      if (base !== 0) return sortDirection === "asc" ? base : -base;
      return left.filePath.localeCompare(right.filePath);
    });
  }, [
    normalizedQuery,
    providerDisplayNames,
    providerFilters,
    skills,
    sortDirection,
    sortMode,
    sourceFilters,
  ]);
  // Rows accumulate as the sentinel scrolls into view; the page machinery
  // (viewport-fit chunk size, projection reset keys) stays underneath.
  const libraryList = useResourceInfiniteItems(visibleSkills, {
    pageSize: libraryPageSize,
    resetKey: libraryResetKey,
  });
  const handleSortChange = useCallback(
    (nextSort: string) => {
      if (nextSort !== "provider" && nextSort !== "alpha") return;
      if (nextSort === "provider" && providerBucketCount <= 1) return;
      if (nextSort === sortMode) {
        setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
        return;
      }
      setSortMode(nextSort);
      setSortDirection("asc");
    },
    [providerBucketCount, sortMode],
  );
  const libraryBody = hasError ? (
    <ResourceListState
      state="error"
      message="Couldn't load skills."
      onRetry={onRetry}
    />
  ) : isLoading ? (
    <ResourceListState state="loading" message="Loading skills" />
  ) : visibleSkills.length === 0 ? (
    <ResourceListState
      state="empty"
      message={
        // Naming only the query would misattribute the empty result when a
        // filter is what emptied it — clearing the search would still show
        // nothing.
        normalizedQuery === ""
          ? skills.length === 0
            ? "No skills in your library."
            : "No skills match these filters."
          : sourceFilters.length > 0 || providerFilters.length > 0
            ? `No skills match "${query}" with these filters.`
            : `No skills match "${query}"`
      }
    />
  ) : (
    <>
      <ResourceListPanel>
        {libraryList.items.map((skill) => (
          <SkillRow
            key={`${skill.scope}-${skill.provider ?? "bb"}-${skill.name}-${skill.filePath}`}
            skill={skill}
            providerDisplayNames={providerDisplayNames}
            onSelect={() => onSelectSkill(skill)}
            onPrefetch={onPrefetchSkill}
          />
        ))}
      </ResourceListPanel>
      <ResourceInfiniteScrollSentinel
        hasMore={libraryList.hasMore}
        onLoadMore={libraryList.loadMore}
      />
    </>
  );

  return (
    // Browse and Library are separate top-nav destinations; the page renders
    // whichever the URL selects and carries no tab layer of its own. Each
    // describes its own purpose — discovery vs. managing what you have.
    <ResourceCollectionPage
      id="skills-collection"
      description={
        activeMode === "browse"
          ? SKILLS_BROWSE_DESCRIPTION
          : SKILLS_LIBRARY_DESCRIPTION
      }
      bandClassName={TOOLS_PAGE_BAND_CLASSES}
    >
      {activeMode === "browse" ? (
        browseContent
      ) : (
        <ResourceCollectionViewport
          scrollId="skills-library-results"
          viewportRef={setLibraryViewport}
          bandClassName={TOOLS_PAGE_BAND_CLASSES}
          toolbar={
            <ResourceToolbar
              searchValue={query}
              searchPlaceholder="Search skills"
              onSearchChange={onQueryChange}
              action={
                <CreateWithTemplatesButton
                  kind="skill"
                  label="New bb skill"
                  onCreate={onCreateSkill}
                />
              }
              controls={
                <>
                  <ResourceFilterMenu
                    compact
                    groups={[
                      {
                        id: "type",
                        label: "Type",
                        options: sourceOptions,
                        selectedValues: sourceFilters,
                        onChange: (values) =>
                          setSourceFilters(
                            values.filter(isResourceSkillSourceFilter),
                          ),
                      },
                      {
                        id: "provider",
                        label: "Provider",
                        options: providerOptions,
                        selectedValues: providerFilters,
                        onChange: (values) =>
                          setProviderFilters(
                            values.filter(isResourceProviderFilter),
                          ),
                      },
                    ]}
                  />
                  <ResourceSortMenu
                    value={sortMode}
                    direction={sortDirection}
                    compact
                    options={[
                      {
                        id: "provider",
                        label: "Provider",
                        disabled: providerBucketCount <= 1,
                      },
                      { id: "alpha", label: "Skill name" },
                    ]}
                    onChange={handleSortChange}
                  />
                </>
              }
            />
          }
        >
          <div className={TOOLS_PAGE_BAND_CLASSES}>{libraryBody}</div>
        </ResourceCollectionViewport>
      )}
    </ResourceCollectionPage>
  );
}

export interface SkillDetailDialogViewProps {
  skill: SkillSummary | null;
  /** See {@link SkillsOverviewProps.providerDisplayNames}. */
  providerDisplayNames: ProviderDisplayNames;
  files: readonly string[];
  selectedPath: string;
  onSelectPath: (path: string) => void;
  content: string;
  isLoadingContent: boolean;
  isContentError: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canOpenInEditor: boolean;
  isDeleting: boolean;
  onEdit: () => void;
  onRetry: () => void;
  onDelete: () => void;
  onOpenInEditor: () => void;
}

/**
 * Presentational skill detail page: renders the SKILL.md with Edit / Delete /
 * Open-source affordances. Editing starts a resource-scoped thread; direct
 * source opening remains a separate action. The connected
 * {@link SkillDetailPage} wires it to the content/update/delete queries.
 */
export function SkillDetailDialogView({
  skill,
  providerDisplayNames,
  files,
  selectedPath,
  onSelectPath,
  content,
  isLoadingContent,
  isContentError,
  canEdit,
  canDelete,
  canOpenInEditor,
  isDeleting,
  onEdit,
  onRetry,
  onDelete,
  onOpenInEditor,
}: SkillDetailDialogViewProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    setConfirmingDelete(false);
  }, [skill?.id]);

  if (skill === null) return null;
  const bundledPluginName =
    skill.scope === "plugin" ? providerPluginNameForSkill(skill) : null;
  const disabledReason = skillMutationDisabledReason(skill);
  const canEditSelectedPath = canEdit && selectedPath === "SKILL.md";
  const headerActions =
    skill.scope !== "plugin" &&
    (canEdit || canDelete || canOpenInEditor) &&
    !confirmingDelete ? (
      <ResourceOverflowMenu
        label={`${skill.name} actions`}
        items={[
          {
            label: "Edit",
            icon: "Edit" as const,
            disabled: !canEditSelectedPath,
            disabledReason: !canEdit
              ? disabledReason
              : selectedPath !== "SKILL.md"
                ? "Only SKILL.md can be edited"
                : undefined,
            onSelect: onEdit,
          },
          ...(canOpenInEditor
            ? [
                {
                  label: "Open source",
                  icon: "ExternalLink" as const,
                  onSelect: onOpenInEditor,
                },
              ]
            : []),
          { kind: "separator" as const },
          {
            label: "Delete",
            icon: "Trash2" as const,
            tone: "destructive" as const,
            disabled: !canDelete,
            disabledReason: !canDelete ? disabledReason : undefined,
            onSelect: () => setConfirmingDelete(true),
          },
        ]}
      />
    ) : null;
  return (
    <SkillDetailView
      leading={<SkillLeading skill={skill} />}
      title={skill.name}
      path={skill.filePath}
      titleBadge={
        skill.scope === "bb-builtin"
          ? {
              label: "BB Official",
              tooltip: "Ships with bb",
              accessibleLabel: `${skill.name} is BB Official`,
            }
          : bundledPluginName !== null
            ? {
                label: "Included",
                tooltip: (
                  <SkillProvenanceTooltip
                    prefix="Included with"
                    providerId={skill.provider}
                    name={`${providerPluginDisplayName(skill)} plugin.`}
                  />
                ),
                accessibleLabel: `${skill.name} is included with ${includedPluginDescription(skill, providerDisplayNames)}`,
              }
            : skill.provider !== null
              ? {
                  label: "Imported",
                  tooltip: (
                    <SkillProvenanceTooltip
                      prefix="Discovered from"
                      providerId={skill.provider}
                      name={providerLabel(skill.provider, providerDisplayNames)}
                    />
                  ),
                  accessibleLabel: `${skill.name} is imported from ${skill.provider === "claude-code" ? "Claude Code" : "Codex"}`,
                }
              : undefined
      }
      files={files.length > 0 ? files : ["SKILL.md"]}
      selectedPath={selectedPath}
      onSelectFile={onSelectPath}
      contentState={
        isContentError
          ? {
              kind: "error",
              message: `Failed to load ${selectedPath}.`,
              onRetry,
            }
          : isLoadingContent
            ? { kind: "loading" }
            : { kind: "ready", content }
      }
      overflowMenu={headerActions}
      footer={
        <ConfirmDeleteDialog
          open={confirmingDelete}
          onOpenChange={(open) => {
            if (!isDeleting) setConfirmingDelete(open);
          }}
        >
          <ConfirmDeleteDialogContent
            title="Delete skill?"
            description={`Delete "${skill.name}" from its current location? This cannot be undone.`}
            confirmLabel="Delete skill"
            pending={isDeleting}
            onConfirm={onDelete}
            onCancel={() => setConfirmingDelete(false)}
          />
        </ConfirmDeleteDialog>
      }
    />
  );
}
