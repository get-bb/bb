import { fuzzyMatchText } from "@bb/fuzzy-match";
import { PERSONAL_PROJECT_ID, type Thread } from "@bb/domain";
import type { PromptMentionSuggestion } from "@/components/promptbox/mentions/types";
import { compareCodepoint } from "@/lib/codepoint-compare";

export type ThreadMentionSuggestion = Extract<
  PromptMentionSuggestion,
  { kind: "thread" }
>;

export interface BuildThreadMentionSuggestionsArgs {
  threads: readonly Thread[];
  query: string;
  currentProjectId?: string;
  currentThreadId?: string;
  projectNamesById: ReadonlyMap<string, string>;
  limit: number;
}

interface RankedThreadMentionSuggestion {
  suggestion: ThreadMentionSuggestion;
  relationRank: number;
  score: number;
}

interface ThreadMentionContext {
  currentParentThreadId: string | null;
  currentProjectId?: string;
  currentThreadId?: string;
}

const THREAD_RELATION_RANK = {
  directParentOrChild: 0,
  sameParent: 1,
  sameProject: 2,
  unrelated: 3,
};

function getThreadDisplayTitle(thread: Thread): string | undefined {
  const title = thread.title?.trim();
  if (title) {
    return title;
  }

  const titleFallback = thread.titleFallback?.trim();
  return titleFallback || undefined;
}

function getThreadSearchTexts(thread: Thread): readonly string[] {
  const title = getThreadDisplayTitle(thread);
  return title ? [title, thread.id] : [thread.id];
}

function canSuggestThread(
  thread: Thread,
  args: BuildThreadMentionSuggestionsArgs,
): boolean {
  return thread.id !== args.currentThreadId;
}

function shouldShowProjectName(
  thread: Thread,
  context: ThreadMentionContext,
): boolean {
  if (thread.projectId === PERSONAL_PROJECT_ID) {
    return false;
  }

  return (
    context.currentProjectId === undefined ||
    thread.projectId !== context.currentProjectId
  );
}

function toThreadMentionSuggestion(
  thread: Thread,
  context: ThreadMentionContext,
  projectNamesById: ReadonlyMap<string, string>,
): ThreadMentionSuggestion {
  const projectName = shouldShowProjectName(thread, context)
    ? projectNamesById.get(thread.projectId)
    : undefined;
  return {
    kind: "thread",
    path: `thread:${thread.id}`,
    replacement: `thread:${thread.id}`,
    projectId: thread.projectId,
    ...(projectName ? { projectName } : {}),
    threadId: thread.id,
    title: getThreadDisplayTitle(thread),
  };
}

function getThreadMentionContext(
  args: BuildThreadMentionSuggestionsArgs,
): ThreadMentionContext {
  const currentThread = args.currentThreadId
    ? args.threads.find((thread) => thread.id === args.currentThreadId)
    : undefined;

  return {
    currentParentThreadId: currentThread?.parentThreadId ?? null,
    currentProjectId: args.currentProjectId ?? currentThread?.projectId,
    currentThreadId: args.currentThreadId,
  };
}

function getThreadRelationRank(
  thread: Thread,
  context: ThreadMentionContext,
): number {
  if (
    context.currentThreadId !== undefined &&
    thread.parentThreadId === context.currentThreadId
  ) {
    return THREAD_RELATION_RANK.directParentOrChild;
  }
  if (
    context.currentParentThreadId !== null &&
    thread.id === context.currentParentThreadId
  ) {
    return THREAD_RELATION_RANK.directParentOrChild;
  }
  if (
    context.currentParentThreadId !== null &&
    thread.parentThreadId === context.currentParentThreadId
  ) {
    return THREAD_RELATION_RANK.sameParent;
  }
  if (
    context.currentProjectId !== undefined &&
    thread.projectId === context.currentProjectId
  ) {
    return THREAD_RELATION_RANK.sameProject;
  }
  return THREAD_RELATION_RANK.unrelated;
}

function compareRankedThreadMentionSuggestions(
  left: RankedThreadMentionSuggestion,
  right: RankedThreadMentionSuggestion,
): number {
  if (left.score !== right.score) {
    return right.score - left.score;
  }
  if (left.relationRank !== right.relationRank) {
    return left.relationRank - right.relationRank;
  }
  const leftTitle = left.suggestion.title ?? "";
  const rightTitle = right.suggestion.title ?? "";
  return (
    leftTitle.localeCompare(rightTitle) ||
    compareCodepoint(left.suggestion.threadId, right.suggestion.threadId)
  );
}

export function buildThreadMentionSuggestions(
  args: BuildThreadMentionSuggestionsArgs,
): ThreadMentionSuggestion[] {
  const trimmedQuery = args.query.trim();
  if (trimmedQuery.length === 0 || args.limit <= 0) {
    return [];
  }

  const candidateThreads = args.threads.filter((thread) =>
    canSuggestThread(thread, args),
  );
  const context = getThreadMentionContext(args);
  const matches = fuzzyMatchText({
    items: candidateThreads,
    query: trimmedQuery,
    getText: getThreadSearchTexts,
    limit: candidateThreads.length,
  });

  return matches
    .map<RankedThreadMentionSuggestion>((match) => ({
      suggestion: toThreadMentionSuggestion(
        match.item,
        context,
        args.projectNamesById,
      ),
      relationRank: getThreadRelationRank(match.item, context),
      score: match.score,
    }))
    .sort(compareRankedThreadMentionSuggestions)
    .slice(0, args.limit)
    .map((match) => match.suggestion);
}
