import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { buildSkillEditThreadPrompt } from "@bb/shared-ui/resource-edit-prompt";
import type { EditableSkillScope, SkillSummary } from "@bb/server-contract";
import {
  ResourceListState,
  useResourceRouteLabel,
} from "@bb/shared-ui/resource-list";
import { appToast } from "@/components/ui/app-toast";
import {
  RegistrySkillDetailView,
  RegistrySkillsBrowsePage,
} from "@/components/tools/SkillsBrowse";
import {
  SkillDetailDialogView,
  SkillsOverview,
} from "@/components/tools/SkillsInstalled";
import { isSkillEditable } from "@/components/tools/skill-taxonomy";
import { CREATE_SKILL_PROMPT } from "@/lib/automation-prompt";
import {
  buildRegistrySkillReferencePrompt,
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

type SkillsCollectionMode = "installed" | "browse";

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
  const createRegistrySkillFromReference = useCallback(
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
          onCreateFromReference={createRegistrySkillFromReference}
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
              onCreateFromReference={createRegistrySkillFromReference}
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
