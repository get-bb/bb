import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { SkillProvider, SkillSummary } from "@bb/server-contract";
import {
  ResourcePagination,
  useResourcePagination,
  useResourceViewportPageSize,
} from "@bb/shared-ui/resource-pagination";
import {
  ResourceCollectionPage,
  ResourceCollectionViewport,
  ResourceListPanel,
  ResourceListState,
  ResourceMultiSelectMenu,
  ResourceOverflowMenu,
  ResourceRow,
  ResourceRowDetailChevron,
  ResourceSortMenu,
  ResourceToolbar,
  type ResourceOption,
} from "@bb/shared-ui/resource-list";
import { cn } from "@bb/shared-ui/lib/utils";
import { TOOLS_OWNED_COLLECTION_LABEL } from "@/components/tools/tools-navigation";
import {
  ConfirmDeleteDialog,
  ConfirmDeleteDialogContent,
} from "@/components/dialogs/ConfirmDeleteDialog";
import { CreateWithTemplatesButton } from "@/components/create-via-prompt-examples";
import { ProvenancePill } from "@/components/tools/ProvenancePill";
import { SkillDetailView } from "@/components/tools/SkillDetailView";
import { SKILL_SCOPE_LABELS } from "@/components/tools/skill-taxonomy";
import {
  getProviderIconColorClass,
  getProviderIconInfo,
} from "@/lib/provider-icon";

type ResourceProviderFilter = "bb" | SkillProvider;
type ResourceSkillSourceFilter = "included" | "bb-official";
type ResourceSortMode = "provider" | "alpha";
type ResourceSortDirection = "asc" | "desc";

const RESOURCE_PROVIDER_FILTERS: readonly ResourceProviderFilter[] = [
  "bb",
  "claude-code",
  "codex",
];

const RESOURCE_SKILL_SOURCE_FILTERS: readonly ResourceSkillSourceFilter[] = [
  "included",
  "bb-official",
];

function providerLabel(provider: SkillProvider | null): string {
  return provider === null
    ? "bb"
    : (getProviderIconInfo(provider)?.ariaLabel ?? provider);
}

function skillProviderFilterId(skill: SkillSummary): ResourceProviderFilter {
  return skill.provider ?? "bb";
}

function providerFilterLabel(provider: ResourceProviderFilter): string {
  return provider === "bb" ? "bb" : providerLabel(provider);
}

function isResourceProviderFilter(
  value: string,
): value is ResourceProviderFilter {
  return value === "bb" || value === "claude-code" || value === "codex";
}

function skillSourceFilterId(
  skill: SkillSummary,
): ResourceSkillSourceFilter | null {
  if (skill.scope === "bb-builtin") return "bb-official";
  if (skill.scope === "plugin") return "included";
  return null;
}

function skillSourceFilterLabel(source: ResourceSkillSourceFilter): string {
  return source === "bb-official" ? "bb official" : "Included in plugin";
}

function isResourceSkillSourceFilter(
  value: string,
): value is ResourceSkillSourceFilter {
  return value === "included" || value === "bb-official";
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

function BbLogo({ className = "size-4" }: { className?: string }) {
  return (
    <img
      src="/bb-mark.svg"
      alt=""
      aria-hidden="true"
      className={cn(className, "object-contain dark:invert")}
    />
  );
}

function ProviderFilterTooltip({
  options,
}: {
  options: readonly ResourceOption[];
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span>Providers: </span>
      {options.map((option) => {
        if (!isResourceProviderFilter(option.id)) return null;
        const provider = option.id;
        return (
          <span
            key={option.id}
            className="flex size-3.5 items-center justify-center"
            data-provider-icon={provider}
            aria-hidden="true"
          >
            {provider === "bb" ? (
              <BbLogo className="size-3.5 brightness-0 invert" />
            ) : (
              <ProviderLogo providerId={provider} className="size-3.5" />
            )}
          </span>
        );
      })}
    </span>
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

function skillDescription(skill: SkillSummary): string {
  return skill.description ?? SKILL_SCOPE_LABELS[skill.scope];
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

function includedPluginDescription(skill: SkillSummary): string {
  return `${providerPluginDisplayName(skill)} (${providerLabel(skill.provider)} plugin)`;
}

function skillMutationDisabledReason(skill: SkillSummary): string {
  if (skill.scope === "bb-builtin") return "Built-in skill";
  if (skill.scope === "plugin") return "Bundled with plugin";
  return `Bundled with ${skill.provider === "claude-code" ? "Claude Code" : "Codex"}`;
}

function SkillRow({
  skill,
  onSelect,
}: {
  skill: SkillSummary;
  onSelect: () => void;
}) {
  const description = skillDescription(skill);
  return (
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
            accessibleLabel={`${skill.name} is included with ${includedPluginDescription(skill)}`}
          />
        ) : undefined
      }
      description={description}
      onOpen={onSelect}
      trailingVisual={<ResourceRowDetailChevron />}
    />
  );
}

export interface SkillsOverviewProps {
  skills: readonly SkillSummary[];
  isLoading: boolean;
  hasError: boolean;
  query?: string;
  activeMode?: SkillsCollectionMode;
  browseContent?: ReactNode;
  onModeChange?: (mode: SkillsCollectionMode) => void;
  /** Opens the composer to create a skill, optionally seeded with a full prompt. */
  onCreateSkill: (prompt?: string) => void;
  onSelectSkill: (skill: SkillSummary) => void;
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
  isLoading,
  hasError,
  query = "",
  activeMode = "library",
  browseContent,
  onModeChange = () => {},
  onCreateSkill,
  onSelectSkill,
  onQueryChange = () => {},
  onRetry,
}: SkillsOverviewProps) {
  const [providerFilters, setProviderFilters] = useState<
    ResourceProviderFilter[]
  >(["bb"]);
  const [sourceFilters, setSourceFilters] = useState<
    ResourceSkillSourceFilter[]
  >(["bb-official"]);
  const [sortMode, setSortMode] = useState<ResourceSortMode>("alpha");
  const [sortDirection, setSortDirection] =
    useState<ResourceSortDirection>("asc");
  const [libraryViewport, setLibraryViewport] = useState<HTMLDivElement | null>(
    null,
  );
  const libraryPageSize = useResourceViewportPageSize(libraryViewport);
  const normalizedQuery = query.trim().toLowerCase();
  const providerCounts = useMemo(() => {
    const counts = new Map<ResourceProviderFilter, number>();
    for (const skill of skills) {
      const provider = skillProviderFilterId(skill);
      counts.set(provider, (counts.get(provider) ?? 0) + 1);
    }
    return counts;
  }, [skills]);
  const providerBucketCount = providerCounts.size;
  const providerOptions = useMemo(() => {
    return RESOURCE_PROVIDER_FILTERS.map((provider) => ({
      id: provider,
      label: providerFilterLabel(provider),
      leading:
        provider === "bb" ? (
          <BbLogo className="size-4" />
        ) : (
          <ProviderLogo providerId={provider} className="size-4" />
        ),
      disabled:
        !providerCounts.has(provider) && !providerFilters.includes(provider),
    }));
  }, [providerCounts, providerFilters]);
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
      if (source !== null && !sourceFilters.includes(source)) {
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
          providerLabel(skill.provider),
          SKILL_SCOPE_LABELS[skill.scope],
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
          ? providerLabel(left.provider).localeCompare(
              providerLabel(right.provider),
            ) || left.name.localeCompare(right.name)
          : left.name.localeCompare(right.name);
      if (base !== 0) return sortDirection === "asc" ? base : -base;
      return left.filePath.localeCompare(right.filePath);
    });
  }, [
    normalizedQuery,
    providerFilters,
    skills,
    sortDirection,
    sortMode,
    sourceFilters,
  ]);
  const libraryPagination = useResourcePagination(visibleSkills, {
    pageSize: libraryPageSize,
    resetKey: [
      normalizedQuery,
      providerFilters.join(","),
      sourceFilters.join(","),
      sortMode,
      sortDirection,
    ].join("\u0000"),
  });
  const hasLibraryPagination =
    !hasError &&
    !isLoading &&
    libraryPagination.total > libraryPagination.pageSize;
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
        normalizedQuery !== ""
          ? `No skills match "${query}"`
          : skills.length === 0
            ? "No skills in your library."
            : "No skills match these filters."
      }
    />
  ) : (
    <ResourceListPanel>
      {libraryPagination.items.map((skill) => (
        <SkillRow
          key={`${skill.scope}-${skill.provider ?? "bb"}-${skill.name}-${skill.filePath}`}
          skill={skill}
          onSelect={() => onSelectSkill(skill)}
        />
      ))}
    </ResourceListPanel>
  );

  return (
    <ResourceCollectionPage
      id="skills-collection"
      description="Create and manage agent skills. bb skills work across every agent you use in bb."
      modes={[
        {
          id: "library",
          label: TOOLS_OWNED_COLLECTION_LABEL.skills,
          count: skills.length,
        },
        { id: "browse", label: "Browse" },
      ]}
      activeMode={activeMode}
      onModeChange={onModeChange}
      actions={
        <CreateWithTemplatesButton
          kind="skill"
          label="New bb skill"
          onCreate={onCreateSkill}
        />
      }
    >
      {activeMode === "browse" ? (
        browseContent
      ) : (
        <ResourceCollectionViewport
          scrollId="skills-library-results"
          viewportRef={setLibraryViewport}
          toolbar={
            <ResourceToolbar
              searchValue={query}
              searchPlaceholder="Search skills"
              onSearchChange={onQueryChange}
              controls={
                <>
                  <ResourceMultiSelectMenu
                    label="Type"
                    icon="PackageReceive"
                    selectedValues={sourceFilters}
                    options={sourceOptions}
                    allOptionLabel="All"
                    emptySelectionLabel="None"
                    selectedLabel={(options) =>
                      options.map((option) => option.label).join(", ")
                    }
                    onChange={(values) =>
                      setSourceFilters(
                        values.filter(isResourceSkillSourceFilter),
                      )
                    }
                  />
                  <ResourceMultiSelectMenu
                    label="Provider"
                    icon="Layers"
                    selectedValues={providerFilters}
                    options={providerOptions}
                    selectedLabel={(options) =>
                      options.map((option) => option.label).join(", ")
                    }
                    selectedTooltip={(options) => (
                      <ProviderFilterTooltip options={options} />
                    )}
                    onChange={(values) =>
                      setProviderFilters(values as ResourceProviderFilter[])
                    }
                  />
                  <ResourceSortMenu
                    value={sortMode}
                    direction={sortDirection}
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
          footer={
            hasLibraryPagination ? (
              <ResourcePagination
                page={libraryPagination.page}
                pageSize={libraryPagination.pageSize}
                total={libraryPagination.total}
                visibleCount={libraryPagination.visibleCount}
                onPageChange={libraryPagination.setPage}
                scrollTargetId="skills-library-results"
              />
            ) : undefined
          }
        >
          {libraryBody}
        </ResourceCollectionViewport>
      )}
    </ResourceCollectionPage>
  );
}

export interface SkillDetailDialogViewProps {
  skill: SkillSummary | null;
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
                accessibleLabel: `${skill.name} is included with ${includedPluginDescription(skill)}`,
              }
            : skill.provider !== null
              ? {
                  label: "Imported",
                  tooltip: (
                    <SkillProvenanceTooltip
                      prefix="Discovered from"
                      providerId={skill.provider}
                      name={providerLabel(skill.provider)}
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
