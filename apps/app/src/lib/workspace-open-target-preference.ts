import { useAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import {
  workspaceOpenTargetIdSchema,
  type WorkspaceOpenTarget,
  type WorkspaceOpenTargetCapabilities,
  type WorkspaceOpenTargetId,
} from "@bb/host-daemon-contract";
import { createNullableLocalStorageEnumStorage } from "./browser-storage";

export const WORKSPACE_OPEN_TARGET_STORAGE_KEY = "bb.workspaceOpenTarget";
export const FILE_OPEN_TARGET_STORAGE_KEY = "bb.fileOpenTarget";

export type StoredWorkspaceOpenTargetPreference = WorkspaceOpenTargetId | null;
export type WorkspaceOpenTargetCapability =
  keyof WorkspaceOpenTargetCapabilities;
export type WorkspaceOpenTargetContextKind = "local" | "remote-ssh";

const NATIVE_VIEWABLE_FILE_EXTENSIONS = new Set([
  ".avif",
  ".bmp",
  ".csv",
  ".doc",
  ".docx",
  ".gif",
  ".heic",
  ".heif",
  ".jpeg",
  ".jpg",
  ".key",
  ".mov",
  ".mp3",
  ".mp4",
  ".numbers",
  ".pages",
  ".pdf",
  ".png",
  ".ppt",
  ".pptx",
  ".svg",
  ".tif",
  ".tiff",
  ".webm",
  ".webp",
  ".xls",
  ".xlsx",
  ".zip",
]);

interface ResolvePreferredWorkspaceOpenTargetArgs {
  capability: WorkspaceOpenTargetCapability;
  contextKind?: WorkspaceOpenTargetContextKind;
  preferredTargetId: StoredWorkspaceOpenTargetPreference;
  targets: WorkspaceOpenTarget[];
}

interface ResolvePreferredWorkspaceOpenFileTargetArgs {
  contextKind?: WorkspaceOpenTargetContextKind;
  lineNumber?: number | null;
  path: string;
  preferredTargetId: StoredWorkspaceOpenTargetPreference;
  targets: WorkspaceOpenTarget[];
}

interface SupportsWorkspaceOpenTargetCapabilityArgs {
  capability: WorkspaceOpenTargetCapability;
  contextKind?: WorkspaceOpenTargetContextKind;
  target: WorkspaceOpenTarget;
}

interface RankWorkspaceOpenFileTargetArgs {
  lineNumber: number | null;
  path: string;
  target: WorkspaceOpenTarget;
}

export function supportsWorkspaceOpenTargetCapability(
  args: SupportsWorkspaceOpenTargetCapabilityArgs,
): boolean {
  if (args.contextKind === "remote-ssh") {
    return args.target.remoteSshCapabilities?.[args.capability] ?? false;
  }

  return args.target.capabilities[args.capability] ?? false;
}

export function isWorkspaceDirectoryOpenTarget(
  target: WorkspaceOpenTarget,
): boolean {
  return supportsWorkspaceOpenTargetCapability({
    capability: "openDirectory",
    target,
  });
}

export function isWorkspaceFileOpenTarget(
  target: WorkspaceOpenTarget,
): boolean {
  return supportsWorkspaceOpenTargetCapability({
    capability: "openFile",
    target,
  });
}

export function isRemoteSshWorkspaceDirectoryOpenTarget(
  target: WorkspaceOpenTarget,
): boolean {
  return supportsWorkspaceOpenTargetCapability({
    capability: "openDirectory",
    contextKind: "remote-ssh",
    target,
  });
}

export function isRemoteSshWorkspaceFileOpenTarget(
  target: WorkspaceOpenTarget,
): boolean {
  return supportsWorkspaceOpenTargetCapability({
    capability: "openFile",
    contextKind: "remote-ssh",
    target,
  });
}

function resolveFallbackWorkspaceOpenTarget(
  capability: WorkspaceOpenTargetCapability,
  contextKind: WorkspaceOpenTargetContextKind,
  targets: WorkspaceOpenTarget[],
): WorkspaceOpenTarget | null {
  return (
    targets.find((target) =>
      supportsWorkspaceOpenTargetCapability({
        capability,
        contextKind,
        target,
      }),
    ) ?? null
  );
}

function getLowercaseFileExtension(path: string): string {
  const lastSegment = path.split(/[\\/]/u).at(-1) ?? path;
  const dotIndex = lastSegment.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === lastSegment.length - 1) {
    return "";
  }
  return lastSegment.slice(dotIndex).toLowerCase();
}

function isNativeViewablePath(path: string): boolean {
  return NATIVE_VIEWABLE_FILE_EXTENSIONS.has(getLowercaseFileExtension(path));
}

function rankWorkspaceOpenFileTarget(
  args: RankWorkspaceOpenFileTargetArgs,
): number {
  const kind = args.target.kind ?? "editor";

  if (args.lineNumber !== null) {
    if (kind === "editor") return 0;
    if (kind === "terminal") return 1;
    return 10;
  }

  if (isNativeViewablePath(args.path)) {
    if (kind === "native-app") return 0;
    if (kind === "default-app") return 1;
    if (kind === "editor") return 5;
    if (kind === "terminal") return 10;
    return 20;
  }

  if (kind === "editor") return 0;
  if (kind === "terminal") return 5;
  if (kind === "default-app" || kind === "native-app") return 10;
  return 20;
}

function resolveRankedWorkspaceOpenFileFallback(
  args: Omit<
    ResolvePreferredWorkspaceOpenFileTargetArgs,
    "preferredTargetId"
  > & {
    contextKind: WorkspaceOpenTargetContextKind;
    lineNumber: number | null;
  },
): WorkspaceOpenTarget | null {
  const candidates = args.targets.filter((target) =>
    supportsWorkspaceOpenTargetCapability({
      capability: "openFile",
      contextKind: args.contextKind,
      target,
    }),
  );
  if (candidates.length === 0) {
    return null;
  }

  return (
    candidates
      .map((target, index) => ({
        index,
        rank: rankWorkspaceOpenFileTarget({
          lineNumber: args.lineNumber,
          path: args.path,
          target,
        }),
        target,
      }))
      .sort((a, b) => a.rank - b.rank || a.index - b.index)[0]?.target ?? null
  );
}

function isStoredWorkspaceOpenTargetPreference(
  value: string,
): value is WorkspaceOpenTargetId {
  return workspaceOpenTargetIdSchema.safeParse(value).success;
}

const workspaceOpenTargetPreferenceStorage =
  createNullableLocalStorageEnumStorage<WorkspaceOpenTargetId>(
    isStoredWorkspaceOpenTargetPreference,
  );

export const workspaceOpenTargetPreferenceAtom =
  atomWithStorage<StoredWorkspaceOpenTargetPreference>(
    WORKSPACE_OPEN_TARGET_STORAGE_KEY,
    null,
    workspaceOpenTargetPreferenceStorage,
    { getOnInit: true },
  );

export const fileOpenTargetPreferenceAtom =
  atomWithStorage<StoredWorkspaceOpenTargetPreference>(
    FILE_OPEN_TARGET_STORAGE_KEY,
    null,
    workspaceOpenTargetPreferenceStorage,
    { getOnInit: true },
  );

export function resolvePreferredWorkspaceOpenTarget(
  args: ResolvePreferredWorkspaceOpenTargetArgs,
): WorkspaceOpenTarget | null {
  const contextKind = args.contextKind ?? "local";
  if (args.preferredTargetId !== null) {
    const preferredTarget = args.targets.find(
      (target) =>
        target.id === args.preferredTargetId &&
        supportsWorkspaceOpenTargetCapability({
          capability: args.capability,
          contextKind,
          target,
        }),
    );
    if (preferredTarget) {
      return preferredTarget;
    }
  }

  // Preserve stale preferences rather than clearing them. The app may be
  // temporarily unavailable and should become primary again after reinstall.
  return resolveFallbackWorkspaceOpenTarget(
    args.capability,
    contextKind,
    args.targets,
  );
}

export function resolvePreferredWorkspaceOpenFileTarget(
  args: ResolvePreferredWorkspaceOpenFileTargetArgs,
): WorkspaceOpenTarget | null {
  const contextKind = args.contextKind ?? "local";
  if (args.preferredTargetId !== null) {
    const preferredTarget = args.targets.find(
      (target) =>
        target.id === args.preferredTargetId &&
        supportsWorkspaceOpenTargetCapability({
          capability: "openFile",
          contextKind,
          target,
        }),
    );
    if (preferredTarget) {
      return preferredTarget;
    }
  }

  return resolveRankedWorkspaceOpenFileFallback({
    contextKind,
    lineNumber: args.lineNumber ?? null,
    path: args.path,
    targets: args.targets,
  });
}

export function useWorkspaceOpenTargetPreference() {
  return useAtom(workspaceOpenTargetPreferenceAtom);
}

export function useFileOpenTargetPreference() {
  return useAtom(fileOpenTargetPreferenceAtom);
}
