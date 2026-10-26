import type {
  Environment,
} from "@bb/domain";
import type { OpenInTargetContext } from "@bb/host-daemon-contract";
import type { WorkspaceChangedFilesSection } from "@/components/workspace/workspace-change-summary";
import { buildAbsoluteFilePath } from "@/lib/absolute-file-path";
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

interface BuildOpenInEditorHandlerArgs {
  rootPath: string | null;
  canOpenPreferredTarget: boolean;
  openInPreferredTarget: (request: {
    lineNumber: number | null;
    path: string;
  }) => Promise<boolean>;
}

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
