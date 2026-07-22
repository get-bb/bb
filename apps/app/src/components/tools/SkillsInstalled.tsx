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
} from "@bb/shared-ui/resource-list";
import { cn } from "@bb/shared-ui/lib/utils";
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
import {
  applySortDirection,
  compareNullableProvider,
  providerFilterLabel,
  providerLabel,
  RESOURCE_PROVIDER_FILTERS,
  skillProviderFilterId,
} from "@/lib/skills-filters";
import type {
  ResourceProviderFilter,
  ResourceSortDirection,
  ResourceSortMode,
} from "@/lib/skills-filters";

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

function bundledWithPluginReason(skill: SkillSummary): string {
  return "Bundled with plugin";
}

function includedPluginDescription(skill: SkillSummary): string {
  return `${providerPluginDisplayName(skill)} (${providerLabel(skill.provider)} plugin)`;
}

function skillEditDisabledReason(skill: SkillSummary): string {
  if (skill.scope === "bb-builtin") return "Built-in skill";
  if (skill.scope === "plugin") return bundledWithPluginReason(skill);
  return `Bundled with ${skill.provider === "claude-code" ? "Claude Code" : "Codex"}`;
}

function skillDeleteDisabledReason(skill: SkillSummary): string {
  if (skill.scope === "bb-builtin") return "Built-in skill";
  if (skill.scope === "plugin") return bundledWithPluginReason(skill);
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
          <ProvenancePill label="Built-in" />
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

type SkillsCollectionMode = "installed" | "browse";

/**
 * Presentational Skills list: provider-grouped, searchable, typeahead-style
 * rows. Split from the data-fetching container so it renders in tests/stories.
 */
export function SkillsOverview({
  skills,
  isLoading,
  hasError,
  query = "",
  activeMode = "installed",
  browseContent,
  onModeChange = () => {},
  onCreateSkill,
  onSelectSkill,
  onQueryChange = () => {},
  onRetry,
}: SkillsOverviewProps) {
  const [providerFilters, setProviderFilters] = useState<
    ResourceProviderFilter[]
  >([]);
  const [sortMode, setSortMode] = useState<ResourceSortMode>("alpha");
  const [sortDirection, setSortDirection] =
    useState<ResourceSortDirection>("asc");
  const [installedViewport, setInstalledViewport] =
    useState<HTMLDivElement | null>(null);
  const installedPageSize = useResourceViewportPageSize(installedViewport);
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
      disabled: !providerCounts.has(provider),
    }));
  }, [providerCounts]);
  useEffect(() => {
    setProviderFilters((current) =>
      current.filter((provider) => providerCounts.has(provider)),
    );
  }, [providerCounts]);
  useEffect(() => {
    if (sortMode === "provider" && providerBucketCount <= 1) {
      setSortMode("alpha");
      setSortDirection("asc");
    }
  }, [providerBucketCount, sortMode]);
  const visibleSkills = useMemo(() => {
    const filtered = skills.filter((skill) => {
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
      const base =
        sortMode === "provider"
          ? compareNullableProvider(left.provider, right.provider) ||
            left.name.localeCompare(right.name)
          : left.name.localeCompare(right.name);
      return applySortDirection(base, sortDirection);
    });
  }, [normalizedQuery, providerFilters, skills, sortDirection, sortMode]);
  const installedPagination = useResourcePagination(visibleSkills, {
    pageSize: installedPageSize,
    resetKey: [
      normalizedQuery,
      providerFilters.join(","),
      sortMode,
      sortDirection,
    ].join("\u0000"),
  });
  const hasInstalledPagination =
    !hasError &&
    !isLoading &&
    installedPagination.total > installedPagination.pageSize;
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
  const installedBody = hasError ? (
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
        normalizedQuery === "" && providerFilters.length === 0
          ? "No skills installed."
          : normalizedQuery === ""
            ? "No skills match these agents."
            : `No skills match "${query}"`
      }
    />
  ) : (
    <ResourceListPanel>
      {installedPagination.items.map((skill) => (
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
        { id: "installed", label: "Installed", count: skills.length },
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
          scrollId="skills-installed-results"
          viewportRef={setInstalledViewport}
          toolbar={
            <ResourceToolbar
              searchValue={query}
              searchPlaceholder="Search skills"
              onSearchChange={onQueryChange}
              controls={
                <>
                  <ResourceMultiSelectMenu
                    label="Agent"
                    icon="Layers"
                    selectedValues={providerFilters}
                    options={providerOptions}
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
                        label: "Agent",
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
            hasInstalledPagination ? (
              <ResourcePagination
                page={installedPagination.page}
                pageSize={installedPagination.pageSize}
                total={installedPagination.total}
                visibleCount={installedPagination.visibleCount}
                onPageChange={installedPagination.setPage}
                scrollTargetId="skills-installed-results"
              />
            ) : undefined
          }
        >
          {installedBody}
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
  const editDisabledReason = skillEditDisabledReason(skill);
  const deleteDisabledReason = skillDeleteDisabledReason(skill);
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
              ? editDisabledReason
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
            disabledReason: !canDelete ? deleteDisabledReason : undefined,
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
      headerControl={
        skill.scope === "bb-builtin"
          ? {
              kind: "status",
              label: "Built-in",
              tooltip: "Ships with bb",
              accessibleLabel: `${skill.name} is built into bb`,
            }
          : bundledPluginName !== null
            ? {
                kind: "status",
                label: "Included",
                tooltip: `Included with ${includedPluginDescription(skill)}`,
                accessibleLabel: `${skill.name} is included with ${includedPluginDescription(skill)}`,
              }
            : skill.provider !== null
              ? {
                  kind: "status",
                  label: "Imported",
                  tooltip: `Discovered from ${providerLabel(skill.provider)}`,
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
