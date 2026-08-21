// The static part of the demo world: project, host, and the small
// per-thread responses. Typed against @bb/server-contract so a contract
// change fails `typecheck` instead of reaching a reviewer as a crash.
//
// Times are relative to the request clock. A frozen timestamp would read as
// "12 minutes ago" on the day it was written and "3 weeks ago" when the
// reviewer opens the app, and it would also sort the app's own optimistic
// rows (stamped with the device clock) above rows the server appends.

import type {
  Host,
  ResolvedThreadExecutionOptions,
  ThreadListEntry,
  ThreadQueuedMessage,
} from "@bb/domain";
import type {
  ProjectWithThreadsResponse,
  SidebarBootstrapResponse,
  SystemVersionResponse,
  ThreadResponse,
  ThreadTabsResponse,
} from "@bb/server-contract";
import {
  DEMO_HOST_ID,
  DEMO_PERSONAL_PROJECT_ID,
  DEMO_PROJECT_ID,
} from "./ids.js";
import { DEFAULT_MODEL } from "./providers.js";
import type { DemoThreadSeed } from "./timelines.js";

const DAY_MS = 24 * 60 * 60_000;
const MINUTE_MS = 60_000;

/** A thread as the list and detail routes see it at one instant. */
export interface DemoThreadView {
  seed: DemoThreadSeed;
  /** True while a scripted reply is still pending. */
  busy: boolean;
  /** Last activity: the seed's age, or the latest sent message. */
  updatedAt: number;
}

export function seedUpdatedAt(seed: DemoThreadSeed, now: number): number {
  return now - seed.minutesAgo * MINUTE_MS;
}

/** When the seeded conversation of a thread started, 30 minutes before its last activity. */
export function seedStartedAt(seed: DemoThreadSeed, now: number): number {
  return seedUpdatedAt(seed, now) - 30 * MINUTE_MS;
}

export function threadListEntry(
  view: DemoThreadView,
  now: number,
): ThreadListEntry {
  const { seed, busy, updatedAt } = view;
  return {
    id: seed.id,
    projectId: DEMO_PROJECT_ID,
    environmentId: null,
    providerId: "codex",
    title: seed.title,
    titleFallback: seed.title,
    sectionId: null,
    status: busy ? "active" : "idle",
    parentThreadId: null,
    sourceThreadId: null,
    originKind: null,
    originPluginId: null,
    visibility: "visible",
    archivedAt: null,
    pinnedAt: null,
    deletedAt: null,
    lastReadAt: now,
    latestAttentionAt: updatedAt,
    createdAt: seedStartedAt(seed, now),
    updatedAt,
    runtime: {
      displayStatus: busy ? "active" : "idle",
      hostReconnectGraceExpiresAt: null,
    },
    activity: {
      activeWorkflowCount: 0,
      activeBackgroundAgentCount: 0,
      activeBackgroundCommandCount: 0,
      activePlanModeCount: 0,
      activeGoalCount: 0,
    },
    pinSortKey: null,
    hasPendingInteraction: false,
    environmentHostId: DEMO_HOST_ID,
    environmentName: null,
    environmentBranchName: "main",
    environmentWorkspaceDisplayKind: "other",
  };
}

export function threadResponse(
  view: DemoThreadView,
  now: number,
): ThreadResponse {
  const {
    activity: _activity,
    pinSortKey: _pinSortKey,
    hasPendingInteraction: _hasPendingInteraction,
    environmentHostId: _environmentHostId,
    environmentName: _environmentName,
    environmentBranchName: _environmentBranchName,
    environmentWorkspaceDisplayKind: _environmentWorkspaceDisplayKind,
    ...thread
  } = threadListEntry(view, now);
  return { ...thread, activeBackgroundAgentCount: 0, canSpawnChild: true };
}

const PROJECT_DEFAULT_EXECUTION_OPTIONS = {
  providerId: "codex",
  model: DEFAULT_MODEL,
  reasoningLevel: "high",
  permissionMode: "accept-edits",
  serviceTier: "default",
} as const;

export const THREAD_DEFAULT_EXECUTION_OPTIONS: ResolvedThreadExecutionOptions =
  {
    model: PROJECT_DEFAULT_EXECUTION_OPTIONS.model,
    permissionMode: PROJECT_DEFAULT_EXECUTION_OPTIONS.permissionMode,
    reasoningLevel: PROJECT_DEFAULT_EXECUTION_OPTIONS.reasoningLevel,
    serviceTier: PROJECT_DEFAULT_EXECUTION_OPTIONS.serviceTier,
    source: "client/turn/requested",
  };

export function sidebarBootstrap(
  views: readonly DemoThreadView[],
  now: number,
): SidebarBootstrapResponse {
  const createdAt = now - 7 * DAY_MS;
  const project: ProjectWithThreadsResponse = {
    id: DEMO_PROJECT_ID,
    kind: "standard",
    name: "demo-app",
    gitRemoteUrl: null,
    createdAt,
    updatedAt: Math.max(...views.map((view) => view.updatedAt)),
    sources: [],
    threads: views.map((view) => threadListEntry(view, now)),
    defaultExecutionOptions: PROJECT_DEFAULT_EXECUTION_OPTIONS,
  };
  const personalProject: ProjectWithThreadsResponse = {
    id: DEMO_PERSONAL_PROJECT_ID,
    kind: "standard",
    name: "Personal",
    gitRemoteUrl: null,
    createdAt,
    updatedAt: createdAt,
    sources: [],
    threads: [],
    defaultExecutionOptions: PROJECT_DEFAULT_EXECUTION_OPTIONS,
  };
  return { sections: [], projects: [project], personalProject };
}

export function hosts(now: number): Host[] {
  return [
    {
      id: DEMO_HOST_ID,
      name: "demo",
      type: "persistent",
      status: "connected",
      maxPermissionMode: "full",
      lastSeenAt: now,
      lastRejectedProtocolVersion: null,
      createdAt: now - 7 * DAY_MS,
      updatedAt: now,
    },
  ];
}

export const EMPTY_TABS: ThreadTabsResponse = { revision: 0, tabs: [] };

export const SYSTEM_VERSION: SystemVersionResponse = {
  currentVersion: "0.39.0",
  latestVersion: "0.39.0",
  source: "npm",
  updateAvailable: false,
  isDevelopment: false,
  upgradeCommand: "npx bb-app@latest",
};

/** `GET /plugins/contributions` has no contract type; this mirrors the server route. */
export const PLUGIN_CONTRIBUTIONS = { cliCommands: [], mentionProviders: [] };

export function queuedMessage(args: {
  id: string;
  content: ThreadQueuedMessage["content"];
  now: number;
}): ThreadQueuedMessage {
  return {
    id: args.id,
    content: args.content,
    model: THREAD_DEFAULT_EXECUTION_OPTIONS.model,
    reasoningLevel: THREAD_DEFAULT_EXECUTION_OPTIONS.reasoningLevel,
    permissionMode: THREAD_DEFAULT_EXECUTION_OPTIONS.permissionMode,
    serviceTier: THREAD_DEFAULT_EXECUTION_OPTIONS.serviceTier,
    groupWithNext: false,
    createdAt: args.now,
    updatedAt: args.now,
  };
}
