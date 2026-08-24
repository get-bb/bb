import type {
  EnvironmentStatus,
  Thread,
  ThreadListEntry,
  ThreadPullRequest,
  ThreadRuntimeDisplayStatus,
} from "@bb/domain";
import type { WorkspaceChangedFilesSection } from "@/data/environments";
import { getThreadDisplayTitle } from "@/data/threads/thread-title";
import type { IconName } from "@/ui/icon-map";

/**
 * Pure section derivation for the thread context chips (ports of the web
 * ThreadPromptContextBanner props assembly in ThreadDetailView /
 * ThreadDetailPromptArea): which related-thread row to show, which child
 * threads count as active, and which read-only state (archived /
 * environment gone) replaces the live sections.
 */

// ---------------------------------------------------------------------------
// Parent / source thread

type ThreadRelationship = "parent" | "fork" | "side-chat";

export interface ThreadContextParentSection {
  threadId: string;
  title: string;
  relationship: ThreadRelationship;
}

export const PARENT_SECTION_COPY: Record<
  ThreadRelationship,
  { verb: string; bodyLead: string }
> = {
  parent: { verb: "Parent", bodyLead: "This thread is a child of" },
  fork: { verb: "Forked from", bodyLead: "This thread was forked from" },
  "side-chat": {
    verb: "Side chat of",
    bodyLead: "This thread is a side chat of",
  },
};

export const PARENT_SECTION_ICON: Record<ThreadRelationship, IconName> = {
  parent: "UserRound",
  fork: "Fork",
  "side-chat": "SideChat",
};

type BannerThread = Pick<
  Thread,
  | "id"
  | "projectId"
  | "parentThreadId"
  | "sourceThreadId"
  | "originKind"
  | "originPluginId"
>;

type RelatedThread = Pick<
  Thread,
  "id" | "title" | "titleFallback" | "projectId" | "archivedAt" | "deletedAt"
>;

function isSideChatThread(
  thread: Pick<Thread, "originKind" | "originPluginId">,
  sideChatPluginId: string,
): boolean {
  return (
    thread.originKind === "fork" && thread.originPluginId === sideChatPluginId
  );
}

/** Which related thread the chip links and how it relates. */
export function resolveRelatedThreadId(
  thread: BannerThread,
): { threadId: string; relationship: "parent" | "fork" } | null {
  if (thread.originKind !== null) {
    return thread.sourceThreadId === null
      ? null
      : {
          threadId: thread.sourceThreadId,
          relationship: thread.originKind === "fork" ? "fork" : "parent",
        };
  }
  return thread.parentThreadId === null
    ? null
    : { threadId: thread.parentThreadId, relationship: "parent" };
}

/**
 * The parent/fork/side-chat row. While the related record loads the row
 * shows an id-based fallback (no flicker to "no parent"); once loaded, an
 * archived / deleted related thread, or a fork source in another project,
 * is silently dropped (web parity).
 */
export function buildParentThreadSection({
  thread,
  relatedThread,
  sideChatPluginId,
}: {
  thread: BannerThread;
  relatedThread: RelatedThread | undefined;
  sideChatPluginId: string;
}): ThreadContextParentSection | null {
  const related = resolveRelatedThreadId(thread);
  if (related === null) return null;
  const relationship: ThreadRelationship = isSideChatThread(
    thread,
    sideChatPluginId,
  )
    ? "side-chat"
    : related.relationship;
  if (relatedThread === undefined) {
    return {
      threadId: related.threadId,
      title: related.threadId.slice(0, 8),
      relationship,
    };
  }
  if (
    relatedThread.archivedAt !== null ||
    relatedThread.deletedAt !== null ||
    (relationship !== "parent" && relatedThread.projectId !== thread.projectId)
  ) {
    return null;
  }
  return {
    threadId: related.threadId,
    title: getThreadDisplayTitle(relatedThread),
    relationship,
  };
}

// ---------------------------------------------------------------------------
// Child threads

const CONTEXT_ACTIVE_CHILD_RUNTIME_STATUSES: ReadonlySet<ThreadRuntimeDisplayStatus> =
  new Set([
    "active",
    "host-reconnecting",
    "provisioning",
    "starting",
    "waiting-for-host",
  ]);

function isThreadDisplayStatusContextActive(
  status: ThreadRuntimeDisplayStatus,
): boolean {
  return CONTEXT_ACTIVE_CHILD_RUNTIME_STATUSES.has(status);
}

interface ThreadBannerChildItem {
  id: string;
  title: string;
  hasPendingInteraction: boolean;
}

export interface ThreadContextChildThreadsSection {
  items: readonly ThreadBannerChildItem[];
  pendingCount: number;
  /** Header copy: "2 active child threads" / "1 child thread needs input". */
  label: string;
  /** The first (most urgent) child. */
  primary: ThreadBannerChildItem;
}

function childThreadsLabel(args: {
  count: number;
  pendingCount: number;
}): string {
  if (args.pendingCount > 0) {
    return `${args.pendingCount} child ${args.pendingCount === 1 ? "thread needs" : "threads need"} input`;
  }
  return `${args.count} active child ${args.count === 1 ? "thread" : "threads"}`;
}

/**
 * The active children the chip surfaces: delegated work only (forks and
 * side chats are user-driven branches), running or blocked on the user,
 * blocked ones first.
 */
export function buildChildThreadsSection(
  children: readonly ThreadListEntry[] | undefined,
): ThreadContextChildThreadsSection | null {
  if (!children || children.length === 0) return null;
  const items = children
    .filter(
      (entry) =>
        entry.originKind === null &&
        (isThreadDisplayStatusContextActive(entry.runtime.displayStatus) ||
          entry.hasPendingInteraction),
    )
    .map<ThreadBannerChildItem>((entry) => ({
      id: entry.id,
      title: getThreadDisplayTitle(entry),
      hasPendingInteraction: entry.hasPendingInteraction,
    }))
    .sort((left, right) =>
      left.hasPendingInteraction === right.hasPendingInteraction
        ? 0
        : left.hasPendingInteraction
          ? -1
          : 1,
    );
  const primary = items[0];
  if (!primary) return null;
  const pendingCount = items.filter(
    (item) => item.hasPendingInteraction,
  ).length;
  return {
    items,
    pendingCount,
    label: childThreadsLabel({ count: items.length, pendingCount }),
    primary,
  };
}

export interface ThreadContextChildThreadItem {
  id: string;
  title: string;
  /** The child's latest pending interaction, summarized; null when it runs. */
  pendingSummary: string | null;
  hasPendingInteraction: boolean;
}

/**
 * Rows for the child-threads chip: the children whose pending interaction
 * the parent already fetched (with its summary) first, then the section's
 * other active children, with any child that waits on input ahead of the
 * running ones. A child in both sources appears once, with its summary.
 */
export function mergeChildThreadItems(
  section: ThreadContextChildThreadsSection | null,
  pending: readonly {
    id: string;
    title: string;
    pendingSummary: string;
  }[],
): ThreadContextChildThreadItem[] {
  const items = pending.map<ThreadContextChildThreadItem>((item) => ({
    ...item,
    hasPendingInteraction: true,
  }));
  const seen = new Set(items.map((item) => item.id));
  for (const child of section?.items ?? []) {
    if (seen.has(child.id)) continue;
    seen.add(child.id);
    items.push({
      id: child.id,
      title: child.title,
      pendingSummary: null,
      hasPendingInteraction: child.hasPendingInteraction,
    });
  }
  return items.sort((left, right) =>
    left.hasPendingInteraction === right.hasPendingInteraction
      ? 0
      : left.hasPendingInteraction
        ? -1
        : 1,
  );
}

// ---------------------------------------------------------------------------
// Read-only states

export type EnvironmentGoneStatus = Extract<
  EnvironmentStatus,
  "destroying" | "destroyed"
>;

interface ReadOnlyStatusCopy {
  /** Chip label. */
  statusLabel: string;
  /** Sheet body. */
  description: string;
}

const ENVIRONMENT_GONE_COPY: Record<EnvironmentGoneStatus, ReadOnlyStatusCopy> =
  {
    destroying: {
      statusLabel: "Archiving environment…",
      description:
        "The environment is being archived. This thread is read-only.",
    },
    destroyed: {
      statusLabel: "Environment archived",
      description: "The environment was archived. This thread is read-only.",
    },
  };

const ARCHIVED_THREAD_COPY: ReadOnlyStatusCopy = {
  statusLabel: "Archived",
  description: "This thread is archived. Unarchive it to continue.",
};

export function resolveEnvironmentGoneStatus(
  status: EnvironmentStatus | undefined,
): EnvironmentGoneStatus | null {
  return status === "destroying" || status === "destroyed" ? status : null;
}

// ---------------------------------------------------------------------------
// Sections → what the chip row renders

interface ThreadBannerGitSection {
  changedFiles: WorkspaceChangedFilesSection;
}

interface ThreadBannerPullRequestSection {
  pullRequest: ThreadPullRequest;
}

export interface ThreadContextSections {
  archived: { archivedAt: number } | null;
  environmentGone: { status: EnvironmentGoneStatus } | null;
  parent: ThreadContextParentSection | null;
  children: ThreadContextChildThreadsSection | null;
  pullRequest: ThreadBannerPullRequestSection | null;
  git: ThreadBannerGitSection | null;
}

export type ThreadContextLayout =
  | { kind: "hidden" }
  | {
      /** Frozen thread: one status chip (+ the related-thread chip). */
      kind: "read-only";
      statusLabel: string;
      description: string;
      icon: IconName;
      /** Unarchive is offered for archived threads whose environment still exists. */
      offerUnarchive: boolean;
      parent: ThreadContextParentSection | null;
    }
  | {
      kind: "live";
      parent: ThreadContextParentSection | null;
      children: ThreadContextChildThreadsSection | null;
      pullRequest: ThreadBannerPullRequestSection | null;
      git: ThreadBannerGitSection | null;
    };

/**
 * Web ThreadPromptContextBanner's top-level branching: archived / environment
 * gone suppress the live sections (the parent row survives); otherwise the
 * row is hidden while the workspace status is still pending and when no
 * section applies.
 */
export function resolveThreadContextLayout(
  sections: ThreadContextSections,
  { gitSectionPending }: { gitSectionPending: boolean },
): ThreadContextLayout {
  if (sections.archived || sections.environmentGone) {
    const environmentGone = sections.environmentGone !== null;
    const copy = sections.environmentGone
      ? ENVIRONMENT_GONE_COPY[sections.environmentGone.status]
      : ARCHIVED_THREAD_COPY;
    return {
      kind: "read-only",
      statusLabel: copy.statusLabel,
      description: copy.description,
      icon: environmentGone ? "CircleX" : "Archive",
      offerUnarchive: sections.archived !== null && !environmentGone,
      parent: sections.parent,
    };
  }
  if (gitSectionPending) return { kind: "hidden" };
  if (
    sections.parent === null &&
    sections.children === null &&
    sections.pullRequest === null &&
    sections.git === null
  ) {
    return { kind: "hidden" };
  }
  return {
    kind: "live",
    parent: sections.parent,
    children: sections.children,
    pullRequest: sections.pullRequest,
    git: sections.git,
  };
}
