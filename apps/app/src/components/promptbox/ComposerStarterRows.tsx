import { useCallback, useMemo } from "react";
import type { SidebarBootstrapResponse } from "@bb/server-contract";
import { CHROME_SECTION_LABEL_CLASS } from "@bb/shared-ui/chrome-style-tokens";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { listSidebarNavigationThreads } from "@/hooks/cache-owners/query-cache";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import {
  usePromptDraftInputEmpty,
  type PromptDraftController,
} from "@/hooks/usePromptDraftStorage";
import { createCoreComposerActions } from "@/lib/plugin-composer-handle";

export interface ComposerStarter {
  id: string;
  label: string;
  prompt: string;
}

export const COMPOSER_STARTER_ROWS_HEADING = "Try asking";

export const COMPOSER_STARTERS: readonly ComposerStarter[] = [
  {
    id: "explain-codebase",
    label: "Explain this codebase",
    prompt:
      "Give me a short tour of this codebase: what it does, how it's organized, and where to start.",
  },
  {
    id: "fix-todo",
    label: "Fix a small TODO",
    prompt:
      "Find one TODO or FIXME in this project that's safe to fix, fix it, and explain the change.",
  },
  {
    id: "add-test",
    label: "Add a missing test",
    prompt:
      "Find an important function in this project that has no test, and add a focused test for it.",
  },
];

export function composerStarterAccessibleName(starter: ComposerStarter) {
  return `Fill the message box: ${starter.label}`;
}

interface ComposerStarterRowsUIProps {
  onSelect: (starter: ComposerStarter) => void;
  className?: string;
}

export function ComposerStarterRowsUI({
  onSelect,
  className,
}: ComposerStarterRowsUIProps) {
  return (
    <section
      aria-labelledby="composer-starter-rows-heading"
      data-composer-starter-rows=""
      className={cn("flex flex-col gap-0.5 px-1.5", className)}
    >
      <h2
        id="composer-starter-rows-heading"
        className={cn(CHROME_SECTION_LABEL_CLASS, "px-2")}
      >
        {COMPOSER_STARTER_ROWS_HEADING}
      </h2>
      <ul className="flex flex-col gap-0.5">
        {COMPOSER_STARTERS.map((starter) => (
          <li key={starter.id}>
            <button
              type="button"
              aria-label={composerStarterAccessibleName(starter)}
              onClick={() => onSelect(starter)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground active:bg-state-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <Icon
                name="CornerDownRight"
                className="size-3.5 shrink-0 text-subtle-foreground"
                aria-hidden
              />
              <span className="min-w-0 truncate">{starter.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

interface ComposerStarterRowsProps {
  promptDraft: PromptDraftController;
  focus: () => void;
  isProjectless: boolean;
  sidebarNavigation: SidebarBootstrapResponse | undefined;
  className?: string;
}

export function ComposerStarterRows({
  promptDraft,
  focus,
  isProjectless,
  sidebarNavigation,
  className,
}: ComposerStarterRowsProps) {
  const enabled =
    useSystemConfig().data?.featureFlags.composerStarterRows === true;
  const inputEmpty = usePromptDraftInputEmpty(promptDraft);
  const hasNoThreads =
    sidebarNavigation !== undefined &&
    listSidebarNavigationThreads(sidebarNavigation).length === 0;
  const composerActions = useMemo(
    () => createCoreComposerActions({ ...promptDraft, focus }),
    [focus, promptDraft],
  );
  const handleSelect = useCallback(
    (starter: ComposerStarter) => {
      composerActions.replace({ text: starter.prompt, mentions: [] });
      composerActions.focus();
    },
    [composerActions],
  );
  if (!enabled || isProjectless || !inputEmpty || !hasNoThreads) {
    return null;
  }
  return (
    <ComposerStarterRowsUI onSelect={handleSelect} className={className} />
  );
}
