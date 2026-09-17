import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { deriveProjectNameFromPath, type Host } from "@bb/domain";
import type { HostPlatform } from "@bb/host-daemon-contract";
import { useCreateProject } from "@/hooks/mutations/project-mutations";
import { useHosts } from "@/hooks/queries/host-queries";
import { useDialogState } from "@/hooks/useDialogState";
import {
  useLocalPathPicker,
  type LocalPathSubmitParams,
} from "@/hooks/useLocalPathPicker";
import {
  APP_ROOT_ROUTE_PATH,
  getRootComposeRoutePath,
} from "@/lib/route-paths";
import { useSetRootComposeProjectId } from "@/lib/root-compose-selection";
import type {
  ProjectPathDialogSubmitHandler,
  ProjectPathDialogTarget,
} from "@/components/dialogs/ProjectPathDialog";

interface QuickCreateProjectDialogState {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  target: ProjectPathDialogTarget | null;
}

export interface PendingProjectCreate {
  path: string;
  hostId: string;
  suggestedName: string;
}

interface QuickCreateProjectController {
  isAvailable: boolean;
  isCreating: boolean;
  openCreateDialog: () => void;
  platform: HostPlatform | null;
  hostId: string | null;
  hostName: string | null;
  hosts: readonly Host[];
  projectPathDialog: QuickCreateProjectDialogState;
  submitProjectPath: ProjectPathDialogSubmitHandler;
  createDetails: {
    target: PendingProjectCreate | null;
    onOpenChange: (open: boolean) => void;
  };
  confirmCreateDetails: (name: string) => void;
  cancelCreateDetails: () => void;
}

const quickCreateProjectContext =
  createContext<QuickCreateProjectController | null>(null);
const EMPTY_HOSTS: readonly Host[] = [];

export function useQuickCreateProject(): QuickCreateProjectController {
  const { mutate, isPending } = useCreateProject();
  const hostsQuery = useHosts();
  const hosts = hostsQuery.data ?? EMPTY_HOSTS;
  const navigate = useNavigate();
  const location = useLocation();
  const setRootComposeProjectId = useSetRootComposeProjectId();
  const shouldReplaceRoute = location.pathname === APP_ROOT_ROUTE_PATH;

  const createDetails = useDialogState<PendingProjectCreate>();

  const submit = useCallback(
    ({ path, hostId, target, closeDialog }: LocalPathSubmitParams) => {
      if (target.kind !== "create") return;
      closeDialog();
      createDetails.onOpen({
        path,
        hostId,
        suggestedName: deriveProjectNameFromPath(path),
      });
    },
    [createDetails],
  );

  const confirmCreateDetails = useCallback(
    (name: string) => {
      const staged = createDetails.target;
      if (!staged) return;
      const trimmedName = name.trim();
      if (!trimmedName) return;

      mutate(
        {
          name: trimmedName,
          source: { type: "local_path", hostId: staged.hostId, path: staged.path },
        },
        {
          onSuccess: (project) => {
            createDetails.onClose();
            setRootComposeProjectId(project.id);
            void navigate(getRootComposeRoutePath(), {
              replace: shouldReplaceRoute,
            });
          },
        },
      );
    },
    [createDetails, mutate, navigate, setRootComposeProjectId, shouldReplaceRoute],
  );

  const cancelCreateDetails = useCallback(() => {
    createDetails.onClose();
  }, [createDetails]);

  const controller = useLocalPathPicker({
    isPending,
    submit,
  });

  const openCreateDialog = useCallback(() => {
    controller.openPathEntry({ kind: "create" });
  }, [controller]);

  return useMemo(
    () => ({
      isAvailable: controller.isAvailable,
      isCreating: isPending,
      openCreateDialog,
      platform: controller.platform,
      hostId: controller.hostId,
      hostName: controller.hostName,
      hosts,
      projectPathDialog: controller.projectPathDialog,
      submitProjectPath: controller.submitProjectPath,
      createDetails: {
        target: createDetails.target,
        onOpenChange: createDetails.onOpenChange,
      },
      confirmCreateDetails,
      cancelCreateDetails,
    }),
    [controller, hosts, isPending, openCreateDialog, createDetails, confirmCreateDetails, cancelCreateDetails],
  );
}

interface QuickCreateProjectProviderProps {
  children: ReactNode;
}

export function QuickCreateProjectProvider({
  children,
}: QuickCreateProjectProviderProps) {
  const quickCreateProject = useQuickCreateProject();

  return (
    <quickCreateProjectContext.Provider value={quickCreateProject}>
      {children}
    </quickCreateProjectContext.Provider>
  );
}

export function useQuickCreateProjectController(): QuickCreateProjectController {
  const quickCreateProject = useContext(quickCreateProjectContext);
  if (!quickCreateProject) {
    throw new Error("QuickCreateProjectProvider is required");
  }
  return quickCreateProject;
}
