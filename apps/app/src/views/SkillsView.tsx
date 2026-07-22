import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { buildSkillEditThreadPrompt } from "@bb/shared-ui/resource-edit-prompt";
import type {
  EditableSkillScope,
  SkillProvider,
  SkillSummary,
} from "@bb/server-contract";
import {
  ResourcePagination,
  useResourcePagination,
  useResourceViewportPageSize,
} from "@bb/shared-ui/resource-pagination";
import { appToast } from "@/components/ui/app-toast";
import { SkillDetailView } from "@/components/tools/SkillDetailView";
import {
  RegistrySkillDetailView,
  RegistrySkillsBrowsePage,
} from "@/components/tools/SkillsBrowse";
import { ProvenancePill } from "@/components/tools/ProvenancePill";
import {
  isSkillEditable,
  SKILL_SCOPE_LABELS,
} from "@/components/tools/skill-taxonomy";
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
  useResourceRouteLabel,
} from "@bb/shared-ui/resource-list";
import { PageShell } from "@/components/ui/page-shell.js";
import {
  ConfirmDeleteDialog,
  ConfirmDeleteDialogContent,
} from "@/components/dialogs/ConfirmDeleteDialog";
import { CREATE_SKILL_PROMPT } from "@/lib/automation-prompt";
import { CreateWithTemplatesButton } from "@/components/create-via-prompt-examples";
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
import {
  fetchRegistrySkillDetail,
  fetchRegistrySkillEntry,
  fetchRegistrySkills,
  installRegistrySkill,
  REGISTRY_PAGE_SIZE,
  resolveInstalledRegistrySkill,
} from "@/lib/skills-registry";
import type { RegistryPagination, RegistrySkill } from "@/lib/skills-registry";
import {
  getRegistrySkillDetailRoutePath,
  getRegistrySkillsRoutePath,
  getRootComposeRoutePath,
  getSkillDetailRoutePath,
  getSkillsRoutePath,
} from "@/lib/route-paths";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  useDeleteSkill,
  useProjectSkills,
  useSkillContent,
  useSkillFiles,
} from "@/hooks/queries/skills-queries";
import { useLocalOpenTargets } from "@/hooks/useLocalOpenTargets";

export type {
  RegistryPagination,
  RegistrySkill,
  RegistrySkillDetail,
  RegistrySkillFile,
  RegistrySkillsPage,
} from "@/lib/skills-registry";
export {
  fetchRegistrySkillDetail,
  fetchRegistrySkillEntry,
  fetchRegistrySkills,
  formatInstallCount,
  formatRegistrySource,
  installRegistrySkill,
  normalizeSkillName,
  resolveInstalledRegistrySkill,
} from "@/lib/skills-registry";
export { RegistrySkillsBrowsePage } from "@/components/tools/SkillsBrowse";

const EMPTY_SKILLS: readonly SkillSummary[] = [];
const EMPTY_REGISTRY_PAGINATION: RegistryPagination = {
  page: 0,
  perPage: REGISTRY_PAGE_SIZE,
  total: 0,
  hasMore: false,
};
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

/**
 * View a skill's SKILL.md. Writable user-owned local skills can start an edit
 * thread or be deleted. Connected — owns the content/delete queries and renders
 * {@link SkillDetailDialogView}.
 */
function SkillDetailPage({
  projectId,
  skill,
  onClose,
  onEdit,
}: {
  projectId: string;
  skill: SkillSummary | null;
  onClose: () => void;
  onEdit: (skill: SkillSummary) => void;
}) {
  const [selectedPath, setSelectedPath] = useState("SKILL.md");
  useEffect(() => {
    setSelectedPath("SKILL.md");
  }, [skill?.id]);
  const filesQuery = useSkillFiles(projectId, skill);
  const contentQuery = useSkillContent(projectId, skill, selectedPath);
  const deleteSkill = useDeleteSkill(projectId);
  // Skills live on the local host (personal project), so the SKILL.md is a real
  // local file we can hand to the user's editor.
  const { canOpenPreferredFileTarget, openPathInPreferredFileTarget } =
    useLocalOpenTargets({ enabled: skill !== null });

  const deletableScope: EditableSkillScope | null =
    skill && skill.manageable && isSkillEditable(skill) ? skill.scope : null;
  const editableScope: EditableSkillScope | null =
    skill && isSkillEditable(skill) ? skill.scope : null;

  return (
    <SkillDetailDialogView
      skill={skill}
      files={filesQuery.data?.files ?? ["SKILL.md"]}
      selectedPath={selectedPath}
      onSelectPath={setSelectedPath}
      content={contentQuery.data?.content ?? ""}
      isLoadingContent={contentQuery.isLoading}
      isContentError={contentQuery.isError}
      canEdit={editableScope !== null}
      canDelete={deletableScope !== null}
      canOpenInEditor={editableScope !== null && canOpenPreferredFileTarget}
      isDeleting={deleteSkill.isPending}
      onEdit={() => {
        if (skill) onEdit(skill);
      }}
      onRetry={() => {
        void filesQuery.refetch();
        void contentQuery.refetch();
      }}
      onDelete={() => {
        if (!skill || deletableScope === null) return;
        deleteSkill.mutate(
          { skillId: skill.id, environmentId: null },
          { onSuccess: onClose },
        );
      }}
      onOpenInEditor={() => {
        if (!skill) return;
        void openPathInPreferredFileTarget({
          path: skill.filePath,
          lineNumber: null,
        });
      }}
    />
  );
}

export function SkillsLibrary() {
  const navigate = useNavigate();
  const location = useLocation();
  const { skillId: routeSkillId, registrySkillId: routeRegistrySkillId } =
    useParams<{
      skillId?: string;
      registrySkillId?: string;
    }>();
  const [installedQuery, setInstalledQuery] = useState("");
  const [registrySearch, setRegistrySearch] = useState("");
  const [registryPage, setRegistryPage] = useState(0);
  const [confirmedRegistryInstalls, setConfirmedRegistryInstalls] = useState<
    Map<string, string | null>
  >(() => new Map());
  const skillsQuery = useProjectSkills(PERSONAL_PROJECT_ID);
  const deleteSkill = useDeleteSkill(PERSONAL_PROJECT_ID);
  const skills = skillsQuery.data?.skills ?? EMPTY_SKILLS;
  const hasError = skillsQuery.isError && skillsQuery.data === undefined;
  const isLoading =
    skillsQuery.isFetching && skillsQuery.data === undefined && !hasError;
  const isRegistryBrowseRoute =
    location.pathname === getRegistrySkillsRoutePath() ||
    new URLSearchParams(location.search).get("view") === "browse";
  const registryRequestPage =
    isRegistryBrowseRoute || routeRegistrySkillId !== undefined
      ? registryPage
      : 0;
  const registryQuery = useQuery({
    queryKey: ["skills-registry", registrySearch.trim(), registryRequestPage],
    queryFn: () =>
      fetchRegistrySkills({
        query: registrySearch,
        page: registryRequestPage,
        perPage: REGISTRY_PAGE_SIZE,
      }),
    enabled: isRegistryBrowseRoute,
    staleTime: 60_000,
  });
  const registryInstall = useMutation({
    mutationFn: installRegistrySkill,
    onSuccess: (result, variables) => {
      setConfirmedRegistryInstalls((current) => {
        const next = new Map(current);
        next.set(variables.skill.id, result.filePath);
        return next;
      });
      appToast.success("Skill installed");
      void skillsQuery.refetch();
    },
    onError: (error) => {
      appToast.error(error instanceof Error ? error.message : String(error));
    },
  });
  const selectedSkill = useMemo(() => {
    if (routeSkillId === undefined) return null;
    return skills.find((skill) => skill.id === routeSkillId) ?? null;
  }, [routeSkillId, skills]);
  const registrySkillOnPage = useMemo(() => {
    if (routeRegistrySkillId === undefined) {
      return null;
    }
    return (
      (registryQuery.data?.skills ?? []).find(
        (skill) =>
          skill.id === routeRegistrySkillId ||
          skill.skillId === routeRegistrySkillId,
      ) ?? null
    );
  }, [registryQuery.data, routeRegistrySkillId]);
  const registryEntryQuery = useQuery({
    queryKey: ["skills-registry-entry", routeRegistrySkillId ?? "none"],
    queryFn: () => fetchRegistrySkillEntry(routeRegistrySkillId!),
    enabled: routeRegistrySkillId !== undefined && registrySkillOnPage === null,
    staleTime: 5 * 60_000,
  });
  const selectedRegistrySkill =
    registrySkillOnPage ?? registryEntryQuery.data ?? null;
  useResourceRouteLabel(
    selectedSkill?.name ?? selectedRegistrySkill?.name ?? null,
  );
  const registryDetailQuery = useQuery({
    queryKey: ["skills-registry-detail", selectedRegistrySkill?.id ?? "none"],
    queryFn: () =>
      fetchRegistrySkillDetail({
        source: selectedRegistrySkill!.source,
        skillId: selectedRegistrySkill!.skillId,
      }),
    enabled: selectedRegistrySkill !== null,
    staleTime: 5 * 60_000,
  });
  const findInstalledRegistrySkill = useCallback(
    (skill: RegistrySkill): SkillSummary | null =>
      resolveInstalledRegistrySkill(skill, skills),
    [skills],
  );
  const findVerifiedInstalledRegistrySkill = useCallback(
    (skill: RegistrySkill): SkillSummary | null => {
      const persistedSkill = findInstalledRegistrySkill(skill);
      if (persistedSkill !== null) return persistedSkill;
      const installedPath = confirmedRegistryInstalls.get(skill.id);
      if (typeof installedPath !== "string") return null;
      return (
        skills.find(
          (installedSkill) =>
            installedSkill.scope === "bb-user" &&
            installedSkill.provider === null &&
            installedSkill.filePath === installedPath &&
            installedSkill.registrySkillId === skill.id,
        ) ?? null
      );
    },
    [confirmedRegistryInstalls, findInstalledRegistrySkill, skills],
  );
  const isRegistrySkillInstalled = useCallback(
    (skill: RegistrySkill): boolean => {
      if (confirmedRegistryInstalls.has(skill.id)) {
        return confirmedRegistryInstalls.get(skill.id) !== null;
      }
      return findInstalledRegistrySkill(skill) !== null;
    },
    [confirmedRegistryInstalls, findInstalledRegistrySkill],
  );
  const installRegistry = useCallback(
    (skill: RegistrySkill) => {
      registryInstall.mutate({ skill });
    },
    [registryInstall],
  );
  const canUninstallRegistrySkill = useCallback(
    (skill: RegistrySkill) =>
      findVerifiedInstalledRegistrySkill(skill) !== null ||
      typeof confirmedRegistryInstalls.get(skill.id) === "string",
    [confirmedRegistryInstalls, findVerifiedInstalledRegistrySkill],
  );
  const uninstallRegistry = useCallback(
    (skill: RegistrySkill) => {
      void (async () => {
        const confirmedPath = confirmedRegistryInstalls.get(skill.id);
        const refreshedSkills =
          findVerifiedInstalledRegistrySkill(skill) === null &&
          typeof confirmedPath === "string"
            ? (await skillsQuery.refetch()).data?.skills
            : skills;
        const installedSkill =
          findVerifiedInstalledRegistrySkill(skill) ??
          (typeof confirmedPath === "string"
            ? (refreshedSkills?.find(
                (candidate) =>
                  candidate.scope === "bb-user" &&
                  candidate.provider === null &&
                  candidate.filePath === confirmedPath &&
                  candidate.registrySkillId === skill.id,
              ) ?? null)
            : null);
        if (installedSkill === null) {
          appToast.error(
            "The installed skill is still being indexed. Try again.",
          );
          return;
        }
        deleteSkill.mutate(
          {
            skillId: installedSkill.id,
            environmentId: null,
          },
          {
            onSuccess: () => {
              setConfirmedRegistryInstalls((current) => {
                const next = new Map(current);
                next.set(skill.id, null);
                return next;
              });
              appToast.success("Skill uninstalled", {
                action: {
                  label: "Reinstall",
                  onClick: () => registryInstall.mutate({ skill }),
                },
              });
              void skillsQuery.refetch();
            },
          },
        );
      })();
    },
    [
      confirmedRegistryInstalls,
      deleteSkill,
      findVerifiedInstalledRegistrySkill,
      registryInstall,
      skills,
      skillsQuery,
    ],
  );
  const openSkill = useCallback(
    (skill: SkillSummary) => {
      navigate(
        getSkillDetailRoutePath({
          skillId: skill.id,
        }),
      );
    },
    [navigate],
  );
  const editSkillViaThread = useCallback(
    (skill: SkillSummary) => {
      navigate(getRootComposeRoutePath(), {
        state: {
          focusPrompt: true,
          initialPrompt: buildSkillEditThreadPrompt({
            id: skill.id,
            name: skill.name,
            path: skill.filePath,
          }),
          replaceInitialPrompt: true,
        },
      });
    },
    [navigate],
  );
  const openRegistrySkill = useCallback(
    (skill: RegistrySkill) => {
      const installedSkill = findInstalledRegistrySkill(skill);
      if (installedSkill !== null) {
        navigate(
          getSkillDetailRoutePath({
            skillId: installedSkill.id,
          }),
        );
        return;
      }
      if (!isRegistryBrowseRoute) setRegistryPage(0);
      navigate(getRegistrySkillDetailRoutePath({ registrySkillId: skill.id }));
    },
    [findInstalledRegistrySkill, isRegistryBrowseRoute, navigate],
  );
  const handleRegistryQueryChange = useCallback((nextQuery: string) => {
    setRegistrySearch(nextQuery);
    setRegistryPage(0);
  }, []);
  const changeCollectionMode = useCallback(
    (mode: SkillsCollectionMode) => {
      if (mode === "browse") {
        setRegistryPage(0);
        navigate(`${getSkillsRoutePath()}?view=browse`);
        return;
      }
      navigate(getSkillsRoutePath());
    },
    [navigate],
  );
  const closeSkillDetail = useCallback(() => {
    navigate(getSkillsRoutePath());
  }, [navigate]);
  // Create via prompt: open the composer seeded with the bb-skill prompt; the
  // spawned thread authors the SKILL.md.
  const handleCreateSkill = useCallback(
    (prompt?: string) => {
      navigate(getRootComposeRoutePath(), {
        state: {
          focusPrompt: true,
          initialPrompt: prompt ?? CREATE_SKILL_PROMPT,
          replaceInitialPrompt: true,
          createDraftKind: "skill",
        },
      });
    },
    [navigate],
  );
  const pendingRegistrySkillId =
    registryInstall.isPending && registryInstall.variables
      ? registryInstall.variables.skill.id
      : null;
  const pendingRegistryUninstallSkillId = deleteSkill.isPending
    ? ((registryQuery.data?.skills ?? []).find(
        (skill) =>
          findVerifiedInstalledRegistrySkill(skill)?.id ===
          deleteSkill.variables?.skillId,
      )?.id ?? null)
    : null;
  const registryDetail = registryDetailQuery.data ?? null;
  return (
    <>
      {routeSkillId !== undefined && hasError ? (
        <ResourceListState
          state="error"
          message="Couldn't load skill."
          onRetry={() => void skillsQuery.refetch()}
        />
      ) : routeSkillId !== undefined && isLoading ? (
        <ResourceListState state="loading" message="Loading skill" />
      ) : routeSkillId !== undefined && selectedSkill === null ? (
        <ResourceListState state="empty" message="Skill not found." />
      ) : selectedSkill ? (
        <SkillDetailPage
          projectId={PERSONAL_PROJECT_ID}
          skill={selectedSkill}
          onClose={closeSkillDetail}
          onEdit={editSkillViaThread}
        />
      ) : routeRegistrySkillId !== undefined &&
        selectedRegistrySkill === null ? (
        <ResourceListState
          state={registryEntryQuery.isError ? "error" : "loading"}
          message={
            registryEntryQuery.isError
              ? "This registry skill could not be loaded."
              : "Loading registry skill"
          }
          onRetry={() => void registryEntryQuery.refetch()}
        />
      ) : selectedRegistrySkill && registryDetailQuery.isLoading ? (
        <ResourceListState state="loading" message="Checking skill source" />
      ) : selectedRegistrySkill &&
        (registryDetailQuery.isError || registryDetail === null) ? (
        <ResourceListState
          state="error"
          message="This registry skill is no longer available from its source."
          onRetry={() => void registryDetailQuery.refetch()}
        />
      ) : selectedRegistrySkill ? (
        <RegistrySkillDetailView
          skill={selectedRegistrySkill}
          detail={registryDetail}
          isLoadingDetail={false}
          isDetailError={false}
          installed={isRegistrySkillInstalled(selectedRegistrySkill)}
          installedSkill={findVerifiedInstalledRegistrySkill(
            selectedRegistrySkill,
          )}
          installedPath={
            findVerifiedInstalledRegistrySkill(selectedRegistrySkill)
              ?.filePath ??
            confirmedRegistryInstalls.get(selectedRegistrySkill.id) ??
            null
          }
          pending={pendingRegistrySkillId === selectedRegistrySkill.id}
          uninstallPending={
            deleteSkill.isPending &&
            findVerifiedInstalledRegistrySkill(selectedRegistrySkill)?.id ===
              deleteSkill.variables?.skillId
          }
          onRetry={() => void registryDetailQuery.refetch()}
          onInstall={installRegistry}
          onUninstall={
            canUninstallRegistrySkill(selectedRegistrySkill)
              ? uninstallRegistry
              : undefined
          }
          onEditInstalledSkill={editSkillViaThread}
        />
      ) : (
        <SkillsOverview
          skills={skills}
          isLoading={isLoading}
          hasError={hasError}
          query={installedQuery}
          activeMode={isRegistryBrowseRoute ? "browse" : "installed"}
          onModeChange={changeCollectionMode}
          browseContent={
            <RegistrySkillsBrowsePage
              skills={registryQuery.data?.skills ?? []}
              pagination={
                registryQuery.data?.pagination ?? {
                  ...EMPTY_REGISTRY_PAGINATION,
                  page: registryRequestPage,
                }
              }
              isLoading={
                registryQuery.isFetching && registryQuery.data === undefined
              }
              hasError={registryQuery.isError}
              query={registrySearch}
              pendingSkillId={
                pendingRegistrySkillId ?? pendingRegistryUninstallSkillId
              }
              onRetry={() => void registryQuery.refetch()}
              onQueryChange={handleRegistryQueryChange}
              onPageChange={setRegistryPage}
              onInstall={installRegistry}
              onUninstall={uninstallRegistry}
              onSelect={openRegistrySkill}
              isInstalled={isRegistrySkillInstalled}
              canUninstall={canUninstallRegistrySkill}
            />
          }
          onCreateSkill={handleCreateSkill}
          onSelectSkill={openSkill}
          onQueryChange={setInstalledQuery}
          onRetry={() => void skillsQuery.refetch()}
        />
      )}
    </>
  );
}

export function SkillsView() {
  return (
    <PageShell contentClassName="pt-4 md:pt-5" maxWidthClassName="max-w-5xl">
      <SkillsLibrary />
    </PageShell>
  );
}
