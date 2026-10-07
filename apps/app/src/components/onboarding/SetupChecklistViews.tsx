import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import type { OnboardingStepId } from "./onboarding-model";

export interface SetupChecklistItem {
  id: OnboardingStepId;
  title: string;
  detail: string;
  done: boolean;
  actionLabel: string;
}

interface SetupChecklistProps {
  items: readonly SetupChecklistItem[];
  onOpen: (id: OnboardingStepId) => void;
  onDismiss: () => void;
}

export function SetupChecklist({
  items,
  onOpen,
  onDismiss,
}: SetupChecklistProps) {
  const doneCount = items.filter((item) => item.done).length;
  return (
    <section
      aria-label="Finish setting up bb"
      className="w-full max-w-[420px] rounded-lg border border-border text-left"
    >
      <header className="flex items-center gap-2 px-3 py-2.5">
        <span className="flex-1 text-sm font-medium">Finish setting up bb</span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {doneCount} of {items.length}
        </span>
        <button
          type="button"
          aria-label="Dismiss setup checklist"
          onClick={onDismiss}
          className="rounded-sm text-muted-foreground hover:text-foreground"
        >
          <Icon name="X" aria-hidden className="size-4" />
        </button>
      </header>
      <ul className="divide-y divide-border-hairline border-t border-border-hairline">
        {items.map((item) => (
          <li key={item.id} className="flex items-center gap-3 px-3 py-2.5">
            {item.done ? (
              <Icon
                name="CircleCheck"
                aria-hidden
                className="size-4 shrink-0 text-success"
              />
            ) : (
              <span className="size-4 shrink-0 rounded-full border border-border" />
            )}
            <span className="flex min-w-0 flex-1 flex-col">
              <span
                className={cn(
                  "text-sm",
                  item.done
                    ? "text-muted-foreground line-through"
                    : "font-medium",
                )}
              >
                {item.title}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {item.detail}
              </span>
            </span>
            {item.done ? null : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onOpen(item.id)}
              >
                {item.actionLabel}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function NoAgentNotice({ onSetUp }: { onSetUp: () => void }) {
  return (
    <div
      role="alert"
      className="flex w-full max-w-[420px] items-center gap-3 rounded-lg border border-surface-attention bg-surface-attention px-3 py-2.5 text-left"
    >
      <Icon
        name="AlertTriangle"
        aria-hidden
        className="size-4 shrink-0 text-attention"
      />
      <span className="min-w-0 flex-1 text-xs">
        No agent is ready on this computer, so threads can't start yet.
      </span>
      <Button size="sm" onClick={onSetUp}>
        Connect an agent
      </Button>
    </div>
  );
}
