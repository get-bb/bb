import { useCallback, useMemo } from "react";
import type { SidebarBootstrapResponse } from "@bb/server-contract";
import { CHROME_SECTION_LABEL_CLASS } from "@bb/shared-ui/chrome-style-tokens";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { listSidebarNavigationThreads } from "@/hooks/cache-owners/query-cache";
import {
  usePromptDraftInputEmpty,
  type PromptDraftController,
} from "@/hooks/usePromptDraftStorage";
import { createCoreComposerActions } from "@/lib/plugin-composer-handle";

export interface ComposerStarter {
  id: string;
  label: string;
  prompt: string;
  needsProject: boolean;
}

export const COMPOSER_STARTER_ROWS_HEADING = "Try asking";

export const COMPOSER_STARTERS: readonly ComposerStarter[] = [
  {
    id: "make-bb-yours",
    label: "Make bb yours",
    prompt:
      "Help me make bb my own. Ask what I'd like to change, like how it looks or a panel or tool I'm missing, then build it as a theme or plugin and install it.",
    needsProject: false,
  },
  {
    id: "explain-codebase",
    label: "Explain this codebase",
    prompt:
      "Give me a short tour of this codebase: what it does, how it's organized, and where to start.",
    needsProject: true,
  },
  {
    id: "fix-todo",
    label: "Fix a small TODO",
    prompt:
      "Find one TODO or FIXME in this project that's safe to fix, fix it, and explain the change.",
    needsProject: true,
  },
];

export function composerStarterAccessibleName(starter: ComposerStarter) {
  return `Fill the message box: ${starter.label}`;
}

interface ComposerStarterRowsUIProps {
  starters: readonly ComposerStarter[];
  onSelect: (starter: ComposerStarter) => void;
  className?: string;
}

export function ComposerStarterRowsUI({
  starters,
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
        {starters.map((starter) => (
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
  isSubmitting: boolean;
  sidebarNavigation: SidebarBootstrapResponse | undefined;
  className?: string;
}

export function ComposerStarterRows({
  promptDraft,
  focus,
  isProjectless,
  isSubmitting,
  sidebarNavigation,
  className,
}: ComposerStarterRowsProps) {
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
  const starters = isProjectless
    ? COMPOSER_STARTERS.filter((starter) => !starter.needsProject)
    : COMPOSER_STARTERS;
  if (isSubmitting || !inputEmpty || !hasNoThreads) {
    return null;
  }
  return (
    <ComposerStarterRowsUI
      starters={starters}
      onSelect={handleSelect}
      className={className}
    />
  );
}
