import type { SetupChecklistItemId } from "@bb/server-contract";
import { Button } from "@bb/shared-ui/button";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";

export interface SetupChecklistItem {
  id: SetupChecklistItemId;
  title: string;
  detail: string;
  done: boolean;
  optional: boolean;
  actionLabel: string;
}

interface SetupChecklistProps {
  items: readonly SetupChecklistItem[];
  onAction: (id: SetupChecklistItemId) => void;
  onDismiss: () => void;
}

const OPTIONAL_ITEM_ICONS: Partial<Record<SetupChecklistItemId, IconName>> = {
  plugins: "Puzzle",
  devices: "Smartphone",
  notifications: "BellDot",
};

function RequiredRow({
  item,
  next,
  onAction,
}: {
  item: SetupChecklistItem;
  next: boolean;
  onAction: (id: SetupChecklistItemId) => void;
}) {
  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
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
            item.done ? "text-muted-foreground line-through" : "font-medium",
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
          variant={next ? "default" : "outline"}
          onClick={() => onAction(item.id)}
        >
          {item.actionLabel}
        </Button>
      )}
    </li>
  );
}

function OptionalRow({
  item,
  onAction,
}: {
  item: SetupChecklistItem;
  onAction: (id: SetupChecklistItemId) => void;
}) {
  return (
    <li className="flex items-center gap-3 px-3 py-2">
      <Icon
        name={
          item.done ? "CircleCheck" : (OPTIONAL_ITEM_ICONS[item.id] ?? "Plus")
        }
        aria-hidden
        className={cn(
          "size-4 shrink-0",
          item.done ? "text-success" : "text-subtle-foreground",
        )}
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span
          className={cn(
            "text-sm",
            item.done ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {item.title}
        </span>
        <span className="text-xs text-muted-foreground">{item.detail}</span>
      </span>
      {item.done ? null : (
        <Button size="sm" variant="ghost" onClick={() => onAction(item.id)}>
          {item.actionLabel}
        </Button>
      )}
    </li>
  );
}

export function SetupChecklist({
  items,
  onAction,
  onDismiss,
}: SetupChecklistProps) {
  const required = items.filter((item) => !item.optional);
  const optional = items.filter((item) => item.optional);
  const doneCount = required.filter((item) => item.done).length;
  const nextId = required.find((item) => !item.done)?.id ?? null;
  return (
    <section
      aria-label="Finish setting up bb"
      className="flex w-full max-w-[440px] flex-col gap-2 text-left"
    >
      <header className="flex items-center gap-2 px-1">
        <span className="flex-1 text-sm font-medium">Finish setting up bb</span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {doneCount} of {required.length}
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
      <ul className="divide-y divide-border-hairline rounded-lg border border-border">
        {required.map((item) => (
          <RequiredRow
            key={item.id}
            item={item}
            next={item.id === nextId}
            onAction={onAction}
          />
        ))}
      </ul>
      {optional.length === 0 ? null : (
        <>
          <p className="px-1 pt-4 text-xs text-muted-foreground">
            Optional extras
          </p>
          <ul aria-label="Optional extras" className="flex flex-col">
            {optional.map((item) => (
              <OptionalRow key={item.id} item={item} onAction={onAction} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

export function NoAgentNotice({ onSetUp }: { onSetUp: () => void }) {
  return (
    <div
      role="alert"
      className="flex w-full max-w-[440px] items-center gap-3 rounded-lg border border-surface-attention bg-surface-attention px-3 py-2.5 text-left"
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
