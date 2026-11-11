import { toast } from "sonner";
import {
  definePluginApp,
  experimental_useSidebarThreads as useSidebarThreads,
  type ExperimentalPageTitle,
  type ExperimentalThreadHeaderRowProps,
  type PluginNavPanelProps,
  type PluginThreadListProps,
} from "@get-bb/plugin-sdk/app";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppBridgeOverlay } from "./app/bridge.js";
import { forkToNewWorkspace } from "./app/fork.js";
import { WorkspaceBreadcrumb } from "./app/header/WorkspaceBreadcrumb.js";
import { NewChatPage } from "./app/new-chat/NewChatPage.js";
import { environmentIdFromSubPath } from "./app/new-chat/route.js";
import { runWorkspaceScript } from "./app/scripts/run.js";
import { WorkspaceSidebar } from "./app/sidebar/WorkspaceSidebar.js";
import {
  NEW_CHAT_PANEL_PATH,
  WorkspaceTabs,
} from "./app/tabs/WorkspaceTabs.js";
import { findWorkspace } from "./app/workspace.js";

function ConductorThreadList(props: PluginThreadListProps) {
  return (
    <TooltipProvider>
      <WorkspaceSidebar {...props} />
    </TooltipProvider>
  );
}

function ConductorWorkspaceTabs(props: ExperimentalThreadHeaderRowProps) {
  return (
    <TooltipProvider>
      <WorkspaceTabs {...props} />
    </TooltipProvider>
  );
}

function ConductorThreadHeaderTitle({
  threadId,
  projectId,
  environment,
}: ExperimentalThreadHeaderRowProps) {
  return (
    <WorkspaceBreadcrumb
      threadId={threadId}
      projectId={projectId}
      environmentId={environment?.id ?? null}
    />
  );
}

function ConductorNewChatPage(props: PluginNavPanelProps) {
  return (
    <TooltipProvider>
      <NewChatPage {...props} />
    </TooltipProvider>
  );
}

function NewChatHeaderTitle({ subPath }: PluginNavPanelProps) {
  const environmentId = environmentIdFromSubPath(subPath);
  const { threads, projects } = useSidebarThreads();
  const workspace =
    environmentId === null
      ? null
      : findWorkspace(threads, projects, environmentId, null);
  if (workspace === null) return <span className="text-sm">New chat</span>;
  return (
    <WorkspaceBreadcrumb
      threadId={null}
      projectId={workspace.projectId}
      environmentId={workspace.environmentId}
    />
  );
}

function useNewChatPageTitle({
  subPath,
}: PluginNavPanelProps): ExperimentalPageTitle | null {
  const environmentId = environmentIdFromSubPath(subPath);
  const { threads, projects } = useSidebarThreads();
  const workspace =
    environmentId === null
      ? null
      : findWorkspace(threads, projects, environmentId, null);
  if (workspace === null) return null;
  return {
    breadcrumbs: [{ label: workspace.projectName }, { label: workspace.label }],
    windowTitle: `New chat · ${workspace.label}`,
  };
}

function reportFailure(action: string, error: unknown): void {
  toast.error(
    error instanceof Error ? `${action}: ${error.message}` : `${action}.`,
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_threadList({
    id: "workspaces",
    title: "Conductor workspaces",
    description:
      "Projects with one row per workspace: the threads that share an environment, with branch, pull request, and line changes.",
    component: ConductorThreadList,
  });
  app.slots.experimental_threadHeaderRow({
    id: "workspace-tabs",
    component: ConductorWorkspaceTabs,
  });
  app.slots.experimental_threadHeaderTitle({
    id: "workspace-breadcrumb",
    component: ConductorThreadHeaderTitle,
  });
  app.slots.navPanel({
    id: "new-chat",
    title: "New chat",
    icon: "MessageSquarePlus",
    path: NEW_CHAT_PANEL_PATH,
    component: ConductorNewChatPage,
    experimental_headerTitle: NewChatHeaderTitle,
    experimental_hideFromNavigation: true,
    experimental_usePageTitle: useNewChatPageTitle,
  });
  app.slots.experimental_appOverlay({
    id: "bridge",
    component: AppBridgeOverlay,
  });
  app.slots.messageAction({
    id: "fork-to-new-workspace",
    title: "Fork to new workspace",
    icon: "FolderGit",
    async run(context) {
      await forkToNewWorkspace(context).catch((error: unknown) =>
        reportFailure("Could not fork to a new workspace", error),
      );
    },
  });
  app.commands.register({
    id: "run",
    title: "Run workspace script",
    defaultShortcut: { key: "r", mod: true },
    isAvailable: (context) => context.threadId !== null,
    async run(context) {
      if (context.threadId === null) return;
      await runWorkspaceScript(context.threadId).catch((error: unknown) =>
        reportFailure("Could not run the workspace script", error),
      );
    },
  });
});
