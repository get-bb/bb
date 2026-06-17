import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import type {
  Automation,
  AutomationsOverviewResponse,
} from "@bb/server-contract";
import { EmptyStatePanel } from "@/components/ui/empty-state.js";
import { PageShell } from "@/components/ui/page-shell.js";
import { Pill } from "@/components/ui/pill.js";
import { SplitButton } from "@/components/ui/split-button.js";
import { useAutomations } from "@/hooks/queries/automation-queries";
import { useCreateThread } from "@/hooks/mutations/thread-runtime-mutations";
import { formatScheduleStatusLabel } from "@/lib/format-schedule";
import { getThreadRoutePath } from "@/lib/route-paths";
import { cn } from "@/lib/utils";

interface AutomationOverviewEntry {
  automation: Automation;
  project: { id: string; name: string };
}

interface AutomationStatusGroup {
  status: "active" | "paused";
  label: string;
  entries: AutomationOverviewEntry[];
}

interface AutomationRowProps {
  entry: AutomationOverviewEntry;
}

export interface AutomationsOverviewProps {
  entries: readonly AutomationOverviewEntry[];
  isLoading: boolean;
  hasInitialLoadError: boolean;
  onCreateAgentAutomation: () => void;
  onCreateScriptAutomation: () => void;
}

/**
 * Group automations into an insertion-ordered set of status groups: enabled
 * automations under "Active", disabled ones under "Paused". Empty groups are
 * omitted so the view only renders sections that have rows.
 */
function groupAutomationsByStatus(
  entries: readonly AutomationOverviewEntry[],
): AutomationStatusGroup[] {
  const active: AutomationOverviewEntry[] = [];
  const paused: AutomationOverviewEntry[] = [];
  for (const entry of entries) {
    if (entry.automation.enabled) {
      active.push(entry);
    } else {
      paused.push(entry);
    }
  }
  const groups: AutomationStatusGroup[] = [];
  if (active.length > 0) {
    groups.push({ status: "active", label: "Active", entries: active });
  }
  if (paused.length > 0) {
    groups.push({ status: "paused", label: "Paused", entries: paused });
  }
  return groups;
}

function AutomationRow({ entry }: AutomationRowProps) {
  const { automation, project } = entry;
  const projectLabel =
    project.id === PERSONAL_PROJECT_ID ? null : project.name;
  return (
    <div className="group flex h-9 items-center gap-3 rounded-md px-3 text-sm transition-colors hover:bg-state-hover">
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          automation.enabled ? "bg-success" : "bg-muted-foreground/50",
        )}
      />
      <span className="min-w-0 flex-1 truncate">{automation.name}</span>
      {projectLabel ? (
        <Pill variant="outline" className="shrink-0">
          {projectLabel}
        </Pill>
      ) : null}
      {automation.execution.mode === "script" ? (
        <Pill variant="outline" className="shrink-0">
          Script
        </Pill>
      ) : null}
      {automation.origin === "agent" ? (
        <Pill variant="secondary" className="shrink-0">
          API
        </Pill>
      ) : null}
      <span className="shrink-0 text-xs text-muted-foreground">
        {formatScheduleStatusLabel({
          enabled: automation.enabled,
          nextRunAt: automation.nextRunAt,
        })}
      </span>
    </div>
  );
}

export function AutomationsOverview({
  entries,
  isLoading,
  hasInitialLoadError,
  onCreateAgentAutomation,
  onCreateScriptAutomation,
}: AutomationsOverviewProps) {
  const groups = groupAutomationsByStatus(entries);
  const isEmpty =
    !isLoading && !hasInitialLoadError && entries.length === 0;

  return (
    <PageShell contentClassName="pt-4 md:pt-5">
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-sm font-semibold">Automations</h1>
          <SplitButton
            primaryAction={{
              label: "Create via chat",
              onSelect: onCreateAgentAutomation,
            }}
            secondaryActions={[
              {
                label: "Agent automation",
                onSelect: onCreateAgentAutomation,
              },
              {
                label: "Script automation",
                onSelect: onCreateScriptAutomation,
              },
            ]}
          />
        </div>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : hasInitialLoadError ? (
          <p className="text-sm text-destructive">
            Failed to load automations.
          </p>
        ) : isEmpty ? (
          <EmptyStatePanel className="py-6">
            No automations yet.
          </EmptyStatePanel>
        ) : (
          <div className="space-y-6">
            {groups.map((group) => (
              <section key={group.status}>
                <p className="text-xs font-medium uppercase text-muted-foreground">
                  {group.label}
                </p>
                <div className="mt-1.5 space-y-1">
                  {group.entries.map((entry) => (
                    <AutomationRow
                      key={entry.automation.id}
                      entry={entry}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </PageShell>
  );
}

const AGENT_AUTOMATION_SEED_PROMPT =
  "Help me design and create a new bb automation that runs on a schedule. " +
  "Ask me what it should do, then create it with the `bb automation create` " +
  "CLI using an agent run (`--prompt`, `--provider`, `--model`, " +
  "`--permission-mode`) and a 5-field `--cron` schedule with `--timezone`.";

const SCRIPT_AUTOMATION_SEED_PROMPT =
  "Help me design and create a new bb script automation (no agent, no token " +
  "spend) that runs on a schedule. Ask me what it should monitor or do, then " +
  "create it with the `bb automation create` CLI using a script run " +
  "(`--script` or `--script-file`, `--interpreter`, `--timeout`) and a " +
  "5-field `--cron` schedule with `--timezone`. Use the `{\"wakeAgent\": false}` " +
  "gate so it stays silent unless something matters.";

export function AutomationsView() {
  const automationsQuery = useAutomations();
  const navigate = useNavigate();
  const createThread = useCreateThread();

  const data: AutomationsOverviewResponse | undefined = automationsQuery.data;
  const entries = data?.automations ?? [];
  const hasInitialLoadError =
    automationsQuery.isError && data === undefined;
  const isLoading =
    automationsQuery.isFetching && data === undefined && !hasInitialLoadError;

  const createViaChat = useCallback(
    async (prompt: string) => {
      if (createThread.isPending) {
        return;
      }
      try {
        const thread = await createThread.mutateAsync({
          projectId: PERSONAL_PROJECT_ID,
          input: [{ type: "text", text: prompt, mentions: [] }],
          environment: { type: "host", workspace: { type: "personal" } },
        });
        navigate(
          getThreadRoutePath({
            projectId: thread.projectId,
            threadId: thread.id,
          }),
        );
      } catch {
        // Global mutation error handling already surfaced the failure.
      }
    },
    [createThread, navigate],
  );

  const handleCreateAgentAutomation = useCallback(() => {
    void createViaChat(AGENT_AUTOMATION_SEED_PROMPT);
  }, [createViaChat]);

  const handleCreateScriptAutomation = useCallback(() => {
    void createViaChat(SCRIPT_AUTOMATION_SEED_PROMPT);
  }, [createViaChat]);

  return (
    <AutomationsOverview
      entries={entries}
      isLoading={isLoading}
      hasInitialLoadError={hasInitialLoadError}
      onCreateAgentAutomation={handleCreateAgentAutomation}
      onCreateScriptAutomation={handleCreateScriptAutomation}
    />
  );
}
