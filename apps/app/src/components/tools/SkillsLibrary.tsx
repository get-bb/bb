import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useQueries, useQuery } from "@tanstack/react-query";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { buildSkillEditThreadPrompt } from "@bb/shared-ui/resource-edit-prompt";
import type { EditableSkillScope, SkillSummary } from "@bb/server-contract";
import {
  ResourceListState,
  useResourceRouteLabel,
} from "@bb/shared-ui/resource-list";
import {
  RegistrySkillDetailView,
  RegistrySkillsBrowsePage,
} from "@/components/tools/SkillsBrowse";
import { getToolsOwnedCollectionRoutePath } from "@/components/tools/tools-navigation";
import {
  SkillDetailDialogView,
  SkillsOverview,
} from "@/components/tools/SkillsCollection";
import { isSkillEditable } from "@/components/tools/skill-taxonomy";
import { CREATE_SKILL_PROMPT } from "@/lib/create-resource-prompts";
import {
  buildRegistrySkillReferencePrompt,
  fetchRegistrySkillDetail,
  fetchRegistrySkillEntry,
  fetchRegistryRepositoryStars,
  fetchRegistrySkills,
  REGISTRY_PAGE_SIZE,
  registryRepositoryKey,
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
import {
  useDeleteSkill,
  useProjectSkills,
  useSkillContent,
  useSkillFiles,
} from "@/hooks/queries/skills-queries";
import { useLocalOpenTargets } from "@/hooks/useLocalOpenTargets";

const EMPTY_SKILLS: readonly SkillSummary[] = [];
const EMPTY_REGISTRY_PAGINATION: RegistryPagination = {
  page: 0,
  perPage: REGISTRY_PAGE_SIZE,
  total: 0,
  hasMore: false,
};
const REGISTRY_LIST_STALE_TIME_MS = 30 * 60_000;

type SkillsCollectionMode = "library" | "browse";

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
  const [libraryQuery, setLibraryQuery] = useState("");
  const [registrySearch, setRegistrySearch] = useState("");
  const [registryPage, setRegistryPage] = useState(0);
  const skillsQuery = useProjectSkills(PERSONAL_PROJECT_ID);
  const skills = skillsQuery.data?.skills ?? EMPTY_SKILLS;
  const hasError = skillsQuery.isError && skillsQuery.data === undefined;
  const isLoading =
    skillsQuery.isFetching && skillsQuery.data === undefined && !hasError;
  const isRegistryBrowseRoute =
    location.pathname === getRegistrySkillsRoutePath() ||
    (location.pathname === getSkillsRoutePath() &&
      new URLSearchParams(location.search).get("view") !== "library");
  const registryRequestPage =
    isRegistryBrowseRoute || routeRegistrySkillId !== undefined
      ? registryPage
      : 0;
  const registryQuery = useQuery({
    queryKey: ["skills-registry", registrySearch.trim(), registryRequestPage],
    queryFn: ({ signal }) =>
      fetchRegistrySkills({
        query: registrySearch,
        page: registryRequestPage,
        perPage: REGISTRY_PAGE_SIZE,
        signal,
      }),
    enabled: isRegistryBrowseRoute,
    refetchOnWindowFocus: false,
    staleTime: REGISTRY_LIST_STALE_TIME_MS,
  });
  const registryRepositorySources = useMemo(() => {
    const sources = new Map<string, string>();
    for (const skill of registryQuery.data?.skills ?? []) {
      if (skill.stars === null) {
        const repositoryKey = registryRepositoryKey(skill.source);
        if (!sources.has(repositoryKey)) {
          sources.set(repositoryKey, skill.source);
        }
      }
    }
    return [...sources.entries()].map(([repositoryKey, source]) => ({
      repositoryKey,
      source,
    }));
  }, [registryQuery.data?.skills]);
  const registryRepositoryStars = useQueries({
    queries: registryRepositorySources.map(({ repositoryKey, source }) => ({
      queryKey: ["skills-registry-repository-stars", repositoryKey],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchRegistryRepositoryStars(source, signal),
      enabled: isRegistryBrowseRoute,
      staleTime: 6 * 60 * 60_000,
      retry: false,
      // staleTime only protects successes: an errored query has no
      // dataUpdatedAt, so it is permanently stale and the app-wide
      // refetch-on-focus default re-fires every failed lookup on every focus,
      // against a 60-request/hour GitHub budget. This also stops successful
      // results refreshing on focus, which is fine — star counts and
      // descriptions move slowly and still refresh on remount.
      refetchOnWindowFocus: false,
    })),
    // `combine` results are structurally shared, so this Map is referentially
    // stable across renders. That lets the enrichment memo below list honest
    // dependencies instead of hashing query data by hand.
    combine: (results) => ({
      values: new Map(
        registryRepositorySources.flatMap(({ repositoryKey }, index) => {
          const value = results[index]?.data;
          return value === undefined ? [] : ([[repositoryKey, value]] as const);
        }),
      ),
      pendingRepositoryKeys: new Set(
        registryRepositorySources.flatMap(({ repositoryKey }, index) =>
          results[index]?.isPending ? [repositoryKey] : [],
        ),
      ),
    }),
  });
  const registryDescriptionSkills = useMemo(
    () =>
      (registryQuery.data?.skills ?? []).filter(
        (skill) => skill.summary === null,
      ),
    [registryQuery.data?.skills],
  );
  const registryDescriptions = useQueries({
    queries: registryDescriptionSkills.map((skill) => ({
      queryKey: ["skills-registry-entry", skill.id],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchRegistrySkillEntry(skill.id, signal),
      enabled: isRegistryBrowseRoute,
      staleTime: 30 * 60_000,
      retry: false,
      refetchOnWindowFocus: false,
    })),
    combine: (results) => ({
      values: new Map(
        registryDescriptionSkills.flatMap((skill, index) => {
          const entry = results[index]?.data;
          return entry === undefined ? [] : ([[skill.id, entry]] as const);
        }),
      ),
      pendingSkillIds: new Set(
        registryDescriptionSkills.flatMap((skill, index) =>
          results[index]?.isPending ? [skill.id] : [],
        ),
      ),
    }),
  });
  const registrySkills = useMemo(
    () =>
      (registryQuery.data?.skills ?? []).map((skill) => {
        const entry = registryDescriptions.values.get(skill.id);
        const describedSkill =
          entry === undefined
            ? skill
            : { ...skill, topic: entry.topic, summary: entry.summary };
        if (describedSkill.stars !== null) return describedSkill;
        const stars = registryRepositoryStars.values.get(
          registryRepositoryKey(describedSkill.source),
        );
        return stars === undefined
          ? describedSkill
          : { ...describedSkill, stars };
      }),
    [
      registryQuery.data?.skills,
      registryDescriptions.values,
      registryRepositoryStars.values,
    ],
  );
  const pendingRegistrySkillIds = useMemo(
    () =>
      new Set(
        (registryQuery.data?.skills ?? []).flatMap((skill) =>
          registryDescriptions.pendingSkillIds.has(skill.id) ||
          registryRepositoryStars.pendingRepositoryKeys.has(
            registryRepositoryKey(skill.source),
          )
            ? [skill.id]
            : [],
        ),
      ),
    [
      registryDescriptions.pendingSkillIds,
      registryQuery.data?.skills,
      registryRepositoryStars.pendingRepositoryKeys,
    ],
  );
  const selectedSkill = useMemo(() => {
    if (routeSkillId === undefined) return null;
    return skills.find((skill) => skill.id === routeSkillId) ?? null;
  }, [routeSkillId, skills]);
  const registrySkillOnPage = useMemo(() => {
    if (routeRegistrySkillId === undefined) {
      return null;
    }
    return (
      registrySkills.find(
        (skill) =>
          skill.id === routeRegistrySkillId ||
          skill.skillId === routeRegistrySkillId,
      ) ?? null
    );
  }, [registrySkills, routeRegistrySkillId]);
  const registryEntryQuery = useQuery({
    queryKey: ["skills-registry-entry", routeRegistrySkillId ?? "none"],
    queryFn: ({ signal }) =>
      fetchRegistrySkillEntry(routeRegistrySkillId!, signal),
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
    queryFn: ({ signal }) =>
      fetchRegistrySkillDetail({
        source: selectedRegistrySkill!.source,
        skillId: selectedRegistrySkill!.skillId,
        signal,
      }),
    enabled: selectedRegistrySkill !== null,
    staleTime: 5 * 60_000,
  });
  const findLocalRegistrySkill = useCallback(
    (skill: RegistrySkill): SkillSummary | null =>
      resolveInstalledRegistrySkill(skill, skills),
    [skills],
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
      const localSkill = findLocalRegistrySkill(skill);
      if (localSkill !== null) {
        navigate(
          getSkillDetailRoutePath({
            skillId: localSkill.id,
          }),
        );
        return;
      }
      if (!isRegistryBrowseRoute) setRegistryPage(0);
      navigate(getRegistrySkillDetailRoutePath({ registrySkillId: skill.id }));
    },
    [findLocalRegistrySkill, isRegistryBrowseRoute, navigate],
  );
  const handleRegistryQueryChange = useCallback((nextQuery: string) => {
    setRegistrySearch(nextQuery);
    setRegistryPage(0);
  }, []);
  const changeCollectionMode = useCallback(
    (mode: SkillsCollectionMode) => {
      if (mode === "browse") {
        setRegistryPage(0);
        navigate(getSkillsRoutePath());
        return;
      }
      navigate(getToolsOwnedCollectionRoutePath("skills"));
    },
    [navigate],
  );
  const closeSkillDetail = useCallback(() => {
    navigate(getToolsOwnedCollectionRoutePath("skills"));
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
  const forkRegistrySkill = useCallback(
    (skill: RegistrySkill) => {
      navigate(getRootComposeRoutePath(), {
        state: {
          focusPrompt: true,
          initialPrompt: buildRegistrySkillReferencePrompt(skill),
          replaceInitialPrompt: true,
          createDraftKind: "skill",
        },
      });
    },
    [navigate],
  );
  const registryDetail = registryDetailQuery.data ?? null;
  const selectedLocalRegistrySkill = selectedRegistrySkill
    ? findLocalRegistrySkill(selectedRegistrySkill)
    : null;
  return (
    <>
      {routeSkillId !== undefined && hasError ? (
        <ResourceListState
          state="error"
          message="Couldn't load skill."
          layout="detail"
          onRetry={() => void skillsQuery.refetch()}
        />
      ) : routeSkillId !== undefined && isLoading ? (
        <ResourceListState
          state="loading"
          message="Loading skill"
          layout="detail"
        />
      ) : routeSkillId !== undefined && selectedSkill === null ? (
        <ResourceListState
          state="empty"
          message="Skill not found."
          layout="detail"
        />
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
          layout="detail"
          onRetry={() => void registryEntryQuery.refetch()}
        />
      ) : selectedRegistrySkill && registryDetailQuery.isLoading ? (
        <ResourceListState
          state="loading"
          message="Checking skill source"
          layout="detail"
        />
      ) : selectedRegistrySkill &&
        (registryDetailQuery.isError || registryDetail === null) ? (
        <ResourceListState
          state="error"
          message="This registry skill is no longer available from its source."
          layout="detail"
          onRetry={() => void registryDetailQuery.refetch()}
        />
      ) : selectedRegistrySkill && registryDetail ? (
        <RegistrySkillDetailView
          skill={selectedRegistrySkill}
          detail={registryDetail}
          localSkill={selectedLocalRegistrySkill}
          localPath={selectedLocalRegistrySkill?.filePath ?? null}
          onRetry={() => void registryDetailQuery.refetch()}
          onFork={forkRegistrySkill}
          onEditLocalSkill={editSkillViaThread}
        />
      ) : (
        <SkillsOverview
          skills={skills}
          isLoading={isLoading}
          hasError={hasError}
          query={libraryQuery}
          activeMode={isRegistryBrowseRoute ? "browse" : "library"}
          onModeChange={changeCollectionMode}
          browseContent={
            <RegistrySkillsBrowsePage
              skills={registrySkills}
              pendingSkillIds={pendingRegistrySkillIds}
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
              onRetry={() => void registryQuery.refetch()}
              onQueryChange={handleRegistryQueryChange}
              onPageChange={setRegistryPage}
              onFork={forkRegistrySkill}
              onSelect={openRegistrySkill}
            />
          }
          onCreateSkill={handleCreateSkill}
          onSelectSkill={openSkill}
          onQueryChange={setLibraryQuery}
          onRetry={() => void skillsQuery.refetch()}
        />
      )}
    </>
  );
}
