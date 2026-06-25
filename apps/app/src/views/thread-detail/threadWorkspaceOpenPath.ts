import type { Environment, WorkspaceFileStatus } from "@bb/domain";
import type { OpenInTargetContext } from "@bb/host-daemon-contract";
import type { WorkspaceChangedFilesSection } from "@/components/workspace/workspace-change-summary";
import type {
  EnvironmentFilePreviewSource,
  WorkspaceFilePreviewStatusLabel,
} from "@/lib/file-preview";
import { buildAbsoluteFilePath } from "@/lib/absolute-file-path";

interface ResolveThreadWorkspaceOpenPathArgs {
  canOpenWorkspace: boolean;
  environment: Environment | null | undefined;
  hasWorkspaceOpenTargets: boolean;
}

interface ResolveEnvironmentOpenContextArgs {
  environment: Environment | null | undefined;
  serverOrigin: string;
  threadEnvironmentIsLocal: boolean;
}

export interface BuildOpenInEditorHandlerArgs {
  rootPath: string | null;
  canOpenPreferredTarget: boolean;
  openInPreferredTarget: (request: {
    lineNumber: number | null;
    path: string;
  }) => Promise<boolean>;
}

/**
 * Build the file-preview header's "open in editor" callback, gated on the
 * thread's environment being local and an editor being configured. Returns
 * `undefined` when either gate isn't satisfied so the icon hides instead of
 * surfacing a no-op button.
 */
export function buildOpenInEditorHandler(
  args: BuildOpenInEditorHandlerArgs,
): ((relativePath: string) => void) | undefined {
  if (!args.rootPath || !args.canOpenPreferredTarget) {
    return undefined;
  }
  const rootPath = args.rootPath;
  return (relativePath) => {
    void args.openInPreferredTarget({
      lineNumber: null,
      path: buildAbsoluteFilePath({ path: relativePath, rootPath }),
    });
  };
}

export interface ResolveThreadLocalWorkspaceRootPathArgs {
  environment: Environment | null | undefined;
  threadEnvironmentIsLocal: boolean;
}

export interface ResolveThreadWorkspacePreviewRootPathArgs {
  environment: Environment | null | undefined;
}

export type WorkspaceChangedFileOpenTarget =
  | { kind: "diff" }
  | {
      kind: "preview";
      source: EnvironmentFilePreviewSource;
      statusLabel: WorkspaceFilePreviewStatusLabel | null;
    };

export interface ResolveWorkspaceChangedFileOpenTargetArgs {
  file: WorkspaceFileStatus;
  section: WorkspaceChangedFilesSection;
}

export function resolveWorkspaceChangedFileOpenTarget(
  args: ResolveWorkspaceChangedFileOpenTargetArgs,
): WorkspaceChangedFileOpenTarget {
  if (args.file.status === "A" || args.file.status === "??") {
    return {
      kind: "preview",
      source: { kind: "working-tree" },
      statusLabel: null,
    };
  }

  if (args.file.status === "D") {
    if (args.section.kind === "committed") {
      return args.section.mergeBaseRef
        ? {
            kind: "preview",
            source: { kind: "merge-base", ref: args.section.mergeBaseRef },
            statusLabel: "deleted",
          }
        : { kind: "diff" };
    }
    return {
      kind: "preview",
      source: { kind: "head" },
      statusLabel: "deleted",
    };
  }

  return { kind: "diff" };
}

export function resolveThreadLocalWorkspaceRootPath(
  args: ResolveThreadLocalWorkspaceRootPathArgs,
): string | null {
  if (!args.threadEnvironmentIsLocal) {
    return null;
  }

  return args.environment?.path ?? null;
}

/**
 * Workspace previews are served by the thread host through the server, so path
 * containment should use the environment's host path even when the browser
 * cannot use that path for local editor integration.
 */
export function resolveThreadWorkspacePreviewRootPath(
  args: ResolveThreadWorkspacePreviewRootPathArgs,
): string | null {
  return args.environment?.path ?? null;
}

export function resolveEnvironmentOpenContext(
  args: ResolveEnvironmentOpenContextArgs,
): OpenInTargetContext | null {
  if (!args.environment) {
    return null;
  }
  if (args.threadEnvironmentIsLocal) {
    return { kind: "local" };
  }
  return {
    kind: "remote-ssh",
    serverOrigin: args.serverOrigin,
    hostId: args.environment.hostId,
  };
}

export function resolveThreadWorkspaceOpenPath(
  args: ResolveThreadWorkspaceOpenPathArgs,
): string | null {
  if (!args.canOpenWorkspace || !args.hasWorkspaceOpenTargets) {
    return null;
  }

  return args.environment?.path ?? null;
}
