import { useEffect, useState } from "react";
import type { SkillSummary } from "@bb/server-contract";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { ResourcePagination } from "@bb/shared-ui/resource-pagination";
import {
  ResourceBrowseCard,
  ResourceBrowseGrid,
  ResourceCardStat,
  ResourceCollectionViewport,
  ResourceListState,
  ResourceOverflowMenu,
  ResourceToolbar,
} from "@bb/shared-ui/resource-list";
import {
  formatInstallCount,
  formatRegistrySource,
  REGISTRY_PAGE_SIZE,
} from "@/lib/skills-registry";
import type {
  RegistryPagination,
  RegistrySkill,
  RegistrySkillDetail,
} from "@/lib/skills-registry";
import { useLocalOpenTargets } from "@/hooks/useLocalOpenTargets";
import {
  SkillBrowseInstallControl,
  SkillDetailView,
} from "@/components/tools/SkillDetailView";

const SKILLS_SH_URL = "https://www.skills.sh/";
const QUIET_SKILL_SAVE_CONTROL =
  "border-transparent bg-transparent shadow-none hover:border-transparent focus-visible:border-transparent";

function RegistrySkillActions({
  skillName,
  saved,
  pending,
  onCreateFromReference,
  onSave,
  onRemove,
}: {
  skillName: string;
  saved: boolean;
  pending: boolean;
  onCreateFromReference: () => void;
  onSave: () => void;
  onRemove?: () => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        variant="default"
        size="sm"
        className="h-7 px-2 text-xs max-md:pointer-coarse:h-9"
        aria-label={`Fork ${skillName} into a new bb skill`}
        onClick={onCreateFromReference}
      >
        <Icon name="Fork" className="size-3.5" aria-hidden />
        Fork
      </Button>
      <SkillBrowseInstallControl
        skillName={skillName}
        installed={saved}
        pending={pending}
        onInstall={onSave}
        onUninstall={onRemove}
        presentation="icon"
        className={QUIET_SKILL_SAVE_CONTROL}
      />
    </div>
  );
}

function RegistrySkillSocialProof({ skill }: { skill: RegistrySkill }) {
  const installs = formatInstallCount(skill.installs);
  const stars = skill.stars !== null ? formatInstallCount(skill.stars) : null;
  return (
    <span className="inline-flex flex-nowrap items-center gap-1 text-[11px] leading-none">
      <ResourceCardStat
        icon="Download"
        iconClassName="text-success"
        accessibleLabel={`${installs} installs`}
      >
        {installs}
      </ResourceCardStat>
      {stars !== null ? (
        <ResourceCardStat
          icon="Star"
          iconClassName="fill-attention/20 text-attention"
          accessibleLabel={`${stars} stars`}
        >
          {stars}
        </ResourceCardStat>
      ) : null}
    </span>
  );
}

function RegistrySkillSourceItem({
  skill,
  installed,
  canUninstall,
  onInstall,
  onUninstall,
  onCreateFromReference,
  onSelect,
  pending,
}: {
  skill: RegistrySkill;
  installed: boolean;
  canUninstall: boolean;
  onInstall: (skill: RegistrySkill) => void;
  onUninstall: (skill: RegistrySkill) => void;
  onCreateFromReference: (skill: RegistrySkill) => void;
  onSelect: (skill: RegistrySkill) => void;
  pending: boolean;
}) {
  return (
    <ResourceBrowseCard
      title={skill.name}
      byline={`by ${formatRegistrySource(skill.source)}`}
      description={skill.summary ?? undefined}
      openLabel={`View details for ${skill.name}`}
      onOpen={() => onSelect(skill)}
      headerAction={
        <RegistrySkillActions
          skillName={skill.name}
          saved={installed}
          pending={pending}
          onCreateFromReference={() => onCreateFromReference(skill)}
          onSave={() => onInstall(skill)}
          onRemove={canUninstall ? () => onUninstall(skill) : undefined}
        />
      }
      footerMeta={<RegistrySkillSocialProof skill={skill} />}
    />
  );
}

function SkillsShAttributionLink() {
  return (
    <a
      href={SKILLS_SH_URL}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 rounded-sm text-[11px] text-subtle-foreground/65 hover:text-subtle-foreground/90 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <span>powered by</span>
      <span className="font-mono">skills.sh</span>
    </a>
  );
}

export function RegistrySkillsBrowsePage({
  skills,
  pagination,
  isLoading,
  hasError,
  query,
  pendingSkillId,
  onRetry,
  onQueryChange,
  onPageChange,
  onInstall,
  onUninstall,
  onCreateFromReference,
  onSelect,
  isInstalled,
  canUninstall = () => false,
}: {
  skills: readonly RegistrySkill[];
  pagination: RegistryPagination;
  isLoading: boolean;
  hasError: boolean;
  query: string;
  pendingSkillId: string | null;
  onRetry?: () => void;
  onQueryChange: (query: string) => void;
  onPageChange: (page: number) => void;
  onInstall: (skill: RegistrySkill) => void;
  onUninstall: (skill: RegistrySkill) => void;
  onCreateFromReference: (skill: RegistrySkill) => void;
  onSelect: (skill: RegistrySkill) => void;
  isInstalled: (skill: RegistrySkill) => boolean;
  canUninstall?: (skill: RegistrySkill) => boolean;
}) {
  const footer = (
    <div className="space-y-2">
      <ResourcePagination
        page={pagination.page}
        pageSize={pagination.perPage}
        total={pagination.total}
        visibleCount={skills.length}
        onPageChange={onPageChange}
        scrollTargetId="skills-browse-results"
      />
      <div className="flex justify-end px-1">
        <SkillsShAttributionLink />
      </div>
    </div>
  );
  return (
    <ResourceCollectionViewport
      scrollId="skills-browse-results"
      toolbar={
        <ResourceToolbar
          searchValue={query}
          searchPlaceholder="Search skills"
          onSearchChange={onQueryChange}
        />
      }
      footer={footer}
      contentClassName="space-y-4"
    >
      {hasError ? (
        <ResourceListState
          state="error"
          message="Couldn't load skills.sh."
          onRetry={onRetry}
        />
      ) : isLoading ? (
        <ResourceListState
          state="loading"
          message="Loading skills.sh skills"
          loadingRows={REGISTRY_PAGE_SIZE}
        />
      ) : skills.length === 0 ? (
        <ResourceListState
          state="empty"
          message={
            query.trim().length === 0
              ? "No skills.sh resources available."
              : `No skills.sh resources match "${query}"`
          }
        />
      ) : (
        <ResourceBrowseGrid>
          {skills.map((skill) => (
            <RegistrySkillSourceItem
              key={skill.id}
              skill={skill}
              installed={isInstalled(skill)}
              canUninstall={canUninstall(skill)}
              pending={pendingSkillId === skill.id}
              onInstall={onInstall}
              onUninstall={onUninstall}
              onCreateFromReference={onCreateFromReference}
              onSelect={onSelect}
            />
          ))}
        </ResourceBrowseGrid>
      )}
    </ResourceCollectionViewport>
  );
}

export function RegistrySkillDetailView({
  skill,
  detail,
  installed,
  installedSkill,
  installedPath,
  pending,
  uninstallPending,
  onRetry,
  onInstall,
  onUninstall,
  onCreateFromReference,
  onEditInstalledSkill,
}: {
  skill: RegistrySkill;
  detail: RegistrySkillDetail;
  installed: boolean;
  installedSkill: SkillSummary | null;
  installedPath: string | null;
  pending: boolean;
  uninstallPending: boolean;
  onRetry: () => void;
  onInstall: (skill: RegistrySkill) => void;
  onUninstall?: (skill: RegistrySkill) => void;
  onCreateFromReference: (skill: RegistrySkill) => void;
  onEditInstalledSkill: (skill: SkillSummary) => void;
}) {
  const [selectedPath, setSelectedPath] = useState("SKILL.md");
  useEffect(() => setSelectedPath("SKILL.md"), [skill.id]);
  const { canOpenPreferredFileTarget, openPathInPreferredFileTarget } =
    useLocalOpenTargets({ enabled: installed && installedPath !== null });
  const files = detail?.files ?? [];
  const selectedFile =
    files.find((file) => file.path === selectedPath) ?? files[0] ?? null;
  const path = installedPath ?? `skills.sh/${skill.source}/${skill.skillId}`;
  return (
    <SkillDetailView
      title={skill.name}
      path={path}
      pathHref={installedPath === null ? skill.url : undefined}
      headerActions={
        <RegistrySkillActions
          skillName={skill.name}
          saved={installed}
          pending={pending || uninstallPending}
          onCreateFromReference={() => onCreateFromReference(skill)}
          onSave={() => onInstall(skill)}
          onRemove={onUninstall ? () => onUninstall(skill) : undefined}
        />
      }
      overflowMenu={
        installedSkill !== null && installedPath !== null ? (
          <ResourceOverflowMenu
            label={`${skill.name} actions`}
            items={[
              {
                label: "Edit",
                icon: "Edit",
                onSelect: () => onEditInstalledSkill(installedSkill),
              },
              {
                label: "Open source",
                icon: "ExternalLink",
                disabled: !canOpenPreferredFileTarget,
                disabledReason: canOpenPreferredFileTarget
                  ? undefined
                  : "No editor configured",
                onSelect: () => {
                  void openPathInPreferredFileTarget({
                    path: installedPath,
                    lineNumber: null,
                  });
                },
              },
            ]}
          />
        ) : undefined
      }
      files={files.map((file) => file.path)}
      selectedPath={selectedFile?.path ?? selectedPath}
      onSelectFile={setSelectedPath}
      contentState={
        selectedFile
          ? { kind: "ready", content: selectedFile.contents }
          : {
              kind: "error",
              message: "The source does not include SKILL.md content.",
              onRetry,
            }
      }
    />
  );
}
