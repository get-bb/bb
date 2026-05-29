import { z } from "zod";
import {
  BB_DESKTOP_BROWSER_MAX_TITLE_LENGTH,
  BB_DESKTOP_BROWSER_MAX_URL_LENGTH,
} from "@bb/server-contract";
import {
  areEnvironmentFilePreviewSourcesEqual,
  type EnvironmentFilePreviewSource,
  type HostFileTabState,
  type WorkspaceFilePreviewStatusLabel,
  type WorkspaceFileTabState,
} from "./file-preview";

export const FIXED_PANEL_TABS_STATE_STORAGE_PREFIX =
  "bb.thread.fixedPanelTabsState";
export const FIXED_PANEL_TABS_STATE_STORAGE_VERSION = 1;
export const FIXED_PANEL_TABS_IDLE_EXPIRY_MS = 14 * 24 * 60 * 60 * 1000;

const THREAD_INFO_TAB_ID = "thread-info";
const GIT_DIFF_TAB_ID = "git-diff";
const NEW_TAB_TAB_ID = "new-tab";

const environmentFilePreviewSourceSchema: z.ZodType<EnvironmentFilePreviewSource> =
  z.discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("working-tree"),
      })
      .strict(),
    z
      .object({
        kind: z.literal("head"),
      })
      .strict(),
    z
      .object({
        kind: z.literal("merge-base"),
        ref: z.string().min(1),
      })
      .strict(),
  ]);
const workspaceFilePreviewStatusLabelSchema: z.ZodType<WorkspaceFilePreviewStatusLabel | null> =
  z.literal("deleted").nullable();
const threadInfoFixedPanelTabSchema = z
  .object({
    id: z.literal(THREAD_INFO_TAB_ID),
    kind: z.literal("thread-info"),
  })
  .strict();
const gitDiffFixedPanelTabSchema = z
  .object({
    id: z.literal(GIT_DIFF_TAB_ID),
    kind: z.literal("git-diff"),
  })
  .strict();
const workspaceFilePreviewFixedPanelTabSchema = z
  .object({
    environmentId: z.string().min(1).nullable(),
    id: z.string().min(1),
    kind: z.literal("workspace-file-preview"),
    lineNumber: z.number().int().positive().nullable(),
    path: z.string().min(1),
    source: environmentFilePreviewSourceSchema,
    statusLabel: workspaceFilePreviewStatusLabelSchema,
  })
  .strict();
const hostFilePreviewFixedPanelTabSchema = z
  .object({
    id: z.string().min(1),
    kind: z.literal("host-file-preview"),
    lineNumber: z.number().int().positive().nullable(),
    path: z.string().min(1),
  })
  .strict();
const threadStorageFilePreviewFixedPanelTabSchema = z
  .object({
    id: z.string().min(1),
    isPinned: z.boolean(),
    kind: z.literal("thread-storage-file-preview"),
    path: z.string().min(1),
  })
  .strict();
const appFixedPanelTabSchema = z
  .object({
    appId: z.string().min(1),
    id: z.string().min(1),
    kind: z.literal("app"),
  })
  .strict();
const browserFixedPanelTabSchema = z
  .object({
    id: z.string().min(1),
    kind: z.literal("browser"),
    title: z.string().min(1).max(BB_DESKTOP_BROWSER_MAX_TITLE_LENGTH).nullable(),
    url: z.string().max(BB_DESKTOP_BROWSER_MAX_URL_LENGTH),
  })
  .strict();
const newTabFixedPanelTabSchema = z
  .object({
    id: z.literal(NEW_TAB_TAB_ID),
    kind: z.literal("new-tab"),
  })
  .strict();
const terminalFixedPanelTabSchema = z
  .object({
    id: z.string().min(1),
    kind: z.literal("terminal"),
    terminalId: z.string().min(1),
  })
  .strict();
const secondaryFixedPanelTabSchema = z.discriminatedUnion("kind", [
  threadInfoFixedPanelTabSchema,
  gitDiffFixedPanelTabSchema,
  workspaceFilePreviewFixedPanelTabSchema,
  hostFilePreviewFixedPanelTabSchema,
  threadStorageFilePreviewFixedPanelTabSchema,
  appFixedPanelTabSchema,
  browserFixedPanelTabSchema,
  newTabFixedPanelTabSchema,
]);
const bottomFixedPanelTabSchema = z.discriminatedUnion("kind", [
  terminalFixedPanelTabSchema,
]);
const secondaryFixedPanelTabGroupStateSchema = z
  .object({
    tabs: z.array(secondaryFixedPanelTabSchema),
    activeTabId: z.string().min(1).nullable(),
    isOpen: z.boolean(),
  })
  .strict();
const legacySecondaryFixedPanelTabGroupStateSchema = z
  .object({
    tabs: z.array(secondaryFixedPanelTabSchema),
    activeTabId: z.string().min(1).nullable(),
  })
  .strict();
const bottomFixedPanelTabGroupStateSchema = z
  .object({
    tabs: z.array(bottomFixedPanelTabSchema),
    activeTabId: z.string().min(1).nullable(),
  })
  .strict();
const fixedPanelTabsStateSchema = z
  .object({
    version: z.literal(FIXED_PANEL_TABS_STATE_STORAGE_VERSION),
    secondary: secondaryFixedPanelTabGroupStateSchema,
    bottom: bottomFixedPanelTabGroupStateSchema,
    lastUsedAt: z.number().int().nonnegative(),
  })
  .strict();
const legacyFixedPanelTabsStateSchema = z
  .object({
    version: z.literal(FIXED_PANEL_TABS_STATE_STORAGE_VERSION),
    secondary: legacySecondaryFixedPanelTabGroupStateSchema,
    bottom: bottomFixedPanelTabGroupStateSchema,
    lastUsedAt: z.number().int().nonnegative(),
  })
  .strict();

export type FixedPanelRegion = "secondary" | "bottom";

export interface ThreadInfoFixedPanelTab {
  id: typeof THREAD_INFO_TAB_ID;
  kind: "thread-info";
}

export interface GitDiffFixedPanelTab {
  id: typeof GIT_DIFF_TAB_ID;
  kind: "git-diff";
}

export interface WorkspaceFilePreviewFixedPanelTab {
  environmentId: string | null;
  id: string;
  kind: "workspace-file-preview";
  lineNumber: number | null;
  path: string;
  source: EnvironmentFilePreviewSource;
  statusLabel: WorkspaceFilePreviewStatusLabel | null;
}

export interface HostFilePreviewFixedPanelTab {
  id: string;
  kind: "host-file-preview";
  lineNumber: number | null;
  path: string;
}

export interface ThreadStorageFilePreviewFixedPanelTab {
  id: string;
  isPinned: boolean;
  kind: "thread-storage-file-preview";
  path: string;
}

export interface AppFixedPanelTab {
  appId: string;
  id: string;
  kind: "app";
}

/**
 * A web browser tab hosted by a native Electron `WebContentsView` (desktop
 * only). `url` is the last-loaded page (empty string = the new-tab screen) and
 * `title` is the last title pushed from the view, so the tab pill keeps its
 * label while inactive and across reloads. Favicons are intentionally not
 * persisted/rendered (untrusted remote URL); the pill shows a generic globe.
 * Live loading state is not persisted — it is held by the active tab's chrome.
 */
export interface BrowserFixedPanelTab {
  id: string;
  kind: "browser";
  title: string | null;
  url: string;
}

export interface NewTabFixedPanelTab {
  id: typeof NEW_TAB_TAB_ID;
  kind: "new-tab";
}

export interface TerminalFixedPanelTab {
  id: string;
  kind: "terminal";
  terminalId: string;
}

export type SecondaryFixedPanelTab =
  | ThreadInfoFixedPanelTab
  | GitDiffFixedPanelTab
  | WorkspaceFilePreviewFixedPanelTab
  | HostFilePreviewFixedPanelTab
  | ThreadStorageFilePreviewFixedPanelTab
  | AppFixedPanelTab
  | BrowserFixedPanelTab
  | NewTabFixedPanelTab;

/**
 * The subset of secondary-panel tabs rendered as closable file tabs in the tab
 * strip. Excludes thread-info and git-diff, which are fixed views toggled
 * separately rather than ordered alongside opened files.
 */
export type SecondaryFileFixedPanelTab =
  | WorkspaceFilePreviewFixedPanelTab
  | HostFilePreviewFixedPanelTab
  | ThreadStorageFilePreviewFixedPanelTab
  | AppFixedPanelTab
  | BrowserFixedPanelTab
  | NewTabFixedPanelTab;

export type BottomFixedPanelTab = TerminalFixedPanelTab;

export type FixedPanelTab = SecondaryFixedPanelTab | BottomFixedPanelTab;

export interface FixedPanelTabGroupState {
  tabs: readonly FixedPanelTab[];
  activeTabId: string | null;
}

export interface FixedSecondaryPanelTabGroupState extends FixedPanelTabGroupState {
  isOpen: boolean;
}

export interface FixedPanelTabsState {
  version: typeof FIXED_PANEL_TABS_STATE_STORAGE_VERSION;
  secondary: FixedSecondaryPanelTabGroupState;
  bottom: FixedPanelTabGroupState;
  lastUsedAt: number;
}

interface FixedPanelTabsStorageKeyArgs {
  threadId: string;
}

interface CreateFixedPanelTabsStateArgs {
  bottom?: FixedPanelTabGroupState;
  lastUsedAt?: number;
  secondary?: FixedSecondaryPanelTabGroupState;
}

interface ParseFixedPanelTabsStateArgs {
  initialValue: FixedPanelTabsState;
  now: number;
  storedValue: string | null;
}

interface ParseFixedPanelTabsStateForStorageResult {
  shouldPrune: boolean;
  state: FixedPanelTabsState;
}

interface SerializeFixedPanelTabsStateArgs {
  state: FixedPanelTabsState;
}

interface IsFixedPanelTabsStateExpiredArgs {
  now: number;
  state: FixedPanelTabsState;
}

interface PruneFixedPanelTabsStorageArgs {
  now: number;
}

interface NormalizeFixedPanelTabsStateArgs {
  state: FixedPanelTabsState;
}

interface NormalizeFixedPanelTabGroupStateArgs {
  group: FixedPanelTabGroupState;
  region: FixedPanelRegion;
}

interface CreateThreadStorageFilePreviewFixedPanelTabArgs {
  isPinned: boolean;
  path: string;
}

interface CreateAppFixedPanelTabArgs {
  appId: string;
}

interface CreateBrowserFixedPanelTabArgs {
  url: string;
}

interface CreateWorkspaceFilePreviewFixedPanelTabArgs {
  environmentId: string | null;
  tab: WorkspaceFileTabState;
}

interface CreateTerminalFixedPanelTabArgs {
  terminalId: string;
}

function getLocalStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window.localStorage;
}

function normalizeStorageSegment(value: string): string {
  return encodeURIComponent(value.trim());
}

function buildFileTabId(kind: FixedPanelTab["kind"], path: string): string {
  return `${kind}:${encodeURIComponent(path)}`;
}

export function createThreadInfoFixedPanelTab(): ThreadInfoFixedPanelTab {
  return {
    id: THREAD_INFO_TAB_ID,
    kind: "thread-info",
  };
}

export function createGitDiffFixedPanelTab(): GitDiffFixedPanelTab {
  return {
    id: GIT_DIFF_TAB_ID,
    kind: "git-diff",
  };
}

export function createWorkspaceFilePreviewFixedPanelTab({
  environmentId,
  tab,
}: CreateWorkspaceFilePreviewFixedPanelTabArgs): WorkspaceFilePreviewFixedPanelTab {
  return {
    environmentId,
    id: buildFileTabId("workspace-file-preview", tab.path),
    kind: "workspace-file-preview",
    lineNumber: tab.lineNumber,
    path: tab.path,
    source: tab.source,
    statusLabel: tab.statusLabel,
  };
}

export function createHostFilePreviewFixedPanelTab(
  tab: HostFileTabState,
): HostFilePreviewFixedPanelTab {
  return {
    id: buildFileTabId("host-file-preview", tab.path),
    kind: "host-file-preview",
    lineNumber: tab.lineNumber,
    path: tab.path,
  };
}

export function createThreadStorageFilePreviewFixedPanelTab({
  isPinned,
  path,
}: CreateThreadStorageFilePreviewFixedPanelTabArgs): ThreadStorageFilePreviewFixedPanelTab {
  return {
    id: buildFileTabId("thread-storage-file-preview", path),
    isPinned,
    kind: "thread-storage-file-preview",
    path,
  };
}

export function createAppFixedPanelTab({
  appId,
}: CreateAppFixedPanelTabArgs): AppFixedPanelTab {
  return {
    appId,
    id: `app:${encodeURIComponent(appId)}`,
    kind: "app",
  };
}

/**
 * Browser tabs get a fresh unique id per instance — the URL is mutable (it
 * changes on every navigation), so it cannot serve as a stable identity the way
 * an app id or file path does.
 */
export function createBrowserFixedPanelTab({
  url,
}: CreateBrowserFixedPanelTabArgs): BrowserFixedPanelTab {
  return {
    id: `browser:${crypto.randomUUID()}`,
    kind: "browser",
    title: null,
    url,
  };
}

export function createNewTabFixedPanelTab(): NewTabFixedPanelTab {
  return {
    id: NEW_TAB_TAB_ID,
    kind: "new-tab",
  };
}

export function createTerminalFixedPanelTab({
  terminalId,
}: CreateTerminalFixedPanelTabArgs): TerminalFixedPanelTab {
  return {
    id: `terminal:${encodeURIComponent(terminalId)}`,
    kind: "terminal",
    terminalId,
  };
}

function isTabSupportedInRegion(
  region: FixedPanelRegion,
  tab: FixedPanelTab,
): boolean {
  if (region === "bottom") {
    return tab.kind === "terminal";
  }
  return tab.kind !== "terminal";
}

function isTransientFixedPanelTab(tab: FixedPanelTab): boolean {
  return tab.kind === "new-tab";
}

function normalizeFixedPanelTabGroupState({
  group,
  region,
}: NormalizeFixedPanelTabGroupStateArgs): FixedPanelTabGroupState {
  const seenTabIds = new Set<string>();
  const tabs: FixedPanelTab[] = [];
  for (const tab of group.tabs) {
    if (
      isTransientFixedPanelTab(tab) ||
      !isTabSupportedInRegion(region, tab) ||
      seenTabIds.has(tab.id)
    ) {
      continue;
    }
    seenTabIds.add(tab.id);
    tabs.push(tab);
  }

  return {
    tabs,
    activeTabId:
      group.activeTabId !== null && seenTabIds.has(group.activeTabId)
        ? group.activeTabId
        : null,
  };
}

function normalizeFixedSecondaryPanelTabGroupState(
  group: FixedSecondaryPanelTabGroupState,
): FixedSecondaryPanelTabGroupState {
  return {
    ...normalizeFixedPanelTabGroupState({
      group,
      region: "secondary",
    }),
    isOpen: group.isOpen,
  };
}

export function normalizeFixedPanelTabsState({
  state,
}: NormalizeFixedPanelTabsStateArgs): FixedPanelTabsState {
  return {
    ...state,
    secondary: normalizeFixedSecondaryPanelTabGroupState(state.secondary),
    bottom: normalizeFixedPanelTabGroupState({
      group: state.bottom,
      region: "bottom",
    }),
  };
}

export function createEmptyFixedPanelTabsState(
  args: CreateFixedPanelTabsStateArgs = {},
): FixedPanelTabsState {
  return normalizeFixedPanelTabsState({
    state: {
      version: FIXED_PANEL_TABS_STATE_STORAGE_VERSION,
      secondary: args.secondary ?? {
        tabs: [],
        activeTabId: null,
        isOpen: false,
      },
      bottom: args.bottom ?? {
        tabs: [],
        activeTabId: null,
      },
      lastUsedAt: args.lastUsedAt ?? 0,
    },
  });
}

export const EMPTY_FIXED_PANEL_TABS_STATE = createEmptyFixedPanelTabsState();

export function getFixedPanelTabsStateStorageKey({
  threadId,
}: FixedPanelTabsStorageKeyArgs): string {
  return `${FIXED_PANEL_TABS_STATE_STORAGE_PREFIX}-${normalizeStorageSegment(
    threadId,
  )}-${FIXED_PANEL_TABS_STATE_STORAGE_VERSION}`;
}

export function isFixedPanelTabsStateStorageKey(key: string): boolean {
  return (
    key.startsWith(`${FIXED_PANEL_TABS_STATE_STORAGE_PREFIX}-`) &&
    key.endsWith(`-${FIXED_PANEL_TABS_STATE_STORAGE_VERSION}`)
  );
}

export function isFixedPanelTabsStateExpired({
  now,
  state,
}: IsFixedPanelTabsStateExpiredArgs): boolean {
  return now - state.lastUsedAt > FIXED_PANEL_TABS_IDLE_EXPIRY_MS;
}

export function parseFixedPanelTabsState({
  initialValue,
  now,
  storedValue,
}: ParseFixedPanelTabsStateArgs): FixedPanelTabsState {
  return parseFixedPanelTabsStateForStorage({
    initialValue,
    now,
    storedValue,
  }).state;
}

function parseFixedPanelTabsStateForStorage({
  initialValue,
  now,
  storedValue,
}: ParseFixedPanelTabsStateArgs): ParseFixedPanelTabsStateForStorageResult {
  if (storedValue === null) {
    return {
      shouldPrune: false,
      state: initialValue,
    };
  }

  let parsedValue: unknown;
  try {
    parsedValue = JSON.parse(storedValue);
  } catch {
    return {
      shouldPrune: true,
      state: initialValue,
    };
  }

  const stateResult = fixedPanelTabsStateSchema.safeParse(parsedValue);
  if (stateResult.success) {
    const normalizedState = normalizeFixedPanelTabsState({
      state: stateResult.data,
    });
    if (isFixedPanelTabsStateExpired({ now, state: normalizedState })) {
      return {
        shouldPrune: true,
        state: initialValue,
      };
    }

    return {
      shouldPrune: false,
      state: normalizedState,
    };
  }

  const legacyStateResult =
    legacyFixedPanelTabsStateSchema.safeParse(parsedValue);
  if (!legacyStateResult.success) {
    return {
      shouldPrune: true,
      state: initialValue,
    };
  }
  const normalizedState = normalizeFixedPanelTabsState({
    state: {
      ...legacyStateResult.data,
      secondary: {
        ...legacyStateResult.data.secondary,
        isOpen: legacyStateResult.data.secondary.activeTabId !== null,
      },
    },
  });
  if (isFixedPanelTabsStateExpired({ now, state: normalizedState })) {
    return {
      shouldPrune: true,
      state: initialValue,
    };
  }

  return {
    shouldPrune: false,
    state: normalizedState,
  };
}

export function serializeFixedPanelTabsState({
  state,
}: SerializeFixedPanelTabsStateArgs): string {
  return JSON.stringify(normalizeFixedPanelTabsState({ state }));
}

export function pruneFixedPanelTabsStorage({
  now,
}: PruneFixedPanelTabsStorageArgs): void {
  const localStorage = getLocalStorage();
  if (!localStorage) {
    return;
  }

  const keys: string[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key && isFixedPanelTabsStateStorageKey(key)) {
      keys.push(key);
    }
  }

  for (const key of keys) {
    const result = parseFixedPanelTabsStateForStorage({
      initialValue: EMPTY_FIXED_PANEL_TABS_STATE,
      now,
      storedValue: localStorage.getItem(key),
    });
    if (result.shouldPrune) {
      localStorage.removeItem(key);
    }
  }
}

export function areFixedPanelTabsEquivalent(
  a: FixedPanelTab,
  b: FixedPanelTab,
): boolean {
  if (a.id !== b.id || a.kind !== b.kind) {
    return false;
  }
  switch (a.kind) {
    case "thread-info":
    case "git-diff":
    case "new-tab":
      return true;
    case "workspace-file-preview":
      return (
        b.kind === "workspace-file-preview" &&
        a.environmentId === b.environmentId &&
        a.lineNumber === b.lineNumber &&
        a.path === b.path &&
        areEnvironmentFilePreviewSourcesEqual(a.source, b.source) &&
        a.statusLabel === b.statusLabel
      );
    case "host-file-preview":
      return (
        b.kind === "host-file-preview" &&
        a.lineNumber === b.lineNumber &&
        a.path === b.path
      );
    case "app":
      return b.kind === "app" && a.appId === b.appId;
    case "browser":
      return b.kind === "browser" && a.url === b.url && a.title === b.title;
    case "thread-storage-file-preview":
      return (
        b.kind === "thread-storage-file-preview" &&
        a.isPinned === b.isPinned &&
        a.path === b.path
      );
    case "terminal":
      return b.kind === "terminal" && a.terminalId === b.terminalId;
  }
}
