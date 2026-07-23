import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useQueries, useQuery } from "@tanstack/react-query";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { buildSkillEditThreadPrompt } from "@bb/shared-ui/resource-edit-prompt";
import type {
  EditableSkillScope,
  LibrarySkillDetailPage,
  SkillSummary,
} from "@bb/server-contract";
import {
  ResourceListState,
  useResourceRouteLabel,
} from "@bb/shared-ui/resource-list";
import {
  RegistrySkillDetailView,
  RegistrySkillsBrowsePage,
} from "@/components/tools/SkillsBrowse";
import {
  SkillDetailDialogView,
  SkillsOverview,
} from "@/components/tools/SkillsCollection";
import { isSkillEditable } from "@/components/tools/skill-taxonomy";
import { CREATE_SKILL_PROMPT } from "@/lib/automation-prompt";
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
import type {
  RegistryPagination,
  RegistrySkill,
  RegistrySkillDetailPage,
} from "@/lib/skills-registry";
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
  const detail: LibrarySkillDetailPage | null =
    skill === null
      ? null
      : {
          kind: "library",
          skill,
          files: filesQuery.data?.files ?? ["SKILL.md"],
          filesTruncated: filesQuery.data?.truncated ?? false,
        };
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
      skill={detail?.skill ?? null}
      files={detail?.files ?? ["SKILL.md"]}
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
  const registryRepositoryStarQueries = useQueries({
    queries: registryRepositorySources.map(({ repositoryKey, source }) => ({
      queryKey: ["skills-registry-repository-stars", repositoryKey],
      queryFn: () => fetchRegistryRepositoryStars(source),
      enabled: isRegistryBrowseRoute,
      staleTime: 6 * 60 * 60_000,
      retry: false,
    })),
  });
  const registryDescriptionSkills = useMemo(
    () =>
      (registryQuery.data?.skills ?? []).filter(
        (skill) => skill.summary === null,
      ),
    [registryQuery.data?.skills],
  );
  const registryDescriptionQueries = useQueries({
    queries: registryDescriptionSkills.map((skill) => ({
      queryKey: ["skills-registry-entry", skill.id],
      queryFn: () => fetchRegistrySkillEntry(skill.id),
      enabled: isRegistryBrowseRoute,
      staleTime: 30 * 60_000,
      retry: false,
    })),
  });
  const registryDescriptions = new Map(
    registryDescriptionSkills.flatMap((skill, index) => {
      const entry = registryDescriptionQueries[index]?.data;
      return entry === undefined ? [] : ([[skill.id, entry]] as const);
    }),
  );
  const registryRepositoryStars = new Map(
    registryRepositorySources.flatMap(({ repositoryKey }, index) => {
      const stars = registryRepositoryStarQueries[index]?.data;
      return stars === undefined ? [] : ([[repositoryKey, stars]] as const);
    }),
  );
  const registrySkills = (registryQuery.data?.skills ?? []).map((skill) => {
    const entry = registryDescriptions.get(skill.id);
    const describedSkill =
      entry === undefined
        ? skill
        : { ...skill, topic: entry.topic, summary: entry.summary };
    if (describedSkill.stars !== null) return describedSkill;
    const stars = registryRepositoryStars.get(
      registryRepositoryKey(describedSkill.source),
    );
    return stars === undefined ? describedSkill : { ...describedSkill, stars };
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
      registrySkills.find(
        (skill) =>
          skill.id === routeRegistrySkillId ||
          skill.skillId === routeRegistrySkillId,
      ) ?? null
    );
  }, [registrySkills, routeRegistrySkillId]);
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
  const registryDetailPage: RegistrySkillDetailPage | null =
    selectedRegistrySkill !== null &&
    registryDetail !== null &&
    registryDetail.files !== null
      ? {
          kind: "registry",
          skill: {
            ...selectedRegistrySkill,
            hash: registryDetail.hash,
            files: registryDetail.files,
          },
        }
      : null;
  const selectedLocalRegistrySkill = selectedRegistrySkill
    ? findLocalRegistrySkill(selectedRegistrySkill)
    : null;
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
        (registryDetailQuery.isError || registryDetailPage === null) ? (
        <ResourceListState
          state="error"
          message="This registry skill is no longer available from its source."
          onRetry={() => void registryDetailQuery.refetch()}
        />
      ) : selectedRegistrySkill && registryDetailPage ? (
        <RegistrySkillDetailView
          detail={registryDetailPage}
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
