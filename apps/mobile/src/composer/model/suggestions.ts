import {
  compareCodepoint,
  DEFAULT_PLUGIN_MENTION_TRIGGER,
  orderCommandSuggestions,
  PLUGIN_MENTION_TRIGGER_VALUES,
  toProviderCommandSuggestion,
  type PluginMentionTrigger,
  type PromptMentionSuggestion,
  type ProviderCommandSuggestion,
} from "@bb/client-core";
import {
  PERSONAL_PROJECT_ID,
  type PromptMentionCommandTrigger,
  type Thread,
} from "@bb/domain";
import { fuzzyMatchText } from "@bb/fuzzy-match";
import type { ProviderCommand, WorkspacePathEntry } from "@bb/server-contract";

/**
 * Pure suggestion builders for the composer typeahead, ported from the web
 * hooks (`apps/app/src/hooks/{thread,project,section,path,plugin}MentionSuggestions.ts`,
 * `usePathSuggestions.ts`, `useCommandSuggestions.ts`) so the menu ranks the
 * same rows in the same order on both clients.
 */

export const PROMPT_MENTION_SOURCE_LIMIT = 8;

// --- Threads ---------------------------------------------------------------

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

const THREAD_RELATION_RANK = {
  directParentOrChild: 0,
  sameParent: 1,
  sameProject: 2,
  unrelated: 3,
};

interface ThreadMentionContext {
  currentParentThreadId: string | null;
  currentProjectId?: string;
  currentThreadId?: string;
}

function threadDisplayTitle(thread: Thread): string | undefined {
  const title = thread.title?.trim();
  if (title) return title;
  const fallback = thread.titleFallback?.trim();
  return fallback || undefined;
}

function threadRelationRank(
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

export function buildThreadMentionSuggestions(
  args: BuildThreadMentionSuggestionsArgs,
): ThreadMentionSuggestion[] {
  const trimmedQuery = args.query.trim();
  if (trimmedQuery.length === 0 || args.limit <= 0) return [];
  const candidates = args.threads.filter(
    (thread) =>
      thread.id !== args.currentThreadId && thread.visibility !== "hidden",
  );
  const currentThread = args.currentThreadId
    ? args.threads.find((thread) => thread.id === args.currentThreadId)
    : undefined;
  const context: ThreadMentionContext = {
    currentParentThreadId: currentThread?.parentThreadId ?? null,
    currentProjectId: args.currentProjectId ?? currentThread?.projectId,
    currentThreadId: args.currentThreadId,
  };
  const matches = fuzzyMatchText({
    items: candidates,
    query: trimmedQuery,
    getText: (thread) => {
      const title = threadDisplayTitle(thread);
      return title ? [title, thread.id] : [thread.id];
    },
    limit: candidates.length,
  });
  return matches
    .map((match) => {
      const thread = match.item;
      const showProjectName =
        thread.projectId !== PERSONAL_PROJECT_ID &&
        (context.currentProjectId === undefined ||
          thread.projectId !== context.currentProjectId);
      const projectName = showProjectName
        ? args.projectNamesById.get(thread.projectId)
        : undefined;
      const suggestion: ThreadMentionSuggestion = {
        kind: "thread",
        path: `thread:${thread.id}`,
        replacement: `thread:${thread.id}`,
        projectId: thread.projectId,
        ...(projectName ? { projectName } : {}),
        threadId: thread.id,
        title: threadDisplayTitle(thread),
      };
      return {
        suggestion,
        relationRank: threadRelationRank(thread, context),
        score: match.score,
      };
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.relationRank - right.relationRank ||
        (left.suggestion.title ?? "").localeCompare(
          right.suggestion.title ?? "",
        ) ||
        compareCodepoint(left.suggestion.threadId, right.suggestion.threadId),
    )
    .slice(0, args.limit)
    .map((ranked) => ranked.suggestion);
}

// --- Projects / sections -----------------------------------------------------

export interface NamedMentionCandidate {
  id: string;
  name: string;
}

function rankNamedCandidates(
  items: readonly NamedMentionCandidate[],
  query: string,
  limit: number,
): NamedMentionCandidate[] {
  const trimmedQuery = query.trim();
  if (trimmedQuery.length === 0 || limit <= 0) return [];
  return fuzzyMatchText({
    items,
    query: trimmedQuery,
    getText: (item) => {
      const name = item.name.trim();
      return name ? [name, item.id] : [item.id];
    },
    limit: items.length,
  })
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.item.name.localeCompare(right.item.name) ||
        compareCodepoint(left.item.id, right.item.id),
    )
    .slice(0, limit)
    .map((match) => match.item);
}

export function buildProjectMentionSuggestions(args: {
  projects: readonly NamedMentionCandidate[];
  query: string;
  limit: number;
}): PromptMentionSuggestion[] {
  return rankNamedCandidates(args.projects, args.query, args.limit).map(
    (project) => ({
      kind: "project",
      path: `project:${project.id}`,
      replacement: `project:${project.id}`,
      projectId: project.id,
      name: project.name.trim() || project.id,
    }),
  );
}

export function buildSectionMentionSuggestions(args: {
  sections: readonly NamedMentionCandidate[];
  query: string;
  limit: number;
}): PromptMentionSuggestion[] {
  return rankNamedCandidates(args.sections, args.query, args.limit).map(
    (section) => ({
      kind: "section",
      path: `section:${section.id}`,
      replacement: `section:${section.id}`,
      sectionId: section.id,
      name: section.name.trim() || section.id,
    }),
  );
}

// --- Paths -------------------------------------------------------------------

export type PathMentionSource = "workspace" | "thread-storage";

interface RankedPath {
  source: PathMentionSource;
  entry: WorkspacePathEntry;
  sourceOrder: number;
}

/**
 * Merge workspace + thread-storage path hits (web `buildPathSuggestions`):
 * score, then workspace first, directories before files, then source order.
 */
export function buildPathMentionSuggestions(args: {
  workspacePaths: readonly WorkspacePathEntry[];
  threadStoragePaths: readonly WorkspacePathEntry[];
  limit: number;
}): PromptMentionSuggestion[] {
  const ranked: RankedPath[] = [
    ...args.workspacePaths.map((entry, sourceOrder) => ({
      source: "workspace" as const,
      entry,
      sourceOrder,
    })),
    ...args.threadStoragePaths.map((entry, sourceOrder) => ({
      source: "thread-storage" as const,
      entry,
      sourceOrder,
    })),
  ];
  ranked.sort((left, right) => {
    if (left.entry.score !== right.entry.score) {
      return right.entry.score - left.entry.score;
    }
    if (left.source !== right.source) {
      return left.source === "workspace" ? -1 : 1;
    }
    if (left.entry.kind !== right.entry.kind) {
      return left.entry.kind === "directory" ? -1 : 1;
    }
    if (left.sourceOrder !== right.sourceOrder) {
      return left.sourceOrder - right.sourceOrder;
    }
    return left.entry.path.localeCompare(right.entry.path);
  });
  return ranked.slice(0, args.limit).map(({ source, entry }) => {
    const mentionPath =
      entry.kind === "directory" && !entry.path.endsWith("/")
        ? `${entry.path}/`
        : entry.path;
    return {
      kind: "path",
      source,
      entryKind: entry.kind,
      path: entry.path,
      name: entry.name,
      replacement:
        source === "thread-storage"
          ? `thread-storage:${mentionPath}`
          : mentionPath,
    };
  });
}

// --- Plugin mention providers -------------------------------------------------

export interface PluginMentionSearchItem {
  itemId: string;
  title: string;
  subtitle: string | null;
  icon: string | null;
}

export interface PluginMentionSearchGroup {
  pluginId: string;
  providerId: string;
  label: string;
  items: PluginMentionSearchItem[];
}

export function buildPluginMentionSuggestions(
  groups: readonly PluginMentionSearchGroup[],
): PromptMentionSuggestion[] {
  const suggestions: PromptMentionSuggestion[] = [];
  for (const group of groups) {
    for (const item of group.items) {
      const title = item.title.trim();
      if (title.length === 0) continue;
      suggestions.push({
        kind: "plugin",
        pluginId: group.pluginId,
        providerId: group.providerId,
        itemId: item.itemId,
        providerLabel: group.label,
        title,
        subtitle: item.subtitle,
        icon: item.icon,
        replacement: title,
      });
    }
  }
  return suggestions;
}

export function buildPluginMentionTriggers(
  providers: readonly { triggers: readonly PluginMentionTrigger[] }[],
): PluginMentionTrigger[] {
  const enabled = new Set<PluginMentionTrigger>([
    DEFAULT_PLUGIN_MENTION_TRIGGER,
  ]);
  for (const provider of providers) {
    for (const trigger of provider.triggers) enabled.add(trigger);
  }
  return PLUGIN_MENTION_TRIGGER_VALUES.filter((trigger) =>
    enabled.has(trigger),
  );
}

// --- Merge -------------------------------------------------------------------

/**
 * Menu order: a query containing "/" reads as a path, so paths lead;
 * otherwise threads, projects, sections, then paths. Plugin rows always trail.
 */
export function mergeMentionSuggestions(args: {
  query: string;
  threads: readonly PromptMentionSuggestion[];
  projects: readonly PromptMentionSuggestion[];
  sections: readonly PromptMentionSuggestion[];
  paths: readonly PromptMentionSuggestion[];
  plugins: readonly PromptMentionSuggestion[];
}): PromptMentionSuggestion[] {
  return args.query.trim().includes("/")
    ? [
        ...args.paths,
        ...args.threads,
        ...args.projects,
        ...args.sections,
        ...args.plugins,
      ]
    : [
        ...args.threads,
        ...args.projects,
        ...args.sections,
        ...args.paths,
        ...args.plugins,
      ];
}

// --- Commands ----------------------------------------------------------------

export interface CommandPromptAction {
  command?: {
    trigger: PromptMentionCommandTrigger;
    name: string;
    trailingText: string;
  };
}

function commandMatchesQuery(
  suggestion: ProviderCommandSuggestion,
  normalizedQuery: string,
): boolean {
  if (normalizedQuery.length === 0) return true;
  return [
    suggestion.name,
    suggestion.description ?? "",
    suggestion.argumentHint ?? "",
  ]
    .join(" ")
    .toLowerCase()
    .includes(normalizedQuery);
}

/**
 * The slash menu rows for a query: the provider's prompt-action commands
 * (plan / goal) first, then the discovered catalog filtered by the query
 * (the new-thread composer hides the builtin `/compact`), deduplicated by
 * source + name and ranked like the web (`orderCommandSuggestions`).
 */
export function buildCommandSuggestions(args: {
  commands: readonly ProviderCommand[];
  promptActions: readonly CommandPromptAction[];
  trigger: PromptMentionCommandTrigger;
  scope: "new-thread" | "thread";
  query: string;
}): ProviderCommandSuggestion[] {
  const normalizedQuery = args.query.trim().toLowerCase();
  const actionRows = args.promptActions.flatMap(
    (action): ProviderCommandSuggestion[] => {
      if (!action.command || action.command.trigger !== args.trigger) return [];
      return [
        {
          kind: "command",
          name: action.command.name,
          source: "command",
          origin: "user",
          description: null,
          argumentHint: null,
        },
      ];
    },
  );
  const discovered = args.commands
    .map(toProviderCommandSuggestion)
    .filter(
      (suggestion) =>
        args.scope === "thread" ||
        suggestion.source !== "command" ||
        suggestion.origin !== "builtin" ||
        suggestion.name !== "compact",
    );
  const merged: ProviderCommandSuggestion[] = [];
  const seen = new Set<string>();
  for (const suggestion of [...actionRows, ...discovered]) {
    if (!commandMatchesQuery(suggestion, normalizedQuery)) continue;
    const key = `${suggestion.source}:${suggestion.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(suggestion);
  }
  return orderCommandSuggestions(merged, args.query);
}
