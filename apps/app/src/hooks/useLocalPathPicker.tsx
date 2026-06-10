import { useCallback } from "react";
import { normalizeProjectPathInput } from "@bb/domain";
import type { HostPlatform } from "@bb/host-daemon-contract";
import { useDialogState } from "@/hooks/useDialogState";
import { useHostDaemon } from "@/hooks/useHostDaemon";
import { usePrimaryHost } from "@/hooks/queries/host-queries";
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

export interface LocalPathPickerController {
  isAvailable: boolean;
  hostId: string | null;
  hostName: string | null;
  openPicker: (target: ProjectPathDialogTarget) => void;
  platform: HostPlatform | null;
  projectPathDialog: ReturnType<typeof useDialogState<ProjectPathDialogTarget>>;
  submitProjectPath: ProjectPathDialogSubmitHandler;
}

export interface PathPickerHost {
  hostId: string | null;
  hostName: string | null;
}

/**
 * The host that path-entry flows (create project, add/update source) target.
 * The loopback daemon only answers on the machine running bb, but the server
 * knows the host work runs on from any device. Fall back to the connected
 * primary host so remote devices can register host paths via the manual
 * dialog. bb is single-host, so when both resolve they name the same host.
 */
export function usePathPickerHost(): PathPickerHost {
  const { localDaemonHostId } = useHostDaemon();
  const primaryHost = usePrimaryHost();

  const connectedPrimaryHostId =
    primaryHost?.status === "connected" ? primaryHost.id : null;
  const hostId = localDaemonHostId ?? connectedPrimaryHostId;
  const hostName =
    primaryHost && primaryHost.id === hostId ? primaryHost.name : null;

  return { hostId, hostName };
}

export function useLocalPathPicker({
  isPending,
  submit,
}: UseLocalPathPickerOptions): LocalPathPickerController {
  const { pickFolder, platform } = useHostDaemon();
  const { hostId, hostName } = usePathPickerHost();
  const projectPathDialog = useDialogState<ProjectPathDialogTarget>();
  const closeDialog = projectPathDialog.onClose;

  const submitPath = useCallback(
    (path: string, target: ProjectPathDialogTarget) => {
      if (isPending || !hostId) return;
      submit({ path, hostId, target, closeDialog });
    },
    [closeDialog, hostId, isPending, submit],
  );

  const openPicker = useCallback(
    (target: ProjectPathDialogTarget) => {
      if (isPending || !hostId) return;

      if (pickFolder) {
        void (async () => {
          const selectedPath = await pickFolder();
          if (!selectedPath) return;
          submitPath(normalizeProjectPathInput(selectedPath), target);
        })();
        return;
      }

      projectPathDialog.onOpen(target);
    },
    [hostId, isPending, pickFolder, projectPathDialog, submitPath],
  );

  const submitProjectPath = useCallback<ProjectPathDialogSubmitHandler>(
    (target, path) => {
      submitPath(path, target);
    },
    [submitPath],
  );

  return {
    isAvailable: hostId != null,
    hostId,
    hostName,
    openPicker,
    platform,
    projectPathDialog,
    submitProjectPath,
  };
}
