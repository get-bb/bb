import type { PluginFileOpenerProps } from "@get-bb/plugin-sdk";
import type { ThreadTabFileOpenerOwner } from "@bb/server-contract";
import { z } from "zod";
import {
  createPluginPanelFixedPanelTab,
  type PluginPanelFixedPanelTab,
  type SecondaryFileFixedPanelTab,
} from "@/lib/fixed-panel-tabs-state";
import type { FileOpenerPreferenceMap } from "@/lib/file-opener-preference";
import {
  resolveFileOpenerReplacement,
  type FileOpenerOverride,
} from "@/lib/plugin-slot-resolvers";
import type { PluginFileOpenerSlot } from "@/lib/plugin-slots";
import type { OpenSecondaryPanelTabRequest } from "@/components/secondary-panel/useThreadFileTabs";

const FILE_OPENER_ACTION_ID_PREFIX = "file-opener:";

type PluginFileOpenerFile = Pick<PluginFileOpenerProps, "path" | "source">;

const fileOpenerParamsSchema = z.object({
  path: z.string().min(1),
  source: z.object({
    kind: z.enum(["workspace", "host", "thread-storage"]),
    threadId: z.string().nullable().default(null),
    environmentId: z.string().nullable().default(null),
    projectId: z.string().nullable().default(null),
    experimental_hostId: z.string().optional(),
  }),
});

export type FileOpenerOriginalTab = Extract<
  SecondaryFileFixedPanelTab,
  {
    kind:
      | "workspace-file-preview"
      | "host-file-preview"
      | "thread-storage-file-preview";
  }
>;

export function fileOpenerIdFromActionId(actionId: string): string | null {
  return actionId.startsWith(FILE_OPENER_ACTION_ID_PREFIX)
    ? actionId.slice(FILE_OPENER_ACTION_ID_PREFIX.length)
    : null;
}

export function buildFileOpenerPanelTab(
  opener: Pick<PluginFileOpenerSlot, "id" | "pluginId">,
  file: PluginFileOpenerFile,
  owner: ThreadTabFileOpenerOwner,
): PluginPanelFixedPanelTab {
  return {
    ...createPluginPanelFixedPanelTab({
      actionId: `${FILE_OPENER_ACTION_ID_PREFIX}${opener.id}`,
      paramsJson: JSON.stringify({ path: file.path, source: file.source }),
      pluginId: opener.pluginId,
      title: file.path.split("/").at(-1) ?? file.path,
    }),
    fileOpenerOwner: owner,
  };
}

export function parseFileOpenerParams(
  paramsJson: string | null,
): PluginFileOpenerFile | null {
  if (paramsJson === null) return null;
  try {
    const parsed = fileOpenerParamsSchema.safeParse(JSON.parse(paramsJson));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function createFileOpenerOriginalTab(
  tab: PluginPanelFixedPanelTab,
): FileOpenerOriginalTab | null {
  const owner = tab.fileOpenerOwner;
  const file = parseFileOpenerParams(tab.paramsJson);
  if (owner === undefined || file === null) return null;

  const id = `${tab.id}:file-opener-original`;
  if (
    owner.kind === "workspace-file-preview" &&
    file.source.kind === "workspace"
  ) {
    return {
      ...owner.tab,
      environmentId: file.source.environmentId,
      id,
      kind: "workspace-file-preview",
      path: file.path,
      projectId: file.source.projectId,
    };
  }
  if (owner.kind === "host-file-preview" && file.source.kind === "host") {
    return {
      ...owner.tab,
      environmentId: file.source.environmentId,
      hostId: file.source.experimental_hostId ?? null,
      id,
      kind: "host-file-preview",
      path: file.path,
      threadId: file.source.threadId,
    };
  }
  if (
    owner.kind === "thread-storage-file-preview" &&
    file.source.kind === "thread-storage"
  ) {
    return {
      ...owner.tab,
      environmentId: file.source.environmentId,
      id,
      isPinned: false,
      kind: "thread-storage-file-preview",
      path: file.path,
      threadId: file.source.threadId,
    };
  }
  return null;
}

interface CreateFileOpenerTabForRequestArgs {
  fileOpeners: readonly PluginFileOpenerSlot[];
  preference: FileOpenerPreferenceMap;
  projectHostId?: string | null;
  projectId: string | null;
  request: OpenSecondaryPanelTabRequest;
  resolvedEnvironmentId: string | null | undefined;
  threadId: string | null | undefined;
  viewer?: FileOpenerOverride;
}

export function createFileOpenerTabForRequest({
  fileOpeners,
  preference,
  projectHostId,
  projectId,
  request,
  resolvedEnvironmentId,
  threadId,
  viewer,
}: CreateFileOpenerTabForRequestArgs): PluginPanelFixedPanelTab | null {
  const owner = ownerRequestForOpenRequest({
    projectId,
    request,
    resolvedEnvironmentId,
    threadId,
  });
  if (owner === null) return null;
  const file = fileForOwnerRequest(owner);
  const routedFile: PluginFileOpenerFile =
    file.source.kind === "workspace" &&
    file.source.environmentId === null &&
    file.source.projectId !== null &&
    projectHostId
      ? {
          ...file,
          source: {
            ...file.source,
            experimental_hostId: projectHostId,
          },
        }
      : file;
  const resolveArgs: Parameters<typeof resolveFileOpenerReplacement>[0] = {
    registrations: fileOpeners,
    preference,
    path: routedFile.path,
  };
  if (viewer !== undefined) {
    resolveArgs.override = viewer;
  }
  const resolved = resolveFileOpenerReplacement(resolveArgs);
  return resolved.kind === "plugin"
    ? buildFileOpenerPanelTab(resolved.registration, routedFile, owner)
    : null;
}

function ownerRequestForOpenRequest({
  projectId,
  request,
  resolvedEnvironmentId,
  threadId,
}: Omit<
  CreateFileOpenerTabForRequestArgs,
  "fileOpeners" | "preference"
>): ThreadTabFileOpenerOwner | null {
  switch (request.kind) {
    case "workspace-file-preview": {
      if (
        request.environmentId === undefined &&
        resolvedEnvironmentId === undefined
      ) {
        return null;
      }
      if (request.tab.source.kind !== "working-tree") return null;
      if (request.tab.statusLabel === "deleted") return null;
      const environmentId =
        request.environmentId ?? resolvedEnvironmentId ?? null;
      return {
        kind: request.kind,
        environmentId,
        projectId: environmentId === null ? projectId : null,
        tab: request.tab,
        threadId: threadId ?? null,
      };
    }
    case "host-file-preview": {
      if (request.hostId !== undefined) {
        return {
          kind: request.kind,
          environmentId: null,
          hostId: request.hostId,
          tab: request.tab,
          threadId: null,
        };
      }
      if (!threadId || !resolvedEnvironmentId) return null;
      return {
        kind: request.kind,
        environmentId: resolvedEnvironmentId,
        hostId: null,
        tab: request.tab,
        threadId,
      };
    }
    case "thread-storage-file-preview": {
      const storageThreadId = request.threadId ?? threadId;
      if (!storageThreadId) return null;
      return {
        kind: request.kind,
        environmentId: resolvedEnvironmentId ?? null,
        tab: request.tab,
        threadId: storageThreadId,
      };
    }
    default:
      return null;
  }
}

function fileForOwnerRequest(
  owner: ThreadTabFileOpenerOwner,
): PluginFileOpenerFile {
  switch (owner.kind) {
    case "workspace-file-preview":
      return {
        path: owner.tab.path,
        source: {
          kind: "workspace",
          environmentId: owner.environmentId,
          projectId: owner.projectId,
          threadId: owner.threadId,
        },
      };
    case "host-file-preview": {
      const source: PluginFileOpenerFile["source"] = {
        kind: "host",
        environmentId: owner.environmentId,
        projectId: null,
        threadId: owner.threadId,
      };
      if (owner.hostId !== null) {
        source.experimental_hostId = owner.hostId;
      }
      return {
        path: owner.tab.path,
        source,
      };
    }
    case "thread-storage-file-preview":
      return {
        path: owner.tab.path,
        source: {
          kind: "thread-storage",
          environmentId: owner.environmentId,
          projectId: null,
          threadId: owner.threadId,
        },
      };
  }
}
