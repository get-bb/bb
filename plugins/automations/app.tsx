import { composerCustomization, CREATE_AUTOMATION_PROMPT } from "./composer";
import { useCallback, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  definePluginApp,
  useBbNavigate,
  experimental_useRpcQuery,
  experimental_useRpcInfiniteQuery,
  useRpc,
  type PluginNavPanelProps,
} from "@get-bb/plugin-sdk/app";
import type { automationRpcContract } from "./src/rpc.js";
import { toast } from "sonner";
import type {
  AutomationDetailReadResult,
  AutomationDetailResponse,
  AutomationResponse,
  AgentExecutionUpdate,
} from "./src/rpc-types";
import { AutomationDetailView } from "./detail-view";
import {
  AutomationOverviewView,
  automationProjectLabel,
  type AutomationCollectionMode,
} from "./overview-view";
import { PERSONAL_PROJECT_ID } from "./lib/format-schedule";
import { buildAutomationEditThreadPrompt } from "./lib/edit-prompt";
import { Button } from "@/components/ui/button";
import { DelayedLoading } from "@/components/ui/delayed-loading";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ResourceListState } from "@/components/ui/resource-list";
import { cn } from "@/lib/utils";

const PANEL_PATH = "automations";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface DetailRoute {
  projectId: string;
  automationId: string;
}

interface DeleteTarget {
  route: DetailRoute;
  name: string;
}

interface ParsedDetailRoute {
  route: DetailRoute;
  editing: boolean;
}

function parseSubPath(subPath: string): ParsedDetailRoute | null {
  const parts = subPath.split("/").filter((p) => p.length > 0);
  if (parts.length === 2 || (parts.length === 3 && parts[2] === "edit")) {
    return {
      route: { projectId: parts[0], automationId: parts[1] },
      editing: parts[2] === "edit",
    };
  }
  return null;
}

interface AutomationSignal {
  projectId: string;
  kind: "automations-changed" | "automation-runs-changed";
}

function asSignal(payload: unknown): AutomationSignal | null {
  if (payload === null || typeof payload !== "object") return null;
  const record = payload as { projectId?: unknown; kind?: unknown };
  if (
    typeof record.projectId !== "string" ||
    (record.kind !== "automations-changed" &&
      record.kind !== "automation-runs-changed")
  ) {
    return null;
  }
  return { projectId: record.projectId, kind: record.kind };
}

function useOverview() {
  const query = experimental_useRpcQuery<
    typeof automationRpcContract,
    "automations_overview"
  >({
    method: "automations_overview",
    input: null,
    realtime: [
      {
        channel: "automations",
        affects: (payload) => asSignal(payload) !== null,
      },
    ],
  });
  return {
    entries: query.data?.automations ?? null,
    error: query.error?.message ?? null,
    refetch: query.refetch,
  };
}

function useAutomation(route: DetailRoute): {
  automation: AutomationDetailReadResult | null;
  error: string | null;
  refetch: () => Promise<void>;
} {
  const query = experimental_useRpcQuery<
    typeof automationRpcContract,
    "automations_get"
  >({
    method: "automations_get",
    input: route,
    realtime: [
      {
        channel: "automations",
        affects: (payload) => asSignal(payload)?.projectId === route.projectId,
      },
    ],
  });
  return {
    automation: query.data ?? null,
    error: query.error?.message ?? null,
    refetch: query.refetch,
  };
}

function useRuns(route: DetailRoute) {
  const query = experimental_useRpcInfiniteQuery<
    typeof automationRpcContract,
    "automations_runs",
    string | null
  >({
    method: "automations_runs",
    input: route,
    initialPageParam: null,
    getPageInput: (input, cursor: string | null) => ({
      ...input,
      ...(cursor === null ? {} : { cursor }),
    }),
    getNextPageParam: (page) => page.nextCursor,
    realtime: [
      {
        channel: "automations",
        affects: (payload) => {
          const signal = asSignal(payload);
          return (
            signal?.projectId === route.projectId &&
            signal.kind === "automation-runs-changed"
          );
        },
      },
    ],
  });
  return {
    runs: query.data?.pages.flatMap((page) => page.runs) ?? [],
    nextCursor: query.data?.pages.at(-1)?.nextCursor ?? null,
    loading: query.isLoading,
    loadingMore: query.isFetchingNextPage,
    error: query.error?.message ?? null,
    loadMore: query.fetchNextPage,
    retry: query.isFetchNextPageError ? query.fetchNextPage : query.refetch,
  };
}

function useMutations() {
  const rpc = useRpc<typeof automationRpcContract>();
  type MutationMethod =
    | "automations_pause"
    | "automations_resume"
    | "automations_run"
    | "automations_delete";
  const call = useCallback(
    (method: MutationMethod, route: DetailRoute) => rpc.call(method, route),
    [rpc],
  );
  return {
    pause: (route: DetailRoute) => call("automations_pause", route),
    resume: (route: DetailRoute) => call("automations_resume", route),
    run: (route: DetailRoute) => call("automations_run", route),
    delete: (route: DetailRoute) => call("automations_delete", route),
    update: (route: DetailRoute, agent: AgentExecutionUpdate) =>
      rpc.call("automations_update", { ...route, agent }),
  };
}

function DeleteAutomationDialog({
  open,
  onOpenChange,
  name,
  pending,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {open ? (
          <>
            <DialogHeader>
              <DialogTitle>Delete automation?</DialogTitle>
              <DialogDescription>
                &ldquo;{name}&rdquo; and its run history will be permanently
                removed.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={onCancel}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={pending}
                onClick={onConfirm}
              >
                Delete
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function OverviewView({
  onOpenDetail,
  activeMode,
  onModeChange,
}: {
  onOpenDetail: (route: DetailRoute, options?: { editing?: boolean }) => void;
  activeMode: AutomationCollectionMode;
  onModeChange: (mode: AutomationCollectionMode) => void;
}) {
  const navigate = useBbNavigate();
  const { entries, error, refetch } = useOverview();
  const mutations = useMutations();
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [deleting, setDeleting] = useState(false);

  const changeEnabled = useCallback(
    async (enabled: boolean, route: DetailRoute) => {
      const method = enabled ? "resume" : "pause";
      try {
        await mutations[method](route);
      } catch (rpcError: unknown) {
        toast.error(`Failed to ${method} automation: ${errorText(rpcError)}`);
      }
    },
    [mutations],
  );

  const runNow = useCallback(
    async (route: DetailRoute) => {
      try {
        await mutations.run(route);
        toast.success("Run started");
      } catch (rpcError: unknown) {
        toast.error(`Failed to run automation: ${errorText(rpcError)}`);
      }
    },
    [mutations],
  );

  const requestDelete = useCallback((route: DetailRoute, name: string) => {
    setDeleteTarget({ route, name });
  }, []);

  const closeDelete = useCallback(() => {
    if (!deleting) setDeleteTarget(null);
  }, [deleting]);

  const confirmDelete = useCallback(() => {
    if (deleteTarget === null) return;
    setDeleting(true);
    mutations
      .delete(deleteTarget.route)
      .then(
        () => {
          toast.success("Automation deleted");
          setDeleteTarget(null);
          refetch();
        },
        (rpcError: unknown) =>
          toast.error(`Failed to delete automation: ${errorText(rpcError)}`),
      )
      .finally(() => setDeleting(false));
  }, [deleteTarget, mutations, refetch]);

  const createViaChat = useCallback(
    (prompt?: string) => {
      navigate.toCompose({
        focusPrompt: true,
        initialPrompt: prompt ?? CREATE_AUTOMATION_PROMPT,
      });
    },
    [navigate],
  );

  return (
    <>
      <AutomationOverviewView
        entries={entries}
        error={error}
        onRetry={refetch}
        onOpenDetail={onOpenDetail}
        onEnabledChange={changeEnabled}
        onRunNow={runNow}
        onDelete={requestDelete}
        onCreateViaChat={createViaChat}
        activeMode={activeMode}
        onModeChange={onModeChange}
      />
      <DeleteAutomationDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) closeDelete();
        }}
        name={deleteTarget?.name ?? ""}
        pending={deleting}
        onConfirm={confirmDelete}
        onCancel={closeDelete}
      />
    </>
  );
}

function DetailView({
  route,
  initialEditing,
  onBack,
}: {
  route: DetailRoute;
  initialEditing: boolean;
  onBack: () => void;
}) {
  const navigate = useBbNavigate();
  const { automation, error, refetch } = useAutomation(route);
  const [editingRequested, setEditingRequested] = useState(initialEditing);
  const overviewState = useOverview();
  const runsState = useRuns(route);
  const mutations = useMutations();
  const [actionPending, setActionPending] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const openThread = useCallback(
    (threadId: string) => navigate.toThread(threadId),
    [navigate],
  );

  const editViaThread = useCallback(
    (target: AutomationResponse) => {
      navigate.toCompose({
        focusPrompt: true,
        initialPrompt: buildAutomationEditThreadPrompt({
          name: target.name,
          projectId: route.projectId,
          automationId: route.automationId,
        }),
      });
    },
    [navigate, route],
  );

  const runAction = useCallback(
    (method: "pause" | "resume" | "run") => {
      setActionPending(true);
      mutations[method](route)
        .then(
          () => {
            if (method === "run") toast.success("Run started");
          },
          (rpcError: unknown) =>
            toast.error(
              `Failed to ${method} automation: ${errorText(rpcError)}`,
            ),
        )
        .finally(() => setActionPending(false));
    },
    [mutations, route],
  );

  const openEdit = useCallback(() => {
    if (automation === null || "problem" in automation) return;
    if (automation.execution.mode === "agent") {
      setEditingRequested(true);
      return;
    }
    editViaThread(automation);
  }, [automation, editViaThread]);

  const updateAgent = useCallback(
    async (agent: AgentExecutionUpdate) => {
      setActionPending(true);
      try {
        await mutations.update(route, agent);
        toast.success("Automation updated");
        setEditingRequested(false);
        refetch();
      } catch (rpcError: unknown) {
        toast.error(`Failed to update automation: ${errorText(rpcError)}`);
        throw rpcError;
      } finally {
        setActionPending(false);
      }
    },
    [mutations, refetch, route],
  );

  const confirmDelete = useCallback(() => {
    setDeleting(true);
    mutations
      .delete(route)
      .then(
        () => {
          toast.success("Automation deleted");
          setDeleteOpen(false);
          onBack();
        },
        (rpcError: unknown) =>
          toast.error(`Failed to delete automation: ${errorText(rpcError)}`),
      )
      .finally(() => setDeleting(false));
  }, [mutations, route, onBack]);

  if (error !== null) {
    return (
      <ResourceListState
        state="error"
        message={`Couldn't load automation: ${error}`}
        layout="detail"
        onRetry={refetch}
      />
    );
  }

  if (automation === null) {
    return (
      <DelayedLoading>
        <ResourceListState
          state="loading"
          message="Loading automation"
          layout="detail"
        />
      </DelayedLoading>
    );
  }

  const deleteDialog = (
    <DeleteAutomationDialog
      open={deleteOpen}
      onOpenChange={setDeleteOpen}
      name={automation.name}
      pending={deleting}
      onConfirm={confirmDelete}
      onCancel={() => setDeleteOpen(false)}
    />
  );

  if ("problem" in automation && automation.problem === "invalid-stored-data") {
    return (
      <>
        <div className="mx-auto w-full max-w-3xl space-y-3">
          <ResourceListState
            state="error"
            message="The stored automation configuration cannot be read."
            layout="detail"
            onRetry={refetch}
          />
          <div className="flex justify-center">
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={deleting}
              onClick={() => setDeleteOpen(true)}
            >
              Delete automation
            </Button>
          </div>
        </div>
        {deleteDialog}
      </>
    );
  }

  const requiresPrompt =
    automation.execution.mode === "agent" && automation.execution.prompt === "";
  const readableAutomation: AutomationDetailResponse = automation;

  const overviewEntry = overviewState.entries?.find(
    (entry) =>
      entry.automation.projectId === route.projectId &&
      entry.automation.id === route.automationId,
  );
  const projectLabel =
    overviewEntry !== undefined
      ? automationProjectLabel(overviewEntry.project)
      : route.projectId === PERSONAL_PROJECT_ID
        ? "Personal"
        : route.projectId;

  return (
    <AutomationDetailView
      automation={readableAutomation}
      projectLabel={projectLabel}
      runsState={runsState}
      actionPending={actionPending}
      editing={requiresPrompt || editingRequested}
      onToggle={(checked) => runAction(checked ? "resume" : "pause")}
      onEdit={openEdit}
      onCancelEdit={requiresPrompt ? onBack : () => setEditingRequested(false)}
      onUpdateAgent={updateAgent}
      onRunNow={() => runAction("run")}
      onDelete={() => setDeleteOpen(true)}
      onOpenThread={openThread}
      footer={deleteDialog}
    />
  );
}

function AutomationsPageFrame({
  fill,
  children,
}: {
  fill: boolean;
  children: ReactNode;
}) {
  return (
    <div className="h-full min-h-0 flex-1 overflow-y-auto">
      <div
        className={cn(
          "mx-auto box-border min-h-full w-full max-w-5xl px-4 pb-4 pt-3 md:px-5 md:pt-4",
          fill && "h-full",
        )}
      >
        {children}
      </div>
    </div>
  );
}

function AutomationsPanel({ subPath }: PluginNavPanelProps) {
  const navigate = useBbNavigate();
  const parsedRoute = useMemo(() => parseSubPath(subPath), [subPath]);
  const collectionMode: AutomationCollectionMode =
    subPath === "browse" ? "browse" : "installed";
  const openDetail = useCallback(
    (next: DetailRoute, options?: { editing?: boolean }) => {
      navigate.toPluginPanel(PANEL_PATH, {
        subPath: `${next.projectId}/${next.automationId}${
          options?.editing ? "/edit" : ""
        }`,
      });
    },
    [navigate],
  );
  const backToList = useCallback(() => {
    navigate.toPluginPanel(PANEL_PATH, { subPath: "" });
  }, [navigate]);
  const changeCollectionMode = useCallback(
    (mode: AutomationCollectionMode) => {
      navigate.toPluginPanel(PANEL_PATH, {
        subPath: mode === "browse" ? "browse" : "",
      });
    },
    [navigate],
  );
  if (parsedRoute !== null) {
    return (
      <AutomationsPageFrame fill={false}>
        <DetailView
          route={parsedRoute.route}
          initialEditing={parsedRoute.editing}
          onBack={backToList}
        />
      </AutomationsPageFrame>
    );
  }
  return (
    <AutomationsPageFrame fill>
      <OverviewView
        onOpenDetail={openDetail}
        activeMode={collectionMode}
        onModeChange={changeCollectionMode}
      />
    </AutomationsPageFrame>
  );
}

export default definePluginApp((app) => {
  app.composer.customize(composerCustomization);
  app.slots.navPanel({
    id: "automations",
    title: "Automations",
    icon: "Repeat",
    path: PANEL_PATH,
    component: AutomationsPanel,
  });
});
