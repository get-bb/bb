import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { PromptMentionResource, ThreadListEntry } from "@bb/domain";
import { PromptMentionPill } from "@/components/thread/timeline/ConversationMessageMentions";
import { getThreadDisplayTitle } from "@/lib/thread-title";

interface ThreadTitleMentionResources {
  folderNamesById: ReadonlyMap<string, string>;
  projectNamesById: ReadonlyMap<string, string>;
  threadById: ReadonlyMap<string, ThreadListEntry>;
}

const EMPTY_TITLE_MENTION_RESOURCES: ThreadTitleMentionResources = {
  folderNamesById: new Map(),
  projectNamesById: new Map(),
  threadById: new Map(),
};

const ThreadTitleMentionResourcesContext =
  createContext<ThreadTitleMentionResources>(EMPTY_TITLE_MENTION_RESOURCES);

const SERIALIZED_TITLE_MENTION_PATTERN =
  /@(?:thread:[A-Za-z0-9_-]+|project:[A-Za-z0-9_-]+|folder:[A-Za-z0-9_-]+|(?:thread-storage:)?(?:(?:[\p{L}\p{N}._-]+\/)+(?:[\p{L}\p{N}._-]*\.[\p{L}\p{N}_-]+)?|[\p{L}\p{N}._-]*\.[\p{L}\p{N}_-]+))/gu;

export interface ThreadTitleMentionResourcesProviderProps {
  children: ReactNode;
  folderNamesById: ReadonlyMap<string, string>;
  projectNamesById: ReadonlyMap<string, string>;
  threadById: ReadonlyMap<string, ThreadListEntry>;
}

export function ThreadTitleMentionResourcesProvider({
  children,
  folderNamesById,
  projectNamesById,
  threadById,
}: ThreadTitleMentionResourcesProviderProps) {
  const value = useMemo(
    () => ({ folderNamesById, projectNamesById, threadById }),
    [folderNamesById, projectNamesById, threadById],
  );

  return (
    <ThreadTitleMentionResourcesContext.Provider value={value}>
      {children}
    </ThreadTitleMentionResourcesContext.Provider>
  );
}

function isMentionBoundary(text: string, index: number): boolean {
  const previous = text[index - 1];
  return previous === undefined || !/[\p{L}\p{N}_.+-]/u.test(previous);
}

function isMentionEndBoundary(text: string, index: number): boolean {
  const next = text[index];
  if (next === undefined) return true;
  if (next === ".") {
    const afterPeriod = text[index + 1];
    return afterPeriod === undefined || /[\s,;:!?)}\]]/u.test(afterPeriod);
  }
  return !/[\p{L}\p{N}_.+\/-]/u.test(next);
}

function hasUnsupportedPathContinuation(text: string, index: number): boolean {
  return /^\s+(?:[\p{L}\p{N}._-]+(?:\s+|\/))*[\p{L}\p{N}_-]+(?:\/|\.[\p{L}\p{N}_-]+)(?=$|[\s,;:!?)}\]])/u.test(
    text.slice(index),
  );
}

function isPathMentionToken(token: string): boolean {
  return !/^@(?:thread|project|folder):/u.test(token);
}

function pathMentionResource(token: string): PromptMentionResource {
  const serializedPath = token.slice(1);
  const source = serializedPath.startsWith("thread-storage:")
    ? "thread-storage"
    : "workspace";
  const path =
    source === "thread-storage"
      ? serializedPath.slice("thread-storage:".length)
      : serializedPath;
  const isDirectory = path.endsWith("/");
  const normalizedPath = isDirectory ? path.slice(0, -1) : path;
  const lastSlash = normalizedPath.lastIndexOf("/");

  return {
    kind: "path",
    source,
    entryKind: isDirectory ? "directory" : "file",
    path: normalizedPath,
    label: normalizedPath.slice(lastSlash + 1) || normalizedPath,
  };
}

function resolveTitleMentionResource(
  token: string,
  resources: ThreadTitleMentionResources,
): PromptMentionResource {
  const serializedValue = token.slice(1);
  if (serializedValue.startsWith("thread:")) {
    const threadId = serializedValue.slice("thread:".length);
    const thread = resources.threadById.get(threadId);
    return {
      kind: "thread",
      threadId,
      ...(thread ? { projectId: thread.projectId } : {}),
      label: thread ? getThreadDisplayTitle(thread) : threadId,
    };
  }

  if (serializedValue.startsWith("project:")) {
    const projectId = serializedValue.slice("project:".length);
    return {
      kind: "project",
      projectId,
      label: resources.projectNamesById.get(projectId) ?? projectId,
    };
  }

  if (serializedValue.startsWith("folder:")) {
    const folderId = serializedValue.slice("folder:".length);
    return {
      kind: "folder",
      folderId,
      label: resources.folderNamesById.get(folderId) ?? folderId,
    };
  }

  return pathMentionResource(token);
}

interface ThreadTitleTextSegment {
  resource: PromptMentionResource | null;
  serializedText: string | null;
  text: string;
}

function threadTitleTextSegments(
  title: string,
  resources: ThreadTitleMentionResources,
): ThreadTitleTextSegment[] {
  const segments: ThreadTitleTextSegment[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  SERIALIZED_TITLE_MENTION_PATTERN.lastIndex = 0;
  while ((match = SERIALIZED_TITLE_MENTION_PATTERN.exec(title)) !== null) {
    const token = match[0];
    const matchEnd = match.index + token.length;
    if (
      !isMentionBoundary(title, match.index) ||
      !isMentionEndBoundary(title, matchEnd) ||
      (isPathMentionToken(token) &&
        hasUnsupportedPathContinuation(title, matchEnd))
    ) {
      continue;
    }
    if (match.index > cursor) {
      segments.push({
        resource: null,
        serializedText: null,
        text: title.slice(cursor, match.index),
      });
    }
    const resource = resolveTitleMentionResource(token, resources);
    segments.push({
      resource,
      serializedText: token,
      text: resource.label,
    });
    cursor = matchEnd;
  }

  if (segments.length === 0) {
    return [{ resource: null, serializedText: null, text: title }];
  }
  if (cursor < title.length) {
    segments.push({
      resource: null,
      serializedText: null,
      text: title.slice(cursor),
    });
  }
  return segments;
}

/** Resolves serialized mentions in a thread title to one plain display label. */
export function useThreadTitleDisplayText(title: string): string {
  const resources = useContext(ThreadTitleMentionResourcesContext);
  return useMemo(
    () =>
      threadTitleTextSegments(title, resources)
        .map((segment) => segment.text)
        .join(""),
    [resources, title],
  );
}

/** Renders serialized prompt mentions persisted in thread title fallbacks. */
export function ThreadTitleMentions({ title }: { title: string }) {
  const resources = useContext(ThreadTitleMentionResourcesContext);
  return threadTitleTextSegments(title, resources).map((segment, index) =>
    segment.resource === null || segment.serializedText === null ? (
      segment.text
    ) : (
      <span key={`${index}:${segment.serializedText}`}>
        <PromptMentionPill
          interactive={false}
          resource={segment.resource}
          serializedText={segment.serializedText}
        />
      </span>
    ),
  );
}
