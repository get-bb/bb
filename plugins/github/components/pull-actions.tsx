import { useCallback, useSyncExternalStore } from "react";
import {
  experimental_copyToClipboard,
  experimental_Icon as Icon,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
} from "@/components/ui/dropdown-menu";
import { pullStateActions, type PullStateName } from "../app-logic.js";
import type { PullStateTarget } from "../pull-status.js";
import type { githubRpcContract } from "../server.js";
import {
  nextMondayMorning,
  snoozeLabel,
  tomorrowMorning,
  type SnoozeRule,
} from "../snooze.js";
import { errorText, itemKey } from "./shared.js";

export type Activity =
  | { kind: "merging"; base: string }
  | { kind: "merged"; base: string }
  | {
      kind: "changing";
      from: PullStateName;
      target: PullStateTarget;
      label: string;
    }
  | { kind: "changed"; state: PullStateName; label: string };

const SETTLED_MARK_MS = 60_000;

let activities: ReadonlyMap<string, Activity> = new Map();
const activityListeners = new Set<() => void>();

export function setActivity(key: string, activity: Activity | null): void {
  const next = new Map(activities);
  if (activity === null) next.delete(key);
  else next.set(key, activity);
  activities = next;
  for (const listener of activityListeners) listener();
}

export function currentActivity(key: string): Activity | null {
  return activities.get(key) ?? null;
}

export function isInFlight(activity: Activity | null): boolean {
  return activity?.kind === "merging" || activity?.kind === "changing";
}

export function markSettled(key: string, activity: Activity): void {
  setActivity(key, activity);
  window.setTimeout(() => {
    if (activities.get(key) === activity) setActivity(key, null);
  }, SETTLED_MARK_MS);
}

export function settleActivity(key: string, state: PullStateName): void {
  const current = activities.get(key);
  if (
    (current?.kind === "changed" && current.state === state) ||
    (current?.kind === "merged" && state === "MERGED")
  ) {
    setActivity(key, null);
  }
}

function subscribeActivities(listener: () => void): () => void {
  activityListeners.add(listener);
  return () => activityListeners.delete(listener);
}

export function useActivities(): ReadonlyMap<string, Activity> {
  return useSyncExternalStore(
    subscribeActivities,
    () => activities,
    () => activities,
  );
}

export function activityLabel(activity: Activity): string {
  switch (activity.kind) {
    case "merging":
      return `Merging into ${activity.base}…`;
    case "merged":
      return `Merged into ${activity.base}`;
    case "changing":
    case "changed":
      return activity.label;
  }
}

export function MenuKey({ children }: { children: string }) {
  return (
    <DropdownMenuShortcut className="pointer-coarse:hidden">
      {children}
    </DropdownMenuShortcut>
  );
}

export interface StateSubject {
  repo: string;
  number: number;
  state: PullStateName;
}

const TARGET_STATE: Record<PullStateTarget, PullStateName> = {
  open: "OPEN",
  draft: "DRAFT",
  closed: "CLOSED",
};

const UNDO_TARGET: Record<PullStateName, PullStateTarget | null> = {
  OPEN: "open",
  DRAFT: "draft",
  CLOSED: "closed",
  MERGED: null,
};

function changingLabel(from: PullStateName, to: PullStateTarget): string {
  if (to === "closed") return "Closing…";
  if (from === "CLOSED") return "Reopening…";
  return to === "draft" ? "Converting to draft…" : "Marking ready…";
}

function changedLabel(from: PullStateName, to: PullStateTarget): string {
  if (to === "closed") return "Closed";
  if (from === "CLOSED") return "Reopened";
  return to === "draft" ? "Converted to draft" : "Marked ready";
}

function changedMessage(
  number: number,
  from: PullStateName,
  to: PullStateTarget,
): string {
  if (to === "closed") return `Closed #${number}`;
  if (from === "CLOSED") return `Reopened #${number}`;
  return to === "draft"
    ? `#${number} is a draft now`
    : `#${number} is ready for review`;
}

export function useChangePullState(): (
  subject: StateSubject,
  target: PullStateTarget,
) => Promise<boolean> {
  const rpc = useRpc<typeof githubRpcContract>();
  return useCallback(
    (subject: StateSubject, target: PullStateTarget) => {
      const run = (
        from: StateSubject,
        to: PullStateTarget,
        undoable: boolean,
      ): Promise<boolean> => {
        const key = itemKey(from);
        if (isInFlight(currentActivity(key))) return Promise.resolve(false);
        setActivity(key, {
          kind: "changing",
          from: from.state,
          target: to,
          label: changingLabel(from.state, to),
        });
        return rpc
          .call("setPullState", {
            repo: from.repo,
            number: from.number,
            state: to,
          })
          .then(
            () => {
              markSettled(key, {
                kind: "changed",
                state: TARGET_STATE[to],
                label: changedLabel(from.state, to),
              });
              const back = undoable ? UNDO_TARGET[from.state] : null;
              toast.success(changedMessage(from.number, from.state, to), {
                id: `github-state-${key}${undoable ? "" : "-undone"}`,
                ...(back === null
                  ? {}
                  : {
                      action: {
                        label: "Undo",
                        onClick: () =>
                          void run(
                            { ...from, state: TARGET_STATE[to] },
                            back,
                            false,
                          ),
                      },
                    }),
              });
              return true;
            },
            (error: unknown) => {
              setActivity(key, null);
              toast.error(`Couldn't update #${from.number}`, {
                id: `github-state-${key}`,
                description: errorText(error),
              });
              return false;
            },
          );
      };
      return run(subject, target, true);
    },
    [rpc],
  );
}

const TARGET_ICON: Record<PullStateTarget, string> = {
  open: "GitPullRequestArrow",
  draft: "GitPullRequestDraft",
  closed: "GitPullRequestClosed",
};

export function PullStateItems({
  state,
  isDraft,
  canUpdate,
  canClose,
  canReopen,
  onChange,
}: {
  state: PullStateName;
  isDraft: boolean;
  canUpdate: boolean;
  canClose: boolean;
  canReopen: boolean;
  onChange: (target: PullStateTarget) => void;
}) {
  const actions = pullStateActions({
    state,
    isDraft,
    viewerCanUpdate: canUpdate,
    viewerCanClose: canClose,
    viewerCanReopen: canReopen,
  });
  return (
    <>
      {actions.map((action) => (
        <DropdownMenuItem
          key={action.label}
          onSelect={() => onChange(action.target)}
        >
          <Icon
            name={
              state === "CLOSED"
                ? "GitPullRequestArrow"
                : TARGET_ICON[action.target]
            }
          />
          {action.label}
          {state === "DRAFT" && action.target === "open" ? (
            <MenuKey>R</MenuKey>
          ) : null}
        </DropdownMenuItem>
      ))}
    </>
  );
}

export interface SnoozeChoice {
  rule: SnoozeRule;
  until: string | null;
}

export function snoozeOptions(
  now: Date,
): Array<{ choice: SnoozeChoice; label: string }> {
  return [
    { choice: { rule: "checks", until: null }, label: "Until checks change" },
    { choice: { rule: "push", until: null }, label: "Until a new push" },
    {
      choice: { rule: "time", until: tomorrowMorning(now).toISOString() },
      label: "Until tomorrow",
    },
    {
      choice: { rule: "time", until: nextMondayMorning(now).toISOString() },
      label: "Until next week",
    },
  ];
}

export function SnoozeItems({
  snoozed,
  onSnooze,
  onUnsnooze,
}: {
  snoozed: boolean;
  onSnooze: (choice: SnoozeChoice) => void;
  onUnsnooze: () => void;
}) {
  return (
    <>
      {snoozeOptions(new Date()).map((option) => (
        <DropdownMenuItem
          key={option.label}
          onSelect={() => onSnooze(option.choice)}
        >
          {option.label}
        </DropdownMenuItem>
      ))}
      {snoozed ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onUnsnooze}>Unsnooze</DropdownMenuItem>
        </>
      ) : null}
    </>
  );
}

export function StepHeader({ onBack }: { onBack: () => void }) {
  return (
    <>
      <DropdownMenuItem
        onSelect={(event) => {
          event.preventDefault();
          onBack();
        }}
      >
        <Icon name="ChevronLeft" />
        Back
      </DropdownMenuItem>
      <DropdownMenuSeparator />
    </>
  );
}

export interface PullRef {
  repo: string;
  number: number;
}

export function useSnooze(): {
  snooze: (pull: PullRef, choice: SnoozeChoice) => void;
  unsnooze: (pull: PullRef) => void;
} {
  const rpc = useRpc<typeof githubRpcContract>();
  const unsnooze = useCallback(
    (pull: PullRef) => {
      const id = `github-unsnooze-${itemKey(pull)}`;
      rpc.call("unsnoozePull", pull).then(
        () => toast.success(`#${pull.number} is no longer snoozed`, { id }),
        (error: unknown) =>
          toast.error(`Couldn't unsnooze #${pull.number}`, {
            id,
            description: errorText(error),
          }),
      );
    },
    [rpc],
  );
  const snooze = useCallback(
    (pull: PullRef, choice: SnoozeChoice) => {
      const id = `github-snooze-${itemKey(pull)}`;
      rpc.call("snoozePull", { ...pull, ...choice }).then(
        (result) =>
          toast.success(
            `#${pull.number} snoozed ${snoozeLabel(result.snooze, new Date())}`,
            { id, action: { label: "Undo", onClick: () => unsnooze(pull) } },
          ),
        (error: unknown) =>
          toast.error(`Couldn't snooze #${pull.number}`, {
            id,
            description: errorText(error),
          }),
      );
    },
    [rpc, unsnooze],
  );
  return { snooze, unsnooze };
}

export function copyText(text: string, what: string): void {
  void experimental_copyToClipboard({ text }).then((ok) => {
    if (ok) {
      toast.success(`Copied the ${what}`, {
        id: "github-copy",
        description: text,
      });
    } else {
      toast.error(`Couldn't copy the ${what}`, { id: "github-copy" });
    }
  });
}
