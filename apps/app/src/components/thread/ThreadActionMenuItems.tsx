import type {
  PluginBoundThreadAction,
  PluginThreadActionsInlineItem,
  PluginThreadActionTarget,
} from "@get-bb/plugin-sdk";
import { Fragment } from "react";
import {
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@bb/shared-ui/context-menu";
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { Icon } from "@bb/shared-ui/icon";
import {
  ActionMenuItem,
  ActionMenuSeparator,
} from "@bb/shared-ui/action-menu-items";
import {
  bindThreadAction,
  useDefaultRequestRename,
  useThreadActionEntries,
} from "@/lib/thread-actions/thread-action-registry";

export type ThreadActionMenuSurface = "context" | "dropdown";

export interface ThreadActionMenuEntry {
  key: string;
  group: string;
  action: PluginBoundThreadAction;
}

const CHOICES_CONTENT_CLASS =
  "max-h-[min(24rem,calc(100vh-2rem))] min-w-44 overflow-y-auto";

export function groupThreadActionMenuEntries(
  entries: readonly ThreadActionMenuEntry[],
  inline: readonly ThreadActionMenuEntry[],
): ThreadActionMenuEntry[][] {
  const groups = new Map<string, ThreadActionMenuEntry[]>();
  for (const entry of [...entries, ...inline]) {
    const group = groups.get(entry.group);
    if (group === undefined) groups.set(entry.group, [entry]);
    else group.push(entry);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([, group]) => group);
}

export function useThreadActionMenuGroups({
  thread,
  inline = [],
  requestRename,
}: {
  thread: PluginThreadActionTarget;
  inline?: readonly PluginThreadActionsInlineItem[];
  requestRename?: (threadId: string) => void;
}): ThreadActionMenuEntry[][] {
  const defaultRequestRename = useDefaultRequestRename();
  const rename = requestRename ?? defaultRequestRename;
  const entries = useThreadActionEntries(thread, { requestRename: rename });
  return groupThreadActionMenuEntries(
    entries,
    inline.map((item) => ({
      key: item.key,
      group: item.group,
      action: bindThreadAction(item.key, item.action, rename),
    })),
  );
}

function ThreadActionChoiceRows({
  entry,
  surface,
}: {
  entry: ThreadActionMenuEntry;
  surface: ThreadActionMenuSurface;
}) {
  const choices = entry.action.choices;
  if (choices === undefined) return null;
  const Item = surface === "context" ? ContextMenuItem : DropdownMenuItem;
  return choices.items.map((choice) => (
    <Item
      key={choice.id}
      aria-current={choice.selected ? "true" : undefined}
      className="flex items-center justify-between gap-3"
      disabled={choice.disabled}
      onSelect={() => {
        void entry.action.run(choice.id);
      }}
    >
      {choice.icon !== undefined ? (
        <Icon name={choice.icon} aria-hidden="true" />
      ) : null}
      <span className="min-w-0 flex-1 truncate">{choice.label}</span>
      {choice.selected ? (
        <Icon name="Check" className="ml-auto" aria-hidden="true" />
      ) : null}
    </Item>
  ));
}

function ThreadActionChoicesHint({
  entry,
  surface,
}: {
  entry: ThreadActionMenuEntry;
  surface: ThreadActionMenuSurface;
}) {
  const hint = entry.action.choices?.hint;
  if (hint === undefined) return null;
  return (
    <>
      <ActionMenuSeparator surface={surface} />
      <div className="max-w-56 px-2 py-1 text-xs text-muted-foreground">
        {hint}
      </div>
    </>
  );
}

function ThreadActionLabel({ action }: { action: PluginBoundThreadAction }) {
  if (action.detail === undefined) return action.label;
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="truncate">{action.label}</span>
      <span className="truncate text-2xs text-muted-foreground">
        {action.detail}
      </span>
    </span>
  );
}

function ThreadActionMenuRow({
  entry,
  surface,
  isDrawer,
  onOpenDrawerStep,
}: {
  entry: ThreadActionMenuEntry;
  surface: ThreadActionMenuSurface;
  isDrawer: boolean;
  onOpenDrawerStep: (key: string) => void;
}) {
  const { action } = entry;
  if (action.choices === undefined) {
    return (
      <ActionMenuItem
        surface={surface}
        icon={action.icon}
        variant={action.variant}
        disabled={action.disabled}
        onSelect={() => {
          void action.run();
        }}
      >
        <ThreadActionLabel action={action} />
      </ActionMenuItem>
    );
  }
  if (isDrawer) {
    return (
      <DropdownMenuItem
        disabled={action.disabled}
        onSelect={(event) => {
          event.preventDefault();
          onOpenDrawerStep(entry.key);
        }}
      >
        <Icon name={action.icon} aria-hidden="true" />
        {action.detail === undefined ? (
          <span className="min-w-0 flex-1 truncate">{action.label}</span>
        ) : (
          <ThreadActionLabel action={action} />
        )}
        <Icon name="ChevronRight" className="ml-auto" aria-hidden="true" />
      </DropdownMenuItem>
    );
  }
  const Sub = surface === "context" ? ContextMenuSub : DropdownMenuSub;
  const SubTrigger =
    surface === "context" ? ContextMenuSubTrigger : DropdownMenuSubTrigger;
  const SubContent =
    surface === "context" ? ContextMenuSubContent : DropdownMenuSubContent;
  return (
    <Sub>
      <SubTrigger disabled={action.disabled}>
        <Icon name={action.icon} aria-hidden="true" />
        <ThreadActionLabel action={action} />
      </SubTrigger>
      <SubContent className={CHOICES_CONTENT_CLASS}>
        <ThreadActionChoiceRows entry={entry} surface={surface} />
        <ThreadActionChoicesHint entry={entry} surface={surface} />
      </SubContent>
    </Sub>
  );
}

function ThreadActionDrawerStep({
  entry,
  onBack,
}: {
  entry: ThreadActionMenuEntry;
  onBack: () => void;
}) {
  return (
    <>
      <DropdownMenuItem
        onSelect={(event) => {
          event.preventDefault();
          onBack();
        }}
      >
        <Icon name="ChevronLeft" aria-hidden="true" />
        Back
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuLabel>
        {entry.action.choices?.heading ?? entry.action.label}
      </DropdownMenuLabel>
      <ThreadActionChoiceRows entry={entry} surface="dropdown" />
      <ThreadActionChoicesHint entry={entry} surface="dropdown" />
    </>
  );
}

export function ThreadActionMenuRows({
  groups,
  surface,
  isDrawer,
  drawerStep,
  onDrawerStepChange,
}: {
  groups: readonly ThreadActionMenuEntry[][];
  surface: ThreadActionMenuSurface;
  isDrawer: boolean;
  drawerStep: string | null;
  onDrawerStepChange: (key: string | null) => void;
}) {
  const stepEntry =
    isDrawer && drawerStep !== null
      ? groups.flat().find((entry) => entry.key === drawerStep)
      : undefined;
  if (stepEntry !== undefined && stepEntry.action.choices !== undefined) {
    return (
      <ThreadActionDrawerStep
        entry={stepEntry}
        onBack={() => onDrawerStepChange(null)}
      />
    );
  }
  return groups.map((group, index) => (
    <Fragment key={group[0]?.group ?? index}>
      {index > 0 && !isDrawer ? (
        <ActionMenuSeparator surface={surface} />
      ) : null}
      {group.map((entry) => (
        <ThreadActionMenuRow
          key={entry.key}
          entry={entry}
          surface={surface}
          isDrawer={isDrawer}
          onOpenDrawerStep={onDrawerStepChange}
        />
      ))}
    </Fragment>
  ));
}
