import { useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  experimental_useComposerContributions as useComposerContributions,
  type ExperimentalComposerContributions,
  type ExperimentalComposerMenuSelection,
  type ExperimentalComposerPromptAction as PromptBoxAction,
} from "@get-bb/plugin-sdk/app";
import { Icon, type IconName } from "@/components/ui/icon";
import { COARSE_POINTER_PROMPT_ICON_ACTION_BUTTON_CLASS } from "@/components/ui/coarse-pointer-sizing";
import { CHROME_SUBTLE_ICON_BUTTON_FOREGROUND_CLASS } from "@/components/ui/chrome-style-tokens";

type PromptBoxActionKind = PromptBoxAction["kind"];

interface PromptBoxActionsMenuProps {
  actions?: readonly PromptBoxAction[];
  onAttach?: () => void;
  onAction: (action: PromptBoxAction) => void;
  plugins?: Pick<
    ExperimentalComposerContributions,
    "plusMenuItems" | "MenuEntry"
  >;
}

export function ComposerPlusMenuSlot(
  props: Omit<PromptBoxActionsMenuProps, "plugins">,
) {
  const plugins = useComposerContributions();
  return <PromptBoxActionsMenu {...props} plugins={plugins} />;
}

const PROMPT_ACTION_PRESENTATION = {
  skills: {
    label: "Skills",
    icon: "Zap",
  },
  plan: {
    label: "Plan",
    icon: "ListTodo",
  },
  goal: {
    label: "Goal",
    icon: "Target",
  },
} as const satisfies Record<
  PromptBoxActionKind,
  { label: string; icon: IconName }
>;

const PROMPT_ACTION_ORDER: readonly PromptBoxActionKind[] = [
  "skills",
  "plan",
  "goal",
];

function orderedPromptActions(
  actions: readonly PromptBoxAction[],
): PromptBoxAction[] {
  return PROMPT_ACTION_ORDER.flatMap((kind) => {
    const action = actions.find((candidate) => candidate.kind === kind);
    return action ? [action] : [];
  });
}

export function PromptBoxActionsMenu({
  actions = [],
  onAttach,
  onAction,
  plugins,
}: PromptBoxActionsMenuProps) {
  const pluginItems = plugins?.plusMenuItems ?? [];
  const selectedItemRef = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const pluginSelectionRef = useRef<ExperimentalComposerMenuSelection | null>(
    null,
  );
  const visibleActions = orderedPromptActions(actions).filter(
    (action) => action.text.length > 0,
  );
  const clearSelectedActionAfterClose = useCallback(() => {
    const clear = () => {
      selectedItemRef.current = false;
      pluginSelectionRef.current = null;
    };
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(clear);
      return;
    }
    setTimeout(clear, 0);
  }, []);
  const restorePluginComposerFocus = useCallback(
    (selection: ExperimentalComposerMenuSelection) => {
      const activeElement = document.activeElement;
      const pluginMovedFocus =
        activeElement !== null &&
        activeElement !== document.body &&
        activeElement !== triggerRef.current &&
        activeElement !== selection.selectedElement &&
        activeElement.isConnected;
      if (!pluginMovedFocus) {
        selection.restoreComposerFocus();
      }
    },
    [],
  );

  if (visibleActions.length === 0 && !onAttach && pluginItems.length === 0) {
    return null;
  }

  return (
    <DropdownMenu
      modal={false}
      onOpenChange={(open) => {
        if (!open) {
          clearSelectedActionAfterClose();
        }
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          ref={triggerRef}
          type="button"
          size="icon"
          variant="ghost"
          aria-label="Prompt actions"
          className={cn(
            COARSE_POINTER_PROMPT_ICON_ACTION_BUTTON_CLASS,
            CHROME_SUBTLE_ICON_BUTTON_FOREGROUND_CLASS,
            "-ml-1.5",
          )}
        >
          <Icon name="Plus" className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        aria-label="Prompt actions"
        align="start"
        side="bottom"
        sideOffset={4}
        className="w-36"
        mobileTitle="Prompt actions"
        onCloseAutoFocus={(event) => {
          if (selectedItemRef.current) {
            event.preventDefault();
            const pluginSelection = pluginSelectionRef.current;
            if (pluginSelection) {
              restorePluginComposerFocus(pluginSelection);
            }
          }
        }}
      >
        {onAttach ? (
          <>
            <DropdownMenuItem
              onSelect={() => {
                selectedItemRef.current = true;
                onAttach();
              }}
            >
              <Icon
                name="Paperclip"
                className="size-4 text-muted-foreground"
                aria-hidden
              />
              Attach files
            </DropdownMenuItem>
            {visibleActions.length > 0 ? <DropdownMenuSeparator /> : null}
          </>
        ) : null}
        {visibleActions.map((action) => {
          const presentation = PROMPT_ACTION_PRESENTATION[action.kind];
          return (
            <DropdownMenuItem
              key={action.kind}
              onSelect={() => {
                selectedItemRef.current = true;
                onAction(action);
              }}
            >
              <Icon
                name={presentation.icon}
                className="size-4 text-muted-foreground"
                aria-hidden
              />
              {presentation.label}
            </DropdownMenuItem>
          );
        })}
        {plugins?.plusMenuItems.map((contribution) => (
          <plugins.MenuEntry
            key={contribution.key}
            kind="plus"
            contribution={contribution}
            onSelected={(selection) => {
              selectedItemRef.current = true;
              pluginSelectionRef.current = selection;
              queueMicrotask(() => restorePluginComposerFocus(selection));
            }}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
