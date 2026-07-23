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
import { SkillDetailView } from "@/components/tools/SkillDetailView";

const SKILLS_SH_URL = "https://www.skills.sh/";

function RegistrySkillActions({
  skillName,
  onFork,
}: {
  skillName: string;
  onFork: () => void;
}) {
  return (
    <Button
      type="button"
      variant="default"
      size="sm"
      className="h-7 px-2 text-xs max-md:pointer-coarse:h-9"
      aria-label={`Fork ${skillName} into a new bb skill`}
      onClick={onFork}
    >
      <Icon name="Fork" className="size-3.5" aria-hidden />
      Fork
    </Button>
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
  onFork,
  onSelect,
}: {
  skill: RegistrySkill;
  onFork: (skill: RegistrySkill) => void;
  onSelect: (skill: RegistrySkill) => void;
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
          onFork={() => onFork(skill)}
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
  onRetry,
  onQueryChange,
  onPageChange,
  onFork,
  onSelect,
}: {
  skills: readonly RegistrySkill[];
  pagination: RegistryPagination;
  isLoading: boolean;
  hasError: boolean;
  query: string;
  onRetry?: () => void;
  onQueryChange: (query: string) => void;
  onPageChange: (page: number) => void;
  onFork: (skill: RegistrySkill) => void;
  onSelect: (skill: RegistrySkill) => void;
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
              onFork={onFork}
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
  installedSkill,
  installedPath,
  onRetry,
  onFork,
  onEditInstalledSkill,
}: {
  skill: RegistrySkill;
  detail: RegistrySkillDetail;
  installedSkill: SkillSummary | null;
  installedPath: string | null;
  onRetry: () => void;
  onFork: (skill: RegistrySkill) => void;
  onEditInstalledSkill: (skill: SkillSummary) => void;
}) {
  const [selectedPath, setSelectedPath] = useState("SKILL.md");
  useEffect(() => setSelectedPath("SKILL.md"), [skill.id]);
  const { canOpenPreferredFileTarget, openPathInPreferredFileTarget } =
    useLocalOpenTargets({ enabled: installedPath !== null });
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
          onFork={() => onFork(skill)}
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
