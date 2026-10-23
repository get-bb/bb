import type { Environment } from "@bb/domain";
import type { OpenInTargetContext } from "@bb/host-daemon-contract";
import { buildAbsoluteFilePath } from "@bb/shared-ui/lib/absolute-file-path";

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
