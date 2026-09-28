import { useMemo, useState } from "react";
import {
  ResourceActionButton,
  ResourceActivitySection,
  ResourceBrowseGrid,
  ResourceCollectionPage,
  ResourceCollectionViewport,
  ResourceCreateButton,
  ResourceDefinitionSection,
  ResourceDetailCollection,
  ResourceDetailPage,
  ResourceDetailStack,
  ResourceFilterMenu,
  ResourceListPanel,
  ResourceMeta,
  ResourceOverflowMenu,
  ResourcePromptPreview,
  ResourceRow,
  ResourceRowDetailChevron,
  ResourceSortMenu,
  ResourceTemplateBrowseCard,
  ResourceToolbar,
  type ResourceOption,
} from "./resource-list.js";
import { ResourcePagination, useResourcePagination } from "./resource-pagination.js";
import { Icon } from "./icon.js";
import { Switch } from "./switch.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/ResourceList",
};

interface AutomationRowData {
  id: string;
  name: string;
  project: string;
  schedule: string;
  enabled: boolean;
}

const AUTOMATIONS: readonly AutomationRowData[] = [
  {
    id: "auto-1",
    name: "CI failure triage",
    project: "bb",
    schedule: "Weekdays 8:00am",
    enabled: true,
  },
  {
    id: "auto-2",
    name: "Weekly changelog digest",
    project: "bb",
    schedule: "Mondays 9:00am",
    enabled: true,
  },
  {
    id: "auto-3",
    name: "Stale PR nudge",
    project: "bb-marketing-site",
    schedule: "Daily 5:00pm",
    enabled: false,
  },
];

const CREATE_TEMPLATES = [
  {
    label: "CI failure triage",
    description:
      "Checks failed main-branch CI and opens fixer threads only for new failures.",
    prompt: "Watch CI on main and open a thread for any new failure.",
  },
  {
    label: "Weekly digest",
    description: "Summarizes merged PRs into a weekly changelog thread.",
    prompt: "Summarize this week's merged PRs into a changelog draft.",
  },
];

const PROJECT_OPTIONS: readonly ResourceOption[] = [
  { id: "bb", label: "bb" },
  { id: "bb-marketing-site", label: "bb-marketing-site" },
];

function CollectionBrowseDemo() {
  const [activeMode, setActiveMode] = useState<"installed" | "browse">(
    "installed",
  );
  const [query, setQuery] = useState("");
  const [projectFilters, setProjectFilters] = useState<readonly string[]>([]);
  const [sortMode, setSortMode] = useState<"project" | "alpha">("alpha");

  const filtered = useMemo(() => {
    return AUTOMATIONS.filter((automation) => {
      if (
        projectFilters.length > 0 &&
        !projectFilters.includes(automation.project)
      )
        return false;
      if (
        query.trim() !== "" &&
        !automation.name.toLowerCase().includes(query.toLowerCase())
      )
        return false;
      return true;
    }).sort((left, right) =>
      sortMode === "alpha"
        ? left.name.localeCompare(right.name)
        : left.project.localeCompare(right.project),
    );
  }, [projectFilters, query, sortMode]);

  const pagination = useResourcePagination(filtered, {
    pageSize: 2,
    resetKey: `${query}-${projectFilters.join(",")}-${sortMode}`,
  });

  return (
    <div className="h-96 w-[420px] overflow-hidden rounded-md border border-border">
      <ResourceCollectionPage
        id="demo-automations-collection"
        description="Manage scheduled bb work across projects and folders."
        modes={[
          { id: "installed", label: "Installed", count: AUTOMATIONS.length },
          { id: "browse", label: "Browse" },
        ]}
        activeMode={activeMode}
        onModeChange={(mode) => setActiveMode(mode)}
        actions={
          <ResourceCreateButton
            label="New automation"
            templates={CREATE_TEMPLATES}
            onCreate={() => {}}
          />
        }
      >
        {activeMode === "browse" ? (
          <ResourceCollectionViewport contentClassName="space-y-3">
            <ResourceBrowseGrid>
              {CREATE_TEMPLATES.map((template) => (
                <ResourceTemplateBrowseCard
                  key={template.label}
                  title={template.label}
                  description={template.description}
                  onUse={() => {}}
                />
              ))}
            </ResourceBrowseGrid>
          </ResourceCollectionViewport>
        ) : (
          <ResourceCollectionViewport
            toolbar={
              <ResourceToolbar
                searchValue={query}
                searchPlaceholder="Search automations"
                onSearchChange={setQuery}
                controls={
                  <>
                    <ResourceFilterMenu
                      compact
                      groups={[
                        {
                          id: "projects",
                          label: "Projects",
                          options: PROJECT_OPTIONS,
                          selectedValues: projectFilters,
                          onChange: setProjectFilters,
                        },
                      ]}
                    />
                    <ResourceSortMenu
                      value={sortMode}
                      direction="asc"
                      compact
                      options={[
                        { id: "project", label: "Project" },
                        { id: "alpha", label: "Automation name" },
                      ]}
                      onChange={(next) =>
                        setSortMode(next as "project" | "alpha")
                      }
                    />
                  </>
                }
              />
            }
            footer={
              <ResourcePagination
                page={pagination.page}
                pageSize={pagination.pageSize}
                total={pagination.total}
                visibleCount={pagination.visibleCount}
                onPageChange={pagination.setPage}
              />
            }
          >
            <ResourceListPanel>
              {pagination.items.map((automation) => (
                <ResourceRow
                  key={automation.id}
                  leading={
                    <Icon name="Clock" className="size-4 text-muted-foreground" />
                  }
                  title={automation.name}
                  muted={!automation.enabled}
                  description={
                    <ResourceMeta
                      items={[
                        <span key="project">{automation.project}</span>,
                        <span key="schedule">{automation.schedule}</span>,
                      ]}
                    />
                  }
                  onOpen={() => {}}
                  actions={
                    <ResourceOverflowMenu
                      label={`${automation.name} actions`}
                      items={[
                        { label: "Run now", icon: "Play", onSelect: () => {} },
                        { kind: "separator" },
                        {
                          label: "Delete",
                          icon: "Trash2",
                          tone: "destructive",
                          onSelect: () => {},
                        },
                      ]}
                    />
                  }
                  actionsVisibility="always"
                  persistentActions={
                    <Switch
                      checked={automation.enabled}
                      size="sm"
                      aria-label={`${automation.enabled ? "Disable" : "Enable"} ${automation.name}`}
                      onCheckedChange={() => {}}
                    />
                  }
                  trailingVisual={<ResourceRowDetailChevron />}
                />
              ))}
            </ResourceListPanel>
          </ResourceCollectionViewport>
        )}
      </ResourceCollectionPage>
    </div>
  );
}

function DetailActivityDemo() {
  const [pending, setPending] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const runs = [
    {
      id: "run-1",
      status: "succeeded" as const,
      startedAt: "2026-09-27 08:00",
      threadId: "thr_1",
    },
    {
      id: "run-2",
      status: "failed" as const,
      startedAt: "2026-09-26 08:00",
      threadId: "thr_2",
    },
    {
      id: "run-3",
      status: "running" as const,
      startedAt: "2026-09-28 08:00",
      threadId: null,
    },
  ];

  return (
    <div className="h-96 w-[420px] overflow-y-auto rounded-md border border-border p-4">
      <ResourceDetailPage
        leading={
          <Icon name="Clock" className="size-4 shrink-0 text-muted-foreground" />
        }
        title="CI failure triage"
        metadata={
          <ResourceMeta
            items={[
              <span key="project">bb</span>,
              <span key="schedule">Weekdays 8:00am</span>,
            ]}
          />
        }
        lifecycleControl={
          <Switch
            checked={enabled}
            size="default"
            disabled={pending}
            aria-label={`${enabled ? "Disable" : "Enable"} CI failure triage`}
            onCheckedChange={(next) => {
              setPending(true);
              setTimeout(() => {
                setEnabled(next);
                setPending(false);
              }, 300);
            }}
          />
        }
        overflowMenu={
          <ResourceOverflowMenu
            label="CI failure triage actions"
            items={[
              { label: "Run now", icon: "Play", onSelect: () => {} },
              {
                label: "Delete",
                icon: "Trash2",
                tone: "destructive",
                onSelect: () => {},
              },
            ]}
          />
        }
      >
        <ResourceDetailStack>
          <ResourceDefinitionSection
            label="Prompt"
            actions={
              <ResourceActionButton
                label="Edit prompt"
                icon="Edit"
                onClick={() => {}}
              />
            }
          >
            <ResourcePromptPreview
              disabled
              context={[{ label: "claude-sonnet-5" }]}
            >
              Watch CI on main and open a thread for any new failure.
            </ResourcePromptPreview>
          </ResourceDefinitionSection>
          <ResourceActivitySection label="Runs">
            <ResourceDetailCollection>
              {runs.map((run) => (
                <div
                  key={run.id}
                  className="flex items-center gap-3 px-3 py-2 text-sm"
                >
                  <Icon
                    name={
                      run.status === "succeeded"
                        ? "CircleCheck"
                        : run.status === "failed"
                          ? "CircleX"
                          : "Loading"
                    }
                    className="size-4 shrink-0 text-muted-foreground"
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {run.startedAt}
                  </span>
                  {run.threadId ? <ResourceRowDetailChevron /> : null}
                </div>
              ))}
            </ResourceDetailCollection>
          </ResourceActivitySection>
        </ResourceDetailStack>
      </ResourceDetailPage>
    </div>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="Collection / browse"
        hint="plugins/automations/overview-view.tsx — installed-list toolbar (search/filter/sort) and browse-grid tabs"
      >
        <CollectionBrowseDemo />
      </StoryRow>
      <StoryRow
        label="Detail / activity"
        hint="plugins/automations/detail-view.tsx — read-only prompt definition plus a run-history activity section"
      >
        <DetailActivityDemo />
      </StoryRow>
    </StoryCard>
  );
}
