import { useCallback, useMemo } from "react";
import type {
  OpenInTargetContext,
  WorkspaceOpenTarget,
  WorkspaceOpenTargetId,
} from "@bb/host-daemon-contract";
import { appToast } from "@/components/ui/app-toast";
import {
  resolvePreferredWorkspaceOpenFileTarget,
  resolvePreferredWorkspaceOpenTarget,
  supportsWorkspaceOpenTargetCapability,
  type StoredWorkspaceOpenTargetPreference,
  type WorkspaceOpenTargetContextKind,
  useFileOpenTargetPreference,
  useWorkspaceOpenTargetPreference,
} from "@/lib/workspace-open-target-preference";
import { useHostDaemon } from "./useHostDaemon";
import { useWorkspaceOpenTargets } from "./useWorkspaceOpenTargets";

const LOCAL_OPEN_FAILURE_TITLE = "Failed to open file locally";
const LOCAL_DAEMON_UNAVAILABLE_OPEN_DESCRIPTION =
  "Local host daemon is unavailable.";
const LOCAL_NO_FILE_OPEN_TARGETS_DESCRIPTION = "No local app can open files.";
const LOCAL_NO_DIRECTORY_OPEN_TARGETS_DESCRIPTION =
  "No local app can open directories.";

export interface UseLocalOpenTargetsArgs {
  enabled: boolean;
  openContext?: OpenInTargetContext;
}

export interface OpenLocalPathRequest {
  columnNumber?: number | null;
  lineNumber: number | null;
  path: string;
}

export interface OpenPathInDirectoryTargetArgs extends OpenLocalPathRequest {
  rememberTarget: boolean;
  targetId: WorkspaceOpenTargetId;
}

export interface OpenPathInPreferredTargetArgs extends OpenLocalPathRequest {}

interface OpenPathInAvailableTargetArgs extends OpenLocalPathRequest {
  rememberTarget: boolean;
  target: WorkspaceOpenTarget;
  targetKind: OpenUnavailableTargetKind;
}

export interface UseLocalOpenTargetsResult {
  canOpenPreferredDirectoryTarget: boolean;
  canOpenPreferredFileTarget: boolean;
  directoryOpenTargets: WorkspaceOpenTarget[];
  openPathInDirectoryTarget: (
    args: OpenPathInDirectoryTargetArgs,
  ) => Promise<boolean>;
  openPathInPreferredDirectoryTarget: (
    args: OpenPathInPreferredTargetArgs,
  ) => Promise<boolean>;
  openPathInPreferredFileTarget: (
    args: OpenPathInPreferredTargetArgs,
  ) => Promise<boolean>;
  preferredDirectoryTarget: WorkspaceOpenTarget | null;
  preferredFileTarget: WorkspaceOpenTarget | null;
}

type OpenUnavailableTargetKind = "file-open-target" | "directory-open-target";

interface OpenUnavailableDescriptionArgs {
  hasDaemon: boolean;
  targetKind: OpenUnavailableTargetKind;
}

interface DispatchOpenFailureToastArgs {
  description?: string;
}

interface SupportedLineNumberArgs {
  columnNumber: number | null;
  contextKind: WorkspaceOpenTargetContextKind;
  lineNumber: number | null;
  target: WorkspaceOpenTarget;
}

interface SupportedLocation {
  columnNumber: number | null;
  lineNumber: number | null;
}

interface UseOpenTargetResolutionArgs {
  contextKind: WorkspaceOpenTargetContextKind;
  preferredDirectoryTargetId: StoredWorkspaceOpenTargetPreference;
  preferredFileTargetId: StoredWorkspaceOpenTargetPreference;
  workspaceOpenTargets: WorkspaceOpenTarget[];
}

interface OpenTargetResolution {
  directoryOpenTargets: WorkspaceOpenTarget[];
  preferredDirectoryTarget: WorkspaceOpenTarget | null;
  preferredFileTarget: WorkspaceOpenTarget | null;
}

function getOpenUnavailableDescription(
  args: OpenUnavailableDescriptionArgs,
): string {
  if (!args.hasDaemon) {
    return LOCAL_DAEMON_UNAVAILABLE_OPEN_DESCRIPTION;
  }

  if (args.targetKind === "file-open-target") {
    return LOCAL_NO_FILE_OPEN_TARGETS_DESCRIPTION;
  }

  return LOCAL_NO_DIRECTORY_OPEN_TARGETS_DESCRIPTION;
}

function dispatchOpenFailureToast(args: DispatchOpenFailureToastArgs): void {
  appToast.error(LOCAL_OPEN_FAILURE_TITLE, {
    ...(args.description ? { description: args.description } : {}),
  });
}

function getSupportedLocation(
  args: SupportedLineNumberArgs,
): SupportedLocation {
  const lineNumber = supportsWorkspaceOpenTargetCapability({
    capability: "openFileAtLine",
    contextKind: args.contextKind,
    target: args.target,
  })
    ? args.lineNumber
    : null;
  const columnNumber =
    lineNumber !== null &&
    supportsWorkspaceOpenTargetCapability({
      capability: "openFileAtColumn",
      contextKind: args.contextKind,
      target: args.target,
    })
      ? args.columnNumber
      : null;
  return { columnNumber, lineNumber };
}

function useOpenTargetResolution(
  args: UseOpenTargetResolutionArgs,
): OpenTargetResolution {
  const directoryOpenTargets = useMemo(
    () =>
      args.workspaceOpenTargets.filter((target) =>
        supportsWorkspaceOpenTargetCapability({
          capability: "openDirectory",
          contextKind: args.contextKind,
          target,
        }),
      ),
    [args.contextKind, args.workspaceOpenTargets],
  );
  // Resolve locally from the already-gated `workspaceOpenTargets` so that
  // callers passing `enabled: false` don't trigger a daemon fetch via the
  // global atom.
  const preferredDirectoryTarget = useMemo(
    () =>
      resolvePreferredWorkspaceOpenTarget({
        capability: "openDirectory",
        contextKind: args.contextKind,
        preferredTargetId: args.preferredDirectoryTargetId,
        targets: directoryOpenTargets,
      }),
    [args.contextKind, args.preferredDirectoryTargetId, directoryOpenTargets],
  );
  const preferredFileTarget = useMemo(
    () =>
      resolvePreferredWorkspaceOpenTarget({
        capability: "openFile",
        contextKind: args.contextKind,
        preferredTargetId: args.preferredFileTargetId,
        targets: args.workspaceOpenTargets,
      }),
    [args.contextKind, args.preferredFileTargetId, args.workspaceOpenTargets],
  );

  return {
    directoryOpenTargets,
    preferredDirectoryTarget,
    preferredFileTarget,
  };
}

export function useLocalOpenTargets(
  args: UseLocalOpenTargetsArgs,
): UseLocalOpenTargetsResult {
  const openContext = useMemo<OpenInTargetContext>(
    () => args.openContext ?? { kind: "local" },
    [args.openContext],
  );
  const contextKind = openContext.kind;
  const { hasDaemon } = useHostDaemon();
  const {
    fetchWorkspaceOpenTargetsForPath,
    openWorkspace,
    workspaceOpenTargets,
  } = useWorkspaceOpenTargets(args);
  const [preferredDirectoryTargetId, setPreferredDirectoryTargetId] =
    useWorkspaceOpenTargetPreference();
  const [preferredFileTargetId, setPreferredFileTargetId] =
    useFileOpenTargetPreference();
  const {
    directoryOpenTargets,
    preferredDirectoryTarget,
    preferredFileTarget,
  } = useOpenTargetResolution({
    contextKind,
    preferredDirectoryTargetId,
    preferredFileTargetId,
    workspaceOpenTargets,
  });
  const rememberPreferredOpenTarget = useCallback(
    (target: WorkspaceOpenTarget) => {
      if (
        supportsWorkspaceOpenTargetCapability({
          capability: "openDirectory",
          contextKind,
          target,
        })
      ) {
        setPreferredDirectoryTargetId(target.id);
      }
      if (
        supportsWorkspaceOpenTargetCapability({
          capability: "openFile",
          contextKind,
          target,
        })
      ) {
        setPreferredFileTargetId(target.id);
      }
    },
    [contextKind, setPreferredDirectoryTargetId, setPreferredFileTargetId],
  );

  const openPathInAvailableTarget = useCallback(
    async (request: OpenPathInAvailableTargetArgs) => {
      if (!openWorkspace) {
        dispatchOpenFailureToast({
          description: getOpenUnavailableDescription({
            hasDaemon,
            targetKind: request.targetKind,
          }),
        });
        return false;
      }

      if (request.rememberTarget) {
        rememberPreferredOpenTarget(request.target);
      }

      try {
        const location = getSupportedLocation({
          columnNumber: request.columnNumber ?? null,
          contextKind,
          lineNumber: request.lineNumber,
          target: request.target,
        });
        await openWorkspace({
          columnNumber: location.columnNumber,
          context: openContext,
          lineNumber: location.lineNumber,
          path: request.path,
          targetId: request.target.id,
        });
        return true;
      } catch (error) {
        const description = error instanceof Error ? error.message : undefined;
        dispatchOpenFailureToast({ ...(description ? { description } : {}) });
        return false;
      }
    },
    [
      hasDaemon,
      contextKind,
      openWorkspace,
      openContext,
      rememberPreferredOpenTarget,
    ],
  );

  const openPathInDirectoryTarget = useCallback(
    async (request: OpenPathInDirectoryTargetArgs) => {
      const target = directoryOpenTargets.find(
        (candidate) => candidate.id === request.targetId,
      );
      if (!target) {
        dispatchOpenFailureToast({
          description: getOpenUnavailableDescription({
            hasDaemon,
            targetKind: "directory-open-target",
          }),
        });
        return false;
      }

      return openPathInAvailableTarget({
        columnNumber: request.columnNumber ?? null,
        lineNumber: request.lineNumber,
        path: request.path,
        rememberTarget: request.rememberTarget,
        target,
        targetKind: "directory-open-target",
      });
    },
    [directoryOpenTargets, hasDaemon, openPathInAvailableTarget],
  );

  const openPathInPreferredDirectoryTarget = useCallback(
    async (request: OpenPathInPreferredTargetArgs) => {
      if (!preferredDirectoryTarget) {
        dispatchOpenFailureToast({
          description: getOpenUnavailableDescription({
            hasDaemon,
            targetKind: "directory-open-target",
          }),
        });
        return false;
      }

      return openPathInAvailableTarget({
        columnNumber: request.columnNumber ?? null,
        lineNumber: request.lineNumber,
        path: request.path,
        rememberTarget: false,
        target: preferredDirectoryTarget,
        targetKind: "directory-open-target",
      });
    },
    [hasDaemon, openPathInAvailableTarget, preferredDirectoryTarget],
  );
  const openPathInPreferredFileTarget = useCallback(
    async (request: OpenPathInPreferredTargetArgs) => {
      const fileTargets =
        contextKind === "local" && fetchWorkspaceOpenTargetsForPath !== null
          ? await fetchWorkspaceOpenTargetsForPath(request.path).catch(
              () => workspaceOpenTargets,
            )
          : workspaceOpenTargets;
      const target = resolvePreferredWorkspaceOpenFileTarget({
        contextKind,
        lineNumber: request.lineNumber,
        path: request.path,
        preferredTargetId: preferredFileTargetId,
        targets: fileTargets,
      });

      if (!target) {
        dispatchOpenFailureToast({
          description: getOpenUnavailableDescription({
            hasDaemon,
            targetKind: "file-open-target",
          }),
        });
        return false;
      }

      return openPathInAvailableTarget({
        columnNumber: request.columnNumber ?? null,
        lineNumber: request.lineNumber,
        path: request.path,
        rememberTarget: false,
        target,
        targetKind: "file-open-target",
      });
    },
    [
      contextKind,
      fetchWorkspaceOpenTargetsForPath,
      hasDaemon,
      openPathInAvailableTarget,
      preferredFileTargetId,
      workspaceOpenTargets,
    ],
  );

  return {
    canOpenPreferredDirectoryTarget: preferredDirectoryTarget !== null,
    canOpenPreferredFileTarget: preferredFileTarget !== null,
    directoryOpenTargets,
    openPathInDirectoryTarget,
    openPathInPreferredDirectoryTarget,
    openPathInPreferredFileTarget,
    preferredDirectoryTarget,
    preferredFileTarget,
  };
}
