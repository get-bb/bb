import type { Environment } from "@bb/domain";
import type { OpenInTargetContext } from "@bb/host-daemon-contract";
import type { WorkspaceChangedFilesSection } from "@/components/workspace/workspace-change-summary";
import type { ExperimentalFileOpenOptions } from "@get-bb/plugin-sdk";
import type { LiveFileRoot } from "@/hooks/useResolvedLiveFileTarget";
import type { WorkspaceFileStatus } from "bb-plugin-bb--git/contract";

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

interface BuildOpenFileExternallyHandlerArgs {
  root: LiveFileRoot | null;
  canOpenFileExternally: boolean;
  openFileExternally: (intent: ExperimentalFileOpenOptions) => boolean;
  lineNumber: number | null;
}

export function buildOpenFileExternallyHandler(
  args: BuildOpenFileExternallyHandlerArgs,
): ((path: string) => void) | undefined {
  const { root, lineNumber } = args;
  if (root === null || !args.canOpenFileExternally) {
    return undefined;
  }
  return (path) => {
    args.openFileExternally({
      target: { ...root, path },
      location:
        lineNumber === null
          ? null
          : { kind: "line", line: lineNumber, column: null },
    });
  };
}

type WorkspaceChangedFileOpenTarget =
  | { kind: "diff" }
  | { kind: "preview"; ref: string | undefined };

interface ResolveWorkspaceChangedFileOpenTargetArgs {
  file: WorkspaceFileStatus;
  section: WorkspaceChangedFilesSection;
}

export function resolveWorkspaceChangedFileOpenTarget(
  args: ResolveWorkspaceChangedFileOpenTargetArgs,
): WorkspaceChangedFileOpenTarget {
  if (args.file.status === "A" || args.file.status === "??") {
    return { kind: "preview", ref: undefined };
  }

  if (args.file.status === "D") {
    if (args.section.kind === "committed") {
      return args.section.mergeBaseRef
        ? { kind: "preview", ref: args.section.mergeBaseRef }
        : { kind: "diff" };
    }
    return { kind: "preview", ref: "HEAD" };
  }

  return { kind: "diff" };
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
