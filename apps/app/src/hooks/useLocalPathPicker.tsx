import { useCallback } from "react";
import { normalizeProjectPathInput, type Host } from "@bb/domain";
import type { HostPlatform } from "@bb/host-daemon-contract";
import { useDialogState } from "@bb/shared-ui/use-dialog-state";
import { useHostDaemon } from "@/hooks/useHostDaemon";
import {
  selectHosts,
  useHosts,
  usePrimaryHost,
} from "@/hooks/queries/host-queries";
import { sdk } from "@/lib/sdk";
import type {
  ProjectPathDialogSubmitHandler,
  ProjectPathDialogTarget,
} from "@/components/dialogs/ProjectPathDialog";

export interface LocalPathSubmitParams {
  path: string;
  hostId: string;
  target: ProjectPathDialogTarget;
  closeDialog: () => void;
}

interface UseLocalPathPickerOptions {
  isPending: boolean;
  submit: (params: LocalPathSubmitParams) => void;
}

interface LocalPathPickerController {
  isAvailable: boolean;
  hostId: string | null;
  hostName: string | null;
  openPathEntry: (target: ProjectPathDialogTarget) => void;
  openPicker: (target: ProjectPathDialogTarget) => void;
  platform: HostPlatform | null;
  projectPathDialog: ReturnType<typeof useDialogState<ProjectPathDialogTarget>>;
  submitProjectPath: ProjectPathDialogSubmitHandler;
}

interface PathPickerHost {
  canUseNativeFolderPicker: boolean;
  clientHostId: string | null;
  hostId: string | null;
  hostName: string | null;
}

export function usePathPickerHost(): PathPickerHost {
  const { localDaemonHostId, supportsNativeFolderPicker } = useHostDaemon();
  const primaryHost = usePrimaryHost();

  const connectedPrimaryHostId =
    primaryHost?.status === "connected" ? primaryHost.id : null;
  const hostId = connectedPrimaryHostId ?? localDaemonHostId;
  const hostName =
    primaryHost && primaryHost.id === hostId ? primaryHost.name : null;
  const canUseNativeFolderPicker =
    supportsNativeFolderPicker &&
    localDaemonHostId !== null &&
    hostId === localDaemonHostId;

  return {
    canUseNativeFolderPicker,
    clientHostId: localDaemonHostId,
    hostId,
    hostName,
  };
}

export function shouldOpenPathEntryDialog(
  hosts: readonly Host[] | undefined,
  isLoadingHosts: boolean,
): boolean {
  if (isLoadingHosts) return true;
  const connectedHostCount = selectHosts(hosts, "all").filter(
    (host) => host.status === "connected",
  ).length;
  return connectedHostCount > 1;
}

export function useLocalPathPicker({
  isPending,
  submit,
}: UseLocalPathPickerOptions): LocalPathPickerController {
  const { platform } = useHostDaemon();
  const { canUseNativeFolderPicker, clientHostId, hostId, hostName } =
    usePathPickerHost();
  const hostsQuery = useHosts();
  const opensPathEntryDialog = shouldOpenPathEntryDialog(
    hostsQuery.data,
    hostsQuery.isPending,
  );
  const projectPathDialog = useDialogState<ProjectPathDialogTarget>();
  const closeDialog = projectPathDialog.onClose;

  const submitPath = useCallback(
    (
      path: string,
      target: ProjectPathDialogTarget,
      targetHostId: string | null,
    ) => {
      if (isPending || !targetHostId) return;
      submit({ path, hostId: targetHostId, target, closeDialog });
    },
    [closeDialog, isPending, submit],
  );

  const openPicker = useCallback(
    (target: ProjectPathDialogTarget) => {
      if (isPending || !hostId) return;

      if (canUseNativeFolderPicker && clientHostId !== null) {
        void (async () => {
          let selectedPath: string | null;
          try {
            selectedPath = (
              await sdk.hosts.pickFolder({ hostId, clientHostId })
            ).path;
          } catch {
            projectPathDialog.onOpen(target);
            return;
          }
          if (!selectedPath) return;
          submitPath(normalizeProjectPathInput(selectedPath), target, hostId);
        })();
        return;
      }

      projectPathDialog.onOpen(target);
    },
    [
      canUseNativeFolderPicker,
      clientHostId,
      hostId,
      isPending,
      projectPathDialog,
      submitPath,
    ],
  );

  const submitProjectPath = useCallback<ProjectPathDialogSubmitHandler>(
    (target, path, selectedHostId) => {
      submitPath(path, target, selectedHostId);
    },
    [submitPath],
  );

  const openPathEntry = useCallback(
    (target: ProjectPathDialogTarget) => {
      if (opensPathEntryDialog) {
        projectPathDialog.onOpen(target);
        return;
      }
      openPicker(target);
    },
    [opensPathEntryDialog, openPicker, projectPathDialog],
  );

  return {
    isAvailable: hostId != null,
    hostId,
    hostName,
    openPathEntry,
    openPicker,
    platform,
    projectPathDialog,
    submitProjectPath,
  };
}
