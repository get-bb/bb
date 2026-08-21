import { useCallback } from "react";
import { normalizeProjectPathInput } from "@bb/domain";
import type { HostPlatform } from "@bb/host-daemon-contract";
import { useDialogState } from "@/hooks/useDialogState";
import { useHostDaemon } from "@/hooks/useHostDaemon";
import { useHosts, usePrimaryHost } from "@/hooks/queries/host-queries";
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
  /**
   * Open whichever path-entry surface fits this machine: the native folder
   * picker when there is exactly one connected host and the daemon supports it,
   * the in-app browser dialog otherwise. Callers that want a specific surface
   * can still reach `openPicker` / `projectPathDialog.onOpen` directly.
   */
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

/**
 * The host that path-entry flows (create project, add/update source) target.
 * The target is the connected work host. The local daemon is only used to
 * decide whether a native picker can be shown on the same physical machine.
 */
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

export function useLocalPathPicker({
  isPending,
  submit,
}: UseLocalPathPickerOptions): LocalPathPickerController {
  const { platform } = useHostDaemon();
  const { canUseNativeFolderPicker, clientHostId, hostId, hostName } =
    usePathPickerHost();
  const hostsQuery = useHosts();
  const isLoadingHosts = hostsQuery.isPending;
  const connectedHostCount = (hostsQuery.data ?? []).filter(
    (host) => host.status === "connected",
  ).length;
  const projectPathDialog = useDialogState<ProjectPathDialogTarget>();
  const closeDialog = projectPathDialog.onClose;

  // The target host is always passed explicitly: a default parameter would
  // only cover an omitted argument, and the dialog passes an explicit null
  // when no machine is selected — which would silently skip the fallback.
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

  // Only *connected* machines are choosable, so a lone stale enrollment must
  // not cost desktop users the native folder picker. While the host list is
  // still loading we cannot yet tell single- from multi-machine: open the
  // dialog, which grows the picker once the list arrives, rather than
  // committing to the primary host behind the user's back.
  const openPathEntry = useCallback(
    (target: ProjectPathDialogTarget) => {
      if (isLoadingHosts || connectedHostCount > 1) {
        projectPathDialog.onOpen(target);
        return;
      }
      openPicker(target);
    },
    [connectedHostCount, isLoadingHosts, openPicker, projectPathDialog],
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
