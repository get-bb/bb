import { useCallback, useRef } from "react";
import { Button } from "@bb/shared-ui/button";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { COARSE_POINTER_PROMPT_ICON_ACTION_BUTTON_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import type { ProviderPromptActionCommand } from "./mentions/command-trigger";

export type PromptBoxActionKind = "skills" | "plan" | "goal" | "loop";

export interface PromptBoxAction {
  kind: PromptBoxActionKind;
  text: string;
  command?: ProviderPromptActionCommand;
  label?: string;
  disabled?: boolean;
}

interface PromptBoxActionsMenuProps {
  actions?: readonly PromptBoxAction[];
  onAction: (action: PromptBoxAction) => void;
}

export const LOOP_PROMPT_ACTION: PromptBoxAction = {
  kind: "loop",
  command: { trigger: "/", name: "loop", trailingText: " " },
  text: "/loop ",
};

const PROMPT_ACTION_ORDER: readonly PromptBoxActionKind[] = [
  "skills",
  "plan",
  "goal",
  "loop",
];

const PROMPT_ACTION_PRESENTATION = {
  skills: {
    label: "Skills",
    icon: "Explore",
  },
  plan: {
    label: "Plan",
    icon: "ListTodo",
  },
  goal: {
    label: "Goal",
    icon: "Target",
  },
  loop: {
    label: "Loop",
    icon: "Repeat",
  },
} as const satisfies Record<
  PromptBoxActionKind,
  { label: string; icon: IconName }
>;

export function withLoopPromptAction(
  actions: readonly PromptBoxAction[],
): PromptBoxAction[] {
  if (actions.some((action) => action.kind === "loop")) {
    return [...actions];
  }
  return [...actions, LOOP_PROMPT_ACTION];
}

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
  onAction,
}: PromptBoxActionsMenuProps) {
  const selectedActionRef = useRef(false);
  const visibleActions = orderedPromptActions(actions).filter(
    (action) => action.text.length > 0,
  );
  const clearSelectedActionAfterClose = useCallback(() => {
    const clear = () => {
      selectedActionRef.current = false;
    };
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(clear);
      return;
    }
    setTimeout(clear, 0);
  }, []);

  if (visibleActions.length === 0) {
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
          type="button"
          size="icon"
          variant="ghost"
          aria-label="Prompt actions"
          className={cn(
            COARSE_POINTER_PROMPT_ICON_ACTION_BUTTON_CLASS,
            // Outdent so the "+" glyph lines up with the placeholder/text
            // (toolbar px-3.5 + button px-2 sits 6px right of the editor's px-4).
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
          if (selectedActionRef.current) {
            event.preventDefault();
          }
        }}
      >
        {visibleActions.map((action) => {
          const presentation = PROMPT_ACTION_PRESENTATION[action.kind];
          return (
            <DropdownMenuItem
              key={action.kind}
              disabled={action.disabled}
              onSelect={() => {
                selectedActionRef.current = true;
                onAction(action);
              }}
            >
              <Icon
                name={presentation.icon}
                className="size-4 text-muted-foreground"
                aria-hidden
              />
              {action.label ?? presentation.label}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
