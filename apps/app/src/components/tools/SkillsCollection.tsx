import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { SkillProvider, SkillSummary } from "@bb/server-contract";
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
import { BbLogo } from "@/components/ui/bb-logo";
import { Icon } from "@bb/shared-ui/icon";
import {
  ConfirmDeleteDialog,
  ConfirmDeleteDialogContent,
} from "@bb/shared-ui/confirm-delete-dialog";
import { CreateWithTemplatesButton } from "@/components/create-via-prompt-examples";
import { ProvenancePill } from "@/components/tools/ProvenancePill";
import { SkillDetailView } from "@/components/tools/SkillDetailView";
import { TOOLS_PAGE_BAND_CLASSES } from "@/components/tools/tools-navigation";
import { skillScopeLabel } from "@/components/tools/skill-taxonomy";
import type { ProviderInfo } from "@bb/domain";
import { ProviderIconMark } from "@/components/settings/ProviderIconMark";
import { getProviderIconInfo } from "@/lib/provider-icon";
import type { MarkdownLinkRouting } from "@/components/ui/markdown-link-routing";

type ResourceProviderFilter =
  | "owner:bb"
  | "owner:shared"
  | `provider:${SkillProvider}`;
export type ProviderRoster = ReadonlyMap<string, ProviderInfo>;
type ResourceSkillSourceFilter = "included" | "bb-official" | "user";
type ResourceSortMode = "provider" | "alpha";
type ResourceSortDirection = "asc" | "desc";

const RESOURCE_SKILL_SOURCE_FILTERS: readonly ResourceSkillSourceFilter[] = [
  "included",
  "bb-official",
  "user",
];

const SOURCE_FILTER_OPTIONS = RESOURCE_SKILL_SOURCE_FILTERS.map((source) => ({
  id: source,
  label: skillSourceFilterLabel(source),
}));

function providerLabel(
  provider: SkillProvider | null,
  providerRoster: ProviderRoster,
): string {
  if (provider === null) return "bb";
  return providerRoster.get(provider)?.displayName ?? provider;
}

function soleProvider(skill: SkillSummary): SkillProvider | null {
  const [provider, ...others] = skill.providers;
  return provider !== undefined && others.length === 0 ? provider : null;
}

function isSharedSkill(skill: SkillSummary): boolean {
  return skill.providers.length > 1;
}

function sharedProvidersLabel(
  skill: SkillSummary,
  providerRoster: ProviderRoster,
): string {
  return skill.providers
    .map((provider) => providerLabel(provider, providerRoster))
    .sort((left, right) => left.localeCompare(right))
    .join(", ");
}

function skillOwnerLabel(
  skill: SkillSummary,
  providerRoster: ProviderRoster,
): string {
  return isSharedSkill(skill)
    ? "Shared"
    : providerLabel(soleProvider(skill), providerRoster);
}

function providerFilterId(provider: SkillProvider): ResourceProviderFilter {
  return `provider:${provider}`;
}

function filterProviderId(
  filter: ResourceProviderFilter,
): SkillProvider | null {
  return filter.startsWith("provider:")
    ? filter.slice("provider:".length)
    : null;
}

function skillOwnerFilterId(skill: SkillSummary): ResourceProviderFilter {
  if (isSharedSkill(skill)) return "owner:shared";
  const provider = soleProvider(skill);
  return provider === null ? "owner:bb" : providerFilterId(provider);
}

function skillProviderFilterIds(skill: SkillSummary): ResourceProviderFilter[] {
  return isSharedSkill(skill)
    ? ["owner:shared", ...skill.providers.map(providerFilterId)]
    : [skillOwnerFilterId(skill)];
}

function providerFilterLabel(
  filter: ResourceProviderFilter,
  providerRoster: ProviderRoster,
): string {
  if (filter === "owner:bb") return "bb";
  if (filter === "owner:shared") return "Shared";
  return providerLabel(filterProviderId(filter), providerRoster);
}

function skillSourceFilterId(skill: SkillSummary): ResourceSkillSourceFilter {
  if (skill.scope === "bb-builtin") return "bb-official";
  if (skill.scope === "plugin") return "included";
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

function isResourceProviderFilter(
  value: string,
): value is ResourceProviderFilter {
  return (
    value === "owner:bb" ||
    value === "owner:shared" ||
    (value.startsWith("provider:") && value !== "provider:")
  );
}

export function ProviderLogo({
  providerId,
  provider,
  className,
}: {
  providerId: SkillProvider;
  provider?: ProviderInfo | undefined;
  className?: string;
}) {
  const info = getProviderIconInfo("agent", providerId, provider ?? null);
  if (!info) {
    return null;
  }
  if (provider === undefined) {
    const LogoIcon = info.icon;
    return <LogoIcon className={className} />;
  }
  return (
    <ProviderIconMark
      provider={provider}
      icon={info.icon}
      className={className}
    />
  );
}

export function SkillProvenanceTooltip({
  prefix,
  providerId,
  provider,
  name,
  shared = false,
}: {
  prefix: string;
  providerId: SkillProvider | null;
  provider?: ProviderInfo | undefined;
  name: string;
  shared?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span>{prefix}</span>
      <span
        data-provider-icon={shared ? "shared" : (providerId ?? "bb")}
        aria-hidden="true"
        className="flex size-3.5 shrink-0 items-center justify-center"
      >
        {shared ? (
          <Icon name="Layers" className="size-3.5" />
        ) : providerId === null ? (
          <BbLogo className="size-3.5 brightness-0 invert" />
        ) : (
          <ProviderLogo
            providerId={providerId}
            provider={provider}
            className="size-3.5"
          />
        )}
      </span>
      <span>{name}</span>
    </span>
  );
}

function SkillLeading({
  skill,
  providerRoster,
}: {
  skill: SkillSummary;
  providerRoster: ProviderRoster;
}) {
  if (isSharedSkill(skill)) {
    return <Icon name="Layers" className="size-6" />;
  }
  const provider = soleProvider(skill);
  if (provider !== null) {
    return (
      <ProviderLogo
        providerId={provider}
        provider={providerRoster.get(provider)}
        className="size-6"
      />
    );
  }
  return <BbLogo className="size-6" />;
}

function skillDescription(
  skill: SkillSummary,
  providerRoster: ProviderRoster,
): string {
  return (
    skill.description ??
    skillScopeLabel(skill, providerLabelForScope(skill, providerRoster))
  );
}

function providerLabelForScope(
  skill: SkillSummary,
  providerRoster: ProviderRoster,
): string | undefined {
  const provider = soleProvider(skill);
  return provider === null
    ? undefined
    : providerRoster.get(provider)?.displayName;
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
  providerRoster: ProviderRoster,
): string {
  return isSharedSkill(skill)
    ? `${providerPluginDisplayName(skill)} plugin, read by ${sharedProvidersLabel(skill, providerRoster)}`
    : `${providerPluginDisplayName(skill)} (${providerLabel(soleProvider(skill), providerRoster)} plugin)`;
}

function IncludedPluginTooltip({
  skill,
  providerRoster,
}: {
  skill: SkillSummary;
  providerRoster: ProviderRoster;
}) {
  const shared = isSharedSkill(skill);
  const provider = soleProvider(skill);
  return (
    <SkillProvenanceTooltip
      prefix="Included with"
      providerId={provider}
      provider={provider === null ? undefined : providerRoster.get(provider)}
      name={
        shared
          ? `${includedPluginDescription(skill, providerRoster)}.`
          : `${providerPluginDisplayName(skill)} plugin.`
      }
      shared={shared}
    />
  );
}

function skillMutationDisabledReason(
  skill: SkillSummary,
  providerRoster: ProviderRoster,
): string {
  if (skill.scope === "bb-builtin") return "Built-in skill";
  if (skill.scope === "plugin") return "Bundled with plugin";
  if (isSharedSkill(skill)) return "Read-only shared skill";
  return `Bundled with ${providerLabel(soleProvider(skill), providerRoster)}`;
}

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

const PREFETCH_HOVER_INTENT_MS = 150;

function SkillRow({
  skill,
  providerRoster,
  onSelect,
  onPrefetch,
}: {
  skill: SkillSummary;
  providerRoster: ProviderRoster;
  onSelect: () => void;
  onPrefetch?: (skill: SkillSummary) => void;
}) {
  const description = skillDescription(skill, providerRoster);
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
    <div
      onPointerEnter={schedulePrefetch}
      onPointerLeave={cancelScheduledPrefetch}
      onFocus={schedulePrefetch}
      onBlur={cancelScheduledPrefetch}
    >
      <ResourceRow
        leading={<SkillLeading skill={skill} providerRoster={providerRoster} />}
        title={skill.name}
        titleMeta={
          skill.scope === "bb-builtin" ? (
            <ProvenancePill label="BB Official" />
          ) : skill.scope === "plugin" ? (
            <ProvenancePill
              label="Included"
              tooltip={
                <IncludedPluginTooltip
                  skill={skill}
                  providerRoster={providerRoster}
                />
              }
              accessibleLabel={`${skill.name} is included with ${includedPluginDescription(skill, providerRoster)}`}
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

interface SkillsOverviewProps {
  skills: readonly SkillSummary[];
  providerRoster: ProviderRoster;
  isLoading: boolean;
  hasError: boolean;
  query?: string;
  activeMode?: SkillsCollectionMode;
  browseContent?: ReactNode;
  onCreateSkill: (prompt?: string) => void;
  onSelectSkill: (skill: SkillSummary) => void;
  onPrefetchSkill?: (skill: SkillSummary) => void;
  onQueryChange?: (query: string) => void;
  onRetry?: () => void;
}

type SkillsCollectionMode = "library" | "browse";

export function SkillsOverview({
  skills,
  providerRoster,
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
  >([]);
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
      for (const provider of skillProviderFilterIds(skill)) {
        counts.set(provider, (counts.get(provider) ?? 0) + 1);
      }
    }
    return counts;
  }, [skills]);
  const providerBucketCount = useMemo(
    () => new Set(skills.map(skillOwnerFilterId)).size,
    [skills],
  );
  const providerOptions = useMemo(() => {
    const present = new Set<ResourceProviderFilter>([
      "owner:bb",
      ...providerCounts.keys(),
      ...providerFilters,
    ]);
    const ordered = [...present].sort((left, right) =>
      left === "owner:bb" || right === "owner:bb"
        ? Number(left !== "owner:bb") - Number(right !== "owner:bb")
        : providerFilterLabel(left, providerRoster).localeCompare(
            providerFilterLabel(right, providerRoster),
          ),
    );
    return ordered.map((filter) => {
      const providerId = filterProviderId(filter);
      return {
        id: filter,
        label: providerFilterLabel(filter, providerRoster),
        leading:
          providerId !== null ? (
            <ProviderLogo
              providerId={providerId}
              provider={providerRoster.get(providerId)}
              className="size-4"
            />
          ) : filter === "owner:shared" ? (
            <Icon name="Layers" className="size-4" />
          ) : (
            <BbLogo className="size-4" />
          ),
        disabled:
          !providerCounts.has(filter) && !providerFilters.includes(filter),
      };
    });
  }, [providerCounts, providerRoster, providerFilters]);
  if (sortMode === "provider" && providerBucketCount <= 1) {
    setSortMode("alpha");
    setSortDirection("asc");
  }
  const visibleSkills = useMemo(() => {
    const filtered = skills.filter((skill) => {
      const source = skillSourceFilterId(skill);
      if (sourceFilters.length > 0 && !sourceFilters.includes(source)) {
        return false;
      }
      if (
        providerFilters.length > 0 &&
        !skillProviderFilterIds(skill).some((provider) =>
          providerFilters.includes(provider),
        )
      ) {
        return false;
      }
      return (
        normalizedQuery === "" ||
        [
          skill.name,
          skill.description ?? "",
          skillOwnerLabel(skill, providerRoster),
          sharedProvidersLabel(skill, providerRoster),
          skillScopeLabel(skill, providerLabelForScope(skill, providerRoster)),
        ]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery)
      );
    });
    return [...filtered].sort((left, right) => {
      const officialResult =
        Number(left.scope !== "bb-builtin") -
        Number(right.scope !== "bb-builtin");
      if (officialResult !== 0) return officialResult;
      const base =
        sortMode === "provider"
          ? skillOwnerLabel(left, providerRoster).localeCompare(
              skillOwnerLabel(right, providerRoster),
            ) || left.name.localeCompare(right.name)
          : left.name.localeCompare(right.name);
      if (base !== 0) return sortDirection === "asc" ? base : -base;
      return left.filePath.localeCompare(right.filePath);
    });
  }, [
    normalizedQuery,
    providerRoster,
    providerFilters,
    skills,
    sortDirection,
    sortMode,
    sourceFilters,
  ]);
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
            key={`${skill.scope}-${skill.providers.join(",")}-${skill.name}-${skill.filePath}`}
            skill={skill}
            providerRoster={providerRoster}
            onSelect={() => onSelectSkill(skill)}
            onPrefetch={onPrefetchSkill}
          />
        ))}
      </ResourceListPanel>
      <ResourceInfiniteScrollSentinel
        itemCount={libraryList.items.length}
        hasMore={libraryList.hasMore}
        onLoadMore={libraryList.loadMore}
      />
    </>
  );

  return (
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
                        options: SOURCE_FILTER_OPTIONS,
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

interface SkillDetailDialogViewProps {
  skill: SkillSummary | null;
  providerRoster: ProviderRoster;
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
  markdownLinkRouting?: MarkdownLinkRouting;
  onEdit: () => void;
  onRetry: () => void;
  onDelete: () => void;
  onOpenInEditor: () => void;
}

export function SkillDetailDialogView({
  skill,
  providerRoster,
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
  markdownLinkRouting,
  onEdit,
  onRetry,
  onDelete,
  onOpenInEditor,
}: SkillDetailDialogViewProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const skillId = skill?.id;
  const [confirmingDeleteSkillId, setConfirmingDeleteSkillId] =
    useState(skillId);
  if (confirmingDeleteSkillId !== skillId) {
    setConfirmingDeleteSkillId(skillId);
    setConfirmingDelete(false);
  }

  if (skill === null) return null;
  const bundledPluginName =
    skill.scope === "plugin" ? providerPluginNameForSkill(skill) : null;
  const importedProvider = soleProvider(skill);
  const disabledReason = skillMutationDisabledReason(skill, providerRoster);
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
      leading={<SkillLeading skill={skill} providerRoster={providerRoster} />}
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
                  <IncludedPluginTooltip
                    skill={skill}
                    providerRoster={providerRoster}
                  />
                ),
                accessibleLabel: `${skill.name} is included with ${includedPluginDescription(skill, providerRoster)}`,
              }
            : isSharedSkill(skill)
              ? {
                  label: "Shared",
                  tooltip: `Read by ${sharedProvidersLabel(skill, providerRoster)}`,
                  accessibleLabel: `${skill.name} is shared by ${sharedProvidersLabel(skill, providerRoster)}`,
                }
              : importedProvider !== null
                ? {
                    label: "Imported",
                    tooltip: (
                      <SkillProvenanceTooltip
                        prefix="Discovered from"
                        providerId={importedProvider}
                        provider={providerRoster.get(importedProvider)}
                        name={providerLabel(importedProvider, providerRoster)}
                      />
                    ),
                    accessibleLabel: `${skill.name} is imported from ${providerLabel(importedProvider, providerRoster)}`,
                  }
                : undefined
      }
      files={files.length > 0 ? files : ["SKILL.md"]}
      markdownLinkRouting={markdownLinkRouting}
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
