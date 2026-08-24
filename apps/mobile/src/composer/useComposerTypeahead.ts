import {
  DEFAULT_PLUGIN_MENTION_TRIGGER,
  type ActiveTrigger,
  type PluginMentionTrigger,
  type PromptMentionSuggestion,
  type ProviderCommandSuggestion,
  type TypeaheadTrigger,
} from "@bb/client-core";
import {
  PERSONAL_PROJECT_ID,
  type PromptMentionCommandTrigger,
} from "@bb/domain";
import { useEffect, useMemo, useState } from "react";
import {
  useEnvironmentPaths,
  usePluginContributions,
  usePluginMentionSearch,
  useProjectCommands,
  useThreadStoragePaths,
} from "@/data/composer";
import { useProjectPaths } from "@/data/projects";
import { useSidebarBootstrap } from "@/data/sidebar";
import { useThreadsList } from "@/data/threads";
import {
  buildCommandSuggestions,
  buildPathMentionSuggestions,
  buildPluginMentionSuggestions,
  buildPluginMentionTriggers,
  buildProjectMentionSuggestions,
  buildSectionMentionSuggestions,
  buildThreadMentionSuggestions,
  buildTypeaheadTriggers,
  findActiveComposerTrigger,
  mergeMentionSuggestions,
  PROMPT_MENTION_SOURCE_LIMIT,
  type CommandPromptAction,
  type ComposerValue,
  type TextSelection,
} from "./model";

/**
 * Where a composer lives: which project/thread/environment scope its
 * suggestions search and which provider owns the slash-command trigger.
 */
export interface ComposerScope {
  projectId: string | null;
  /** Existing thread (follow-up composer); null on the new-thread screen. */
  threadId?: string | null;
  /** Workspace whose files the `@` menu searches; falls back to the project source. */
  environmentId?: string | null;
  hostId?: string | null;
  providerId?: string | null;
}

export type TypeaheadMenuModel =
  | {
      kind: "mention";
      trigger: ActiveTrigger;
      state: "hint" | "loading" | "error" | "results";
      suggestions: readonly PromptMentionSuggestion[];
    }
  | {
      kind: "command";
      trigger: ActiveTrigger;
      state: "loading" | "error" | "results";
      suggestions: readonly ProviderCommandSuggestion[];
    };

export interface UseComposerTypeaheadArgs {
  scope: ComposerScope;
  value: ComposerValue;
  selection: TextSelection;
  /** False while the input is blurred or a trigger was dismissed: no menu. */
  active: boolean;
  skillsTrigger: PromptMentionCommandTrigger | null;
  promptActions: readonly CommandPromptAction[];
}

export interface UseComposerTypeaheadResult {
  triggers: TypeaheadTrigger[];
  activeTrigger: ActiveTrigger | null;
  menu: TypeaheadMenuModel | null;
}

const PATH_SUGGESTION_DEBOUNCE_MS = 120;
const THREAD_MENTION_CANDIDATE_LIMIT = 200;

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    if (Object.is(debounced, value)) return;
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [debounced, delayMs, value]);
  return debounced;
}

/**
 * Data behind the typeahead popover for the trigger under the caret (port of
 * the web's `usePromptMentions` + `useCommandSuggestions`): `@` searches
 * threads, projects, sections, workspace + thread-storage paths, and plugin
 * mention providers; other plugin triggers search only their providers; the
 * provider's command trigger lists skills/commands (query filters locally).
 */
export function useComposerTypeahead({
  scope,
  value,
  selection,
  active,
  skillsTrigger,
  promptActions,
}: UseComposerTypeaheadArgs): UseComposerTypeaheadResult {
  const contributions = usePluginContributions();
  const mentionProviders = contributions.data?.mentionProviders;
  const mentionTriggers = useMemo(
    () => buildPluginMentionTriggers(mentionProviders ?? []),
    [mentionProviders],
  );
  const triggers = useMemo(
    () =>
      buildTypeaheadTriggers({
        mentionTriggers,
        commandTrigger: skillsTrigger,
      }),
    [mentionTriggers, skillsTrigger],
  );

  const activeTrigger = useMemo(
    () =>
      active ? findActiveComposerTrigger(value, selection, triggers) : null,
    [active, selection, triggers, value],
  );

  const mention = activeTrigger?.kind === "mention" ? activeTrigger : null;
  const command = activeTrigger?.kind === "command" ? activeTrigger : null;
  const mentionTrigger: PluginMentionTrigger =
    mention?.char ?? DEFAULT_PLUGIN_MENTION_TRIGGER;
  const includeBuiltIn =
    mention !== null && mentionTrigger === DEFAULT_PLUGIN_MENTION_TRIGGER;
  const trimmedQuery = mention?.query.trim() ?? "";
  const hasQuery = mention !== null && trimmedQuery.length > 0;
  const debouncedQuery = useDebouncedValue(
    trimmedQuery,
    PATH_SUGGESTION_DEBOUNCE_MS,
  );
  const isDebouncing = hasQuery && debouncedQuery !== trimmedQuery;
  const projectId = scope.projectId;
  const threadId = scope.threadId ?? null;
  const environmentId = scope.environmentId ?? null;
  const hostId = scope.hostId ?? null;

  // --- Built-in `@` sources -------------------------------------------------
  const sidebar = useSidebarBootstrap({ enabled: includeBuiltIn && hasQuery });
  const threads = useThreadsList(
    { archived: false, limit: THREAD_MENTION_CANDIDATE_LIMIT },
    { enabled: includeBuiltIn && hasQuery },
  );
  const workspaceSource: "environment" | "project" | "none" = environmentId
    ? "environment"
    : projectId && projectId !== PERSONAL_PROJECT_ID
      ? "project"
      : "none";
  const pathArgs = {
    query: includeBuiltIn && hasQuery ? debouncedQuery : null,
    limit: PROMPT_MENTION_SOURCE_LIMIT * 2,
    includeFiles: true,
    includeDirectories: true,
  };
  const environmentPaths = useEnvironmentPaths(
    workspaceSource === "environment" ? environmentId : null,
    pathArgs,
    { enabled: includeBuiltIn && hasQuery },
  );
  const projectPaths = useProjectPaths({
    projectId:
      workspaceSource === "project" ? (projectId ?? undefined) : undefined,
    hostId,
    query: includeBuiltIn && hasQuery ? debouncedQuery : null,
    limit: PROMPT_MENTION_SOURCE_LIMIT * 2,
  });
  const workspacePaths =
    workspaceSource === "environment" ? environmentPaths : projectPaths;
  const storagePaths = useThreadStoragePaths(threadId, pathArgs, {
    enabled: includeBuiltIn && hasQuery,
  });

  // --- Plugin mention providers -----------------------------------------------
  const hasMentionProviders =
    mentionProviders?.some((provider) =>
      provider.triggers.includes(mentionTrigger),
    ) ?? false;
  const pluginSearchMatchesInput = debouncedQuery === trimmedQuery;
  const pluginSearch = usePluginMentionSearch(
    {
      trigger: mentionTrigger,
      query: debouncedQuery,
      projectId,
      threadId,
    },
    {
      enabled:
        mention !== null &&
        hasMentionProviders &&
        pluginSearchMatchesInput &&
        debouncedQuery.length > 0,
    },
  );

  // --- Commands ---------------------------------------------------------------
  const commandActive =
    command !== null && projectId !== null && scope.providerId != null;
  const commandsQuery = useProjectCommands(
    {
      projectId,
      providerId: scope.providerId ?? null,
      environmentId,
      hostId,
    },
    { enabled: commandActive },
  );

  const menu = useMemo((): TypeaheadMenuModel | null => {
    if (command !== null) {
      if (!commandActive || skillsTrigger === null) return null;
      const suggestions = buildCommandSuggestions({
        commands: commandsQuery.data?.commands ?? [],
        promptActions,
        trigger: skillsTrigger,
        scope: threadId ? "thread" : "new-thread",
        query: command.query,
      });
      const state =
        suggestions.length === 0 &&
        commandsQuery.data === undefined &&
        (commandsQuery.isPending || commandsQuery.isFetching)
          ? "loading"
          : commandsQuery.isError && suggestions.length === 0
            ? "error"
            : "results";
      // A loaded-empty catalog never opens a menu (web parity).
      if (state === "results" && suggestions.length === 0) return null;
      return { kind: "command", trigger: command, state, suggestions };
    }
    if (mention === null) return null;
    if (!hasQuery) {
      return {
        kind: "mention",
        trigger: mention,
        state: "hint",
        suggestions: [],
      };
    }
    const projectNamesById = new Map<string, string>();
    const projectCandidates: { id: string; name: string }[] = [];
    const sectionCandidates: { id: string; name: string }[] = [];
    if (includeBuiltIn && sidebar.data) {
      for (const project of sidebar.data.projects) {
        projectNamesById.set(project.id, project.name);
        projectCandidates.push({ id: project.id, name: project.name });
      }
      projectCandidates.push({
        id: sidebar.data.personalProject.id,
        name: sidebar.data.personalProject.name,
      });
      for (const section of sidebar.data.sections) {
        sectionCandidates.push({ id: section.id, name: section.name });
      }
    }
    const suggestions = mergeMentionSuggestions({
      query: trimmedQuery,
      threads: includeBuiltIn
        ? buildThreadMentionSuggestions({
            threads: threads.data ?? [],
            query: trimmedQuery,
            currentProjectId: projectId ?? undefined,
            currentThreadId: threadId ?? undefined,
            projectNamesById,
            limit: PROMPT_MENTION_SOURCE_LIMIT,
          })
        : [],
      projects: includeBuiltIn
        ? buildProjectMentionSuggestions({
            projects: projectCandidates,
            query: trimmedQuery,
            limit: PROMPT_MENTION_SOURCE_LIMIT,
          })
        : [],
      sections: includeBuiltIn
        ? buildSectionMentionSuggestions({
            sections: sectionCandidates,
            query: trimmedQuery,
            limit: PROMPT_MENTION_SOURCE_LIMIT,
          })
        : [],
      paths: includeBuiltIn
        ? buildPathMentionSuggestions({
            workspacePaths:
              workspaceSource === "none"
                ? []
                : (workspacePaths.data?.paths ?? []),
            threadStoragePaths: threadId
              ? (storagePaths.data?.paths ?? [])
              : [],
            limit: PROMPT_MENTION_SOURCE_LIMIT,
          })
        : [],
      plugins:
        hasMentionProviders && pluginSearchMatchesInput
          ? buildPluginMentionSuggestions(pluginSearch.data ?? [])
          : [],
    });
    const builtInLoading =
      includeBuiltIn &&
      (isDebouncing ||
        (workspaceSource !== "none" &&
          (workspacePaths.isPending || workspacePaths.isFetching)) ||
        threads.isPending ||
        threads.isFetching);
    const pluginLoading =
      hasMentionProviders &&
      (!pluginSearchMatchesInput ||
        pluginSearch.isPending ||
        pluginSearch.isFetching);
    const isLoading =
      suggestions.length === 0 && (builtInLoading || pluginLoading);
    const isError =
      suggestions.length === 0 &&
      includeBuiltIn &&
      ((workspaceSource !== "none" && workspacePaths.isError) ||
        (threads.isError && !threads.isFetching));
    return {
      kind: "mention",
      trigger: mention,
      state: isLoading ? "loading" : isError ? "error" : "results",
      suggestions,
    };
  }, [
    command,
    commandActive,
    commandsQuery.data,
    commandsQuery.isError,
    commandsQuery.isFetching,
    commandsQuery.isPending,
    hasMentionProviders,
    hasQuery,
    includeBuiltIn,
    isDebouncing,
    mention,
    pluginSearch.data,
    pluginSearch.isFetching,
    pluginSearch.isPending,
    pluginSearchMatchesInput,
    projectId,
    promptActions,
    sidebar.data,
    skillsTrigger,
    storagePaths.data?.paths,
    threadId,
    threads.data,
    threads.isError,
    threads.isFetching,
    threads.isPending,
    trimmedQuery,
    workspacePaths.data?.paths,
    workspacePaths.isError,
    workspacePaths.isFetching,
    workspacePaths.isPending,
    workspaceSource,
  ]);

  return { triggers, activeTrigger, menu };
}
