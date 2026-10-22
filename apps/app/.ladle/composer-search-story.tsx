import { createContext, useContext, useState, type ReactNode } from "react";
import type {
  ExperimentalComposerCommandSearch,
  ExperimentalComposerCommandTrigger,
  ExperimentalComposerMentionSearch,
  ExperimentalComposerSearchQuery,
  PluginMentionTrigger,
} from "@get-bb/plugin-sdk";
import { pluginSdkAppImplementation } from "../src/lib/plugin-sdk-app-impl";

interface StoryComposerSearch {
  mention?(
    query: ExperimentalComposerSearchQuery<PluginMentionTrigger> | null,
  ): Omit<ExperimentalComposerMentionSearch, "search">;
  command?(
    query: ExperimentalComposerSearchQuery<ExperimentalComposerCommandTrigger> | null,
  ): Omit<ExperimentalComposerCommandSearch, "search">;
}

const StoryComposerSearchContext = createContext<StoryComposerSearch>({});

export function StoryComposerSearchProvider({
  children,
  ...search
}: StoryComposerSearch & { children: ReactNode }) {
  return (
    <StoryComposerSearchContext.Provider value={search}>
      {children}
    </StoryComposerSearchContext.Provider>
  );
}

export function useStoryComposerMentionSearch(): ExperimentalComposerMentionSearch {
  const story = useContext(StoryComposerSearchContext);
  const live =
    pluginSdkAppImplementation.experimental_useComposerMentionSearch();
  const [query, setQuery] =
    useState<ExperimentalComposerSearchQuery<PluginMentionTrigger> | null>(
      null,
    );
  if (story.mention === undefined) return live;
  return { ...story.mention(query), search: setQuery };
}

export function useStoryComposerCommandSearch(): ExperimentalComposerCommandSearch {
  const story = useContext(StoryComposerSearchContext);
  const live =
    pluginSdkAppImplementation.experimental_useComposerCommandSearch();
  const [query, setQuery] =
    useState<ExperimentalComposerSearchQuery<ExperimentalComposerCommandTrigger> | null>(
      null,
    );
  if (story.command === undefined) return live;
  return { ...story.command(query), search: setQuery };
}
