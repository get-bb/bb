import type { Environment } from "@bb/domain";
import type { ExperimentalFileOpenOptions } from "@get-bb/plugin-sdk";
import type { LiveFileRoot } from "@/hooks/useResolvedLiveFileTarget";

interface ResolveThreadWorkspaceOpenPathArgs {
  canOpenWorkspace: boolean;
  environment: Environment | null | undefined;
  hasWorkspaceOpenTargets: boolean;
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

export function resolveThreadWorkspaceOpenPath(
  args: ResolveThreadWorkspaceOpenPathArgs,
): string | null {
  if (!args.canOpenWorkspace || !args.hasWorkspaceOpenTargets) {
    return null;
  }

  return args.environment?.path ?? null;
}
