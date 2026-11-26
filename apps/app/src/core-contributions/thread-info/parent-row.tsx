import { useMemo, useState } from "react";
import type {
  ExperimentalThreadInfoProps,
  PluginSidebarThread,
} from "@get-bb/plugin-sdk";
import {
  experimental_DetailRow as DetailRow,
  experimental_showErrorToast as showErrorToast,
  experimental_ThreadTitleText as ThreadTitle,
  experimental_useSidebarThreads as useSidebarThreads,
  experimental_useThread as useThread,
  useBbNavigate,
  useSdk,
  UrlLink,
} from "@get-bb/plugin-sdk/app";
import { Button } from "@bb/shared-ui/button";
import { COARSE_POINTER_TEXT_SM_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import ParentThreadPicker from "./parent-thread-picker";

interface ParentOption {
  value: string;
  label: string;
  searchText: string;
}

function collectDescendantIds(
  threadId: string,
  threads: readonly PluginSidebarThread[],
): ReadonlySet<string> {
  const childrenByParentId = new Map<string, PluginSidebarThread[]>();
  for (const thread of threads) {
    if (thread.parentThreadId === null) continue;
    const children = childrenByParentId.get(thread.parentThreadId);
    if (children) children.push(thread);
    else childrenByParentId.set(thread.parentThreadId, [thread]);
  }
  const descendants = new Set<string>();
  const stack = [...(childrenByParentId.get(threadId) ?? [])];
  while (stack.length > 0) {
    const child = stack.pop();
    if (child === undefined || descendants.has(child.id)) continue;
    descendants.add(child.id);
    stack.push(...(childrenByParentId.get(child.id) ?? []));
  }
  return descendants;
}

function buildParentOptions({
  threadId,
  projectThreads,
  parentThreadId,
  parentLabel,
}: {
  threadId: string;
  projectThreads: readonly PluginSidebarThread[];
  parentThreadId: string | null;
  parentLabel: string;
}): ParentOption[] {
  const descendants = collectDescendantIds(threadId, projectThreads);
  const options: ParentOption[] = [
    { value: "none", label: "None", searchText: "None" },
  ];
  const seen = new Set<string>(["none"]);
  const addOption = (value: string, label: string, searchText: string) => {
    if (value === threadId || descendants.has(value) || seen.has(value)) {
      return;
    }
    seen.add(value);
    options.push({ value, label, searchText });
  };
  if (parentThreadId !== null) {
    const parent = projectThreads.find(
      (thread) => thread.id === parentThreadId,
    );
    addOption(parentThreadId, parentLabel, parent?.displayTitle ?? parentLabel);
  }
  const threadIdsWithChildren = new Set<string>();
  for (const thread of projectThreads) {
    if (thread.parentThreadId !== null) {
      threadIdsWithChildren.add(thread.parentThreadId);
    }
  }
  for (const hasChildren of [true, false]) {
    for (const candidate of projectThreads) {
      if (
        candidate.isHidden ||
        threadIdsWithChildren.has(candidate.id) !== hasChildren
      ) {
        continue;
      }
      addOption(
        candidate.id,
        candidate.title?.trim() ? candidate.title : "Parent thread",
        candidate.displayTitle,
      );
    }
  }
  return options;
}

export default function ParentRow({ threadId }: ExperimentalThreadInfoProps) {
  const { thread } = useThread(threadId);
  const parentThreadId = thread?.parentThreadId ?? null;
  const parent = useThread(parentThreadId ?? "");
  const sidebar = useSidebarThreads();
  const sdk = useSdk();
  const navigate = useBbNavigate();
  const [isPending, setIsPending] = useState(false);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const projectId = thread?.projectId ?? null;
  const projectThreads = useMemo(
    () =>
      isPickerOpen
        ? sidebar.threads.filter(
            (candidate) => candidate.projectId === projectId,
          )
        : [],
    [isPickerOpen, projectId, sidebar.threads],
  );
  const parentTitle = parent.thread?.title;
  const parentLabel =
    parentTitle && parentTitle.trim().length > 0
      ? parentTitle
      : (parentThreadId ?? "Parent thread");
  const options = useMemo(
    () =>
      buildParentOptions({
        threadId,
        projectThreads,
        parentThreadId,
        parentLabel,
      }),
    [parentLabel, parentThreadId, projectThreads, threadId],
  );
  if (thread === null) return null;
  const canAssignToParent =
    thread.parentThreadId === null && thread.visibility !== "hidden";
  if (parentThreadId === null && !canAssignToParent) return null;

  const assignParent = (nextParentThreadId: string | null) => {
    if (isPending) return;
    setIsPending(true);
    sdk.threads
      .update({ threadId: thread.id, parentThreadId: nextParentThreadId })
      .catch((error: unknown) => {
        showErrorToast({
          error,
          fallbackMessage: "Failed to assign parent thread.",
        });
      })
      .finally(() => setIsPending(false));
  };

  return (
    <DetailRow icon="UserRound" label="Parent">
      {parentThreadId !== null ? (
        <div
          className={cn(
            "inline-flex max-w-full min-w-0 items-center gap-1 text-foreground",
            COARSE_POINTER_TEXT_SM_CLASS,
          )}
        >
          <UrlLink
            href={navigate.experimental_threadHref(parentThreadId)}
            className={cn(
              "block min-w-0 text-foreground no-underline transition-[text-decoration-color] duration-150 hover:underline hover:underline-offset-2",
              COARSE_POINTER_TEXT_SM_CLASS,
            )}
          >
            <ThreadTitle title={parentLabel} tooltip />
          </UrlLink>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-3.5 shrink-0 rounded-full p-0 text-muted-foreground hover:bg-transparent hover:text-foreground [&_[data-icon-root]]:size-3 max-md:pointer-coarse:h-9 max-md:pointer-coarse:w-9 max-md:pointer-coarse:[&_[data-icon-root]]:size-5"
            disabled={isPending}
            onClick={() => assignParent(null)}
            aria-label="Clear parent thread"
          >
            <Icon name="X" />
          </Button>
        </div>
      ) : (
        <ParentThreadPicker
          value="none"
          options={options}
          isLoading={sidebar.status === "loading"}
          disabled={isPending}
          onChange={(value) => assignParent(value === "none" ? null : value)}
          onOpenChange={setIsPickerOpen}
        />
      )}
    </DetailRow>
  );
}
