import { z } from "zod";
import {
  availableModelSchema,
  getProjectPathValidationMessage,
  normalizeProjectPathInput,
  activeThinkingSchema,
  experimentsSchema,
  featureFlagsSchema,
  environmentSchema,
  gitBranchNameSchema,
  gitBranchRefClassificationSchema,
  hostSchema,
  pendingInteractionResolutionSchema,
  pendingInteractionSchema,
  promptHistoryEntrySchema,
  projectSchema,
  projectSourceSchema,
  promptInputSchema,
  permissionModeSchema,
  projectSourceCheckoutSchema,
  providerInfoSchema,
  reasoningLevelSchema,
  resolvedThreadExecutionOptionsSchema,
  serviceTierSchema,
  terminalSessionCloseReasonSchema,
  terminalSessionStatusSchema,
  terminalColsSchema,
  terminalDataBase64Schema,
  terminalRowsSchema,
  threadListEntrySchema,
  threadGitDiffResponseSchema,
  threadTimelinePendingTodosSchema,
  threadScheduleKindSchema,
  threadWithRuntimeSchema,
  threadQueuedMessageSchema,
  threadPullRequestSchema,
  workspaceStatusSchema,
  jsonValueSchema,
  appDataPathSchema,
  applicationIdSchema,
  appSourceNameSchema,
  changedMessageSchema,
  changedMessageLenientSchema,
  callerExecutionInputSourceSchema,
  projectExecutionDefaultsSchema,
  workflowProgressSnapshotSchema,
  workflowRunEventSchema,
  workflowRunRetentionSchema,
  workflowRunSourceTierSchema,
  workflowRunStatusSchema,
  workflowSandboxSchema,
  BRANCH_LIST_QUERY_MAX_LENGTH,
  FILE_LIST_QUERY_MAX_LENGTH,
} from "@bb/domain";
import {
  hostDaemonWorkflowListingSchema,
  workspaceResolutionFailureSchema,
} from "@bb/host-daemon-contract";
import type {
  AppDataPath,
  ApplicationId,
  CallerExecutionInputSource,
  GitBranchName,
  JsonValue,
} from "@bb/domain";
import { apiErrorSchema } from "./errors.js";
import { timelineRowSchema } from "./thread-timeline.js";

export {
  BRANCH_LIST_LIMIT_MAX,
  BRANCH_LIST_QUERY_MAX_LENGTH,
  FILE_LIST_LIMIT_MAX,
  FILE_LIST_QUERY_MAX_LENGTH,
} from "@bb/domain";

export const sendMessageModeSchema = z.enum([
  "queue-if-active",
  "steer-if-active",
  "auto",
  "start",
  "steer",
]);

export const AUTOMATION_NAME_MAX_LENGTH = 200;
export const SCHEDULE_CRON_MAX_LENGTH = 100;
export const SCHEDULE_NAME_MAX_LENGTH = 200;
export const SCHEDULE_TIMEZONE_MAX_LENGTH = 100;
export const THREAD_SCHEDULE_PROMPT_MAX_LENGTH = 8_000;

interface IncludeQueryValidationArgs {
  allowedValues: readonly string[];
  value: string;
}

function isCommaSeparatedIncludeQueryValue(
  args: IncludeQueryValidationArgs,
): boolean {
  const requestedValues = args.value.split(",");
  return requestedValues.every(
    (value) => value.length > 0 && args.allowedValues.includes(value),
  );
}

export const threadContextWindowUsageSchema = z.object({
  usedTokens: z.number(),
  modelContextWindow: z.number(),
  estimated: z.boolean(),
});
export type ThreadContextWindowUsage = z.infer<
  typeof threadContextWindowUsageSchema
>;

const isoUtcDateTimeSchema = z.iso.datetime();

export const bbDesktopVersionFeedFileSchema = z.object({
  url: z.string().min(1),
  sha512: z.string().min(1),
  size: z.number().int().nonnegative(),
});

export const bbDesktopVersionFeedSchema = z.object({
  schemaVersion: z.literal(1),
  channel: z.literal("latest"),
  platform: z.literal("macos"),
  version: z.string().min(1),
  releaseDate: isoUtcDateTimeSchema,
  releaseName: z.string().min(1),
  releaseNotes: z.string().nullable(),
  minimumSystemVersion: z.string().min(1).nullable(),
  files: z.array(bbDesktopVersionFeedFileSchema).min(1),
  path: z.string().min(1),
  sha512: z.string().min(1),
  stagingPercentage: z.number().min(0).max(100).nullable(),
});
export type BbDesktopVersionFeed = z.infer<typeof bbDesktopVersionFeedSchema>;

export const bbDesktopInfoSchema = z.object({
  lastCheckedAt: isoUtcDateTimeSchema.nullable(),
  latestVersion: z.string().min(1).nullable(),
  pendingVersion: z.string().min(1).nullable(),
  platform: z.literal("macos"),
  updateAvailable: z.boolean(),
  updateDownloaded: z.boolean(),
  version: z.string().min(1),
});
export type BbDesktopInfo = z.infer<typeof bbDesktopInfoSchema>;

export const bbDesktopThemeSchema = z.enum(["light", "dark"]);
export type BbDesktopTheme = z.infer<typeof bbDesktopThemeSchema>;

export type BbDesktopInfoChangeHandler = (info: BbDesktopInfo) => void;
export type BbDesktopInfoUnsubscribe = () => void;

export interface BbDesktopApi extends BbDesktopInfo {
  /**
   * Control surface for the desktop-only web browser tab. The renderer drives
   * a hardened, isolated Electron `WebContentsView` through these methods; the
   * web build has no `window.bbDesktop`, so this surface is desktop-only by
   * construction.
   */
  browser: BbDesktopBrowserApi;
  checkForUpdates(): Promise<BbDesktopInfo>;
  getInfo(): Promise<BbDesktopInfo>;
  installUpdate(): Promise<void>;
  onChange(listener: BbDesktopInfoChangeHandler): BbDesktopInfoUnsubscribe;
  /**
   * Open a URL in the user's default system browser, leaving the in-app
   * browser tab. The main process only honors `http(s)` URLs — the address
   * originates from a possibly-hostile page, so other schemes are dropped.
   * No-op on the web build where `window.bbDesktop` is undefined.
   */
  openExternalUrl(url: string): void;
  /**
   * Push the renderer-resolved theme to the Electron main process so the
   * NSWindow appearance — traffic lights and inactive title-bar chrome —
   * follows bb's theme rather than the OS appearance. No-op on the web build
   * where `window.bbDesktop` is undefined.
   */
  setTheme(theme: BbDesktopTheme): void;
}

// --- Desktop browser surface (isolated WebContentsView host) ---

/**
 * Hard caps on attacker-influenced strings crossing the browser IPC boundary so
 * a hostile page cannot force oversized values into IPC payloads or persisted
 * (localStorage) tab state. The main process truncates to these before sending;
 * the schemas reject anything longer.
 */
export const BB_DESKTOP_BROWSER_MAX_URL_LENGTH = 4096;
export const BB_DESKTOP_BROWSER_MAX_TITLE_LENGTH = 1024;

/**
 * Pixel rect (CSS px, which equal device-independent points on macOS) of the
 * panel region the native browser view must overlay, measured by the renderer
 * against its own layout viewport. This rect is the single placement
 * authority: the renderer re-measures and pushes it whenever its layout moves
 * the panel, and the desktop main process only intersects it with the live
 * window content bounds — it never extrapolates placement from native window
 * resizes, whose size the renderer's (possibly lagging) chrome paint does not
 * yet reflect.
 */
export const bbDesktopBrowserViewBoundsSchema = z
  .object({
    x: z.number().int(),
    y: z.number().int(),
    width: z.number().int().nonnegative(),
    height: z.number().int().nonnegative(),
  })
  .strict();
export type BbDesktopBrowserViewBounds = z.infer<
  typeof bbDesktopBrowserViewBoundsSchema
>;

export interface BbDesktopBrowserViewportBounds {
  width: number;
  height: number;
}

interface ClampIntegerToRangeArgs {
  max: number;
  min: number;
  value: number;
}

export interface ClampBbDesktopBrowserViewBoundsArgs {
  bounds: BbDesktopBrowserViewBounds;
  viewport: BbDesktopBrowserViewportBounds;
}

function clampIntegerToRange(args: ClampIntegerToRangeArgs): number {
  return Math.min(Math.max(args.value, args.min), args.max);
}

export function clampBbDesktopBrowserViewBounds(
  args: ClampBbDesktopBrowserViewBoundsArgs,
): BbDesktopBrowserViewBounds {
  const viewportRight = Math.max(0, Math.round(args.viewport.width));
  const viewportBottom = Math.max(0, Math.round(args.viewport.height));
  const x = clampIntegerToRange({
    value: args.bounds.x,
    min: 0,
    max: viewportRight,
  });
  const y = clampIntegerToRange({
    value: args.bounds.y,
    min: 0,
    max: viewportBottom,
  });
  const right = clampIntegerToRange({
    value: args.bounds.x + args.bounds.width,
    min: x,
    max: viewportRight,
  });
  const bottom = clampIntegerToRange({
    value: args.bounds.y + args.bounds.height,
    min: y,
    max: viewportBottom,
  });

  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
  };
}

/**
 * Create-or-update the view for a browser tab. `url` may be empty to mean "no
 * page yet" (the renderer shows its new-tab screen and keeps the view hidden).
 *
 * Version-skew warning: the desktop shell attaches to any already-running bb
 * server that passes its health probe (no version handshake — see
 * apps/desktop/src/server-probe.ts) and loads the SPA that server serves, so
 * the renderer and the shell's main process routinely come from different
 * builds. This and the other `.strict()` browser request shapes are therefore
 * wire-frozen: adding a required field breaks old SPAs against a new shell,
 * and adding any field breaks new SPAs against an old shell's strict parser.
 * Change them only alongside an explicit capability/version negotiation in
 * the preload bridge.
 */
export const bbDesktopBrowserAttachRequestSchema = z
  .object({
    tabId: z.string().min(1),
    url: z.string().max(BB_DESKTOP_BROWSER_MAX_URL_LENGTH),
    bounds: bbDesktopBrowserViewBoundsSchema,
    visible: z.boolean(),
  })
  .strict();
export type BbDesktopBrowserAttachRequest = z.infer<
  typeof bbDesktopBrowserAttachRequestSchema
>;

export const bbDesktopBrowserNavigateRequestSchema = z
  .object({
    tabId: z.string().min(1),
    url: z.string().min(1).max(BB_DESKTOP_BROWSER_MAX_URL_LENGTH),
  })
  .strict();
export type BbDesktopBrowserNavigateRequest = z.infer<
  typeof bbDesktopBrowserNavigateRequestSchema
>;

export const bbDesktopBrowserSetBoundsRequestSchema = z
  .object({
    tabId: z.string().min(1),
    bounds: bbDesktopBrowserViewBoundsSchema,
  })
  .strict();
export type BbDesktopBrowserSetBoundsRequest = z.infer<
  typeof bbDesktopBrowserSetBoundsRequestSchema
>;

export const bbDesktopBrowserSetVisibleRequestSchema = z
  .object({
    tabId: z.string().min(1),
    visible: z.boolean(),
  })
  .strict();
export type BbDesktopBrowserSetVisibleRequest = z.infer<
  typeof bbDesktopBrowserSetVisibleRequestSchema
>;

/** Ref for tab-scoped commands with no other payload (detach/back/forward/reload/stop). */
export const bbDesktopBrowserTabRefSchema = z
  .object({
    tabId: z.string().min(1),
  })
  .strict();

/**
 * Current navigation state of a browser view, pushed main → renderer on every
 * relevant `webContents` event. A snapshot of live state — never a queue ladder.
 */
export const bbDesktopBrowserStateSchema = z
  .object({
    tabId: z.string().min(1),
    url: z.string().max(BB_DESKTOP_BROWSER_MAX_URL_LENGTH),
    title: z.string().max(BB_DESKTOP_BROWSER_MAX_TITLE_LENGTH).nullable(),
    isLoading: z.boolean(),
    canGoBack: z.boolean(),
    canGoForward: z.boolean(),
    errorText: z.string().max(BB_DESKTOP_BROWSER_MAX_TITLE_LENGTH).nullable(),
  })
  .strict();
export type BbDesktopBrowserState = z.infer<typeof bbDesktopBrowserStateSchema>;

/**
 * Request from main → renderer to open a popup (`window.open`/`target=_blank`)
 * as a new in-panel browser tab. The native OS popup window is always denied.
 */
export const bbDesktopBrowserOpenTabRequestSchema = z
  .object({
    url: z.string().min(1).max(BB_DESKTOP_BROWSER_MAX_URL_LENGTH),
  })
  .strict();
export type BbDesktopBrowserOpenTabRequest = z.infer<
  typeof bbDesktopBrowserOpenTabRequestSchema
>;

/**
 * Upper bound for a snapshot data URL. A JPEG of a full-window view on a 5K
 * display lands well under this; the cap exists so a misbehaving push can
 * never balloon renderer memory.
 */
export const BB_DESKTOP_BROWSER_MAX_SNAPSHOT_DATA_URL_LENGTH = 8_388_608;

/**
 * A transient bitmap of a browser view, pushed main → renderer at the start
 * of a native window resize burst while the native view is hidden (the
 * independently composited overlay cannot stay visually glued to the chrome
 * mid-resize). The renderer paints it inside the panel so it scales with the
 * chrome. `dataUrl: null` clears the placeholder once the resize settles and
 * the live view is shown again.
 */
export const bbDesktopBrowserSnapshotSchema = z
  .object({
    tabId: z.string().min(1),
    dataUrl: z
      .string()
      .max(BB_DESKTOP_BROWSER_MAX_SNAPSHOT_DATA_URL_LENGTH)
      .nullable(),
  })
  .strict();
export type BbDesktopBrowserSnapshot = z.infer<
  typeof bbDesktopBrowserSnapshotSchema
>;

export type BbDesktopBrowserStateHandler = (
  state: BbDesktopBrowserState,
) => void;
export type BbDesktopBrowserOpenTabHandler = (
  request: BbDesktopBrowserOpenTabRequest,
) => void;
export type BbDesktopBrowserSnapshotHandler = (
  snapshot: BbDesktopBrowserSnapshot,
) => void;
export type BbDesktopBrowserUnsubscribe = () => void;

export interface BbDesktopBrowserApi {
  /** Create (or reuse) and show the view for `tabId`, loading `url` if non-empty. */
  attach(request: BbDesktopBrowserAttachRequest): void;
  /** Destroy the view for `tabId` (tears down its `webContents`). */
  detach(tabId: string): void;
  navigate(request: BbDesktopBrowserNavigateRequest): void;
  goBack(tabId: string): void;
  goForward(tabId: string): void;
  reload(tabId: string): void;
  stop(tabId: string): void;
  setBounds(request: BbDesktopBrowserSetBoundsRequest): void;
  setVisible(request: BbDesktopBrowserSetVisibleRequest): void;
  /** Subscribe to navigation-state pushes for every view in this window. */
  onState(listener: BbDesktopBrowserStateHandler): BbDesktopBrowserUnsubscribe;
  /** Subscribe to popup requests that should open as a new in-panel browser tab. */
  onOpenTab(
    listener: BbDesktopBrowserOpenTabHandler,
  ): BbDesktopBrowserUnsubscribe;
  /**
   * Subscribe to resize-burst snapshot pushes. Optional purely for version
   * skew: the SPA routinely attaches to an older desktop shell whose preload
   * predates snapshots (see the wire-freeze note on
   * {@link bbDesktopBrowserAttachRequestSchema}); callers feature-detect and
   * fall back to the bare panel background during resizes.
   */
  onSnapshot?(
    listener: BbDesktopBrowserSnapshotHandler,
  ): BbDesktopBrowserUnsubscribe;
}

// --- Thread creation: environment + workspace discriminated unions ---

export { gitBranchNameSchema };
export type { GitBranchName };

/**
 * Pre-thread checkout intent for an unmanaged workspace. Omitting this from
 * the workspace request means "don't touch HEAD"; including it asks the
 * daemon to switch to the named branch or create a server-named branch from
 * `baseBranch` before the thread starts.
 */
export const unmanagedBranchSpecSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("existing"),
      name: gitBranchNameSchema,
    })
    .strict(),
  z
    .object({ kind: z.literal("new"), baseBranch: gitBranchNameSchema })
    .strict(),
]);
export type UnmanagedBranchSpec = z.infer<typeof unmanagedBranchSpecSchema>;

export const unmanagedWorkspaceSchema = z.object({
  type: z.literal("unmanaged"),
  path: z.string().min(1).nullable(),
  /**
   * If set, the daemon checks out this branch in the unmanaged workspace
   * before the thread starts. `existing` switches to a named branch; `new`
   * asks the server to mint a thread-scoped branch name and create it from
   * the requested base branch.
   */
  branch: unmanagedBranchSpecSchema.optional(),
});

/**
 * Identifies the base branch a managed worktree should be created from.
 * `named` carries an explicit branch name; `default` defers to the source's
 * default branch (resolved server-side so the daemon always receives a real
 * branch name).
 */
export const baseBranchSpecSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("named"), name: gitBranchNameSchema }),
  z.object({ kind: z.literal("default") }),
]);
export type BaseBranchSpec = z.infer<typeof baseBranchSpecSchema>;

export const managedWorktreeWorkspaceSchema = z.object({
  type: z.literal("managed-worktree"),
  /** Branch the new worktree should be based on. */
  baseBranch: baseBranchSpecSchema,
});

export const personalWorkspaceSchema = z.object({
  type: z.literal("personal"),
});

export const workspaceArgsSchema = z.discriminatedUnion("type", [
  unmanagedWorkspaceSchema,
  managedWorktreeWorkspaceSchema,
  personalWorkspaceSchema,
]);
export type WorkspaceArgs = z.infer<typeof workspaceArgsSchema>;

export const reuseEnvironmentSchema = z.object({
  type: z.literal("reuse"),
  environmentId: z.string().min(1),
});

export const hostEnvironmentSchema = z
  .object({
    type: z.literal("host"),
    hostId: z.string().min(1).optional(),
    workspace: workspaceArgsSchema,
  })
  .superRefine((value, ctx) => {
    if (value.workspace.type !== "personal" && value.hostId === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "hostId is required unless workspace.type is personal",
        path: ["hostId"],
      });
    }
  });

export const environmentArgsSchema = z.discriminatedUnion("type", [
  reuseEnvironmentSchema,
  hostEnvironmentSchema,
]);
export type EnvironmentArgs = z.infer<typeof environmentArgsSchema>;

export const threadCreateOriginSchema = z.enum(["app", "cli"]);
export type ThreadCreateOrigin = z.infer<typeof threadCreateOriginSchema>;

export const executionInputFieldSourceSchema = callerExecutionInputSourceSchema;
export type ExecutionInputFieldSource = CallerExecutionInputSource;

export const createExecutionInputSourcesSchema = z
  .object({
    providerId: executionInputFieldSourceSchema.optional(),
    model: executionInputFieldSourceSchema.optional(),
    serviceTier: executionInputFieldSourceSchema.optional(),
    reasoningLevel: executionInputFieldSourceSchema.optional(),
    permissionMode: executionInputFieldSourceSchema.optional(),
  })
  .strict();
export type CreateExecutionInputSources = z.infer<
  typeof createExecutionInputSourcesSchema
>;

export const existingThreadExecutionInputSourcesSchema = z
  .object({
    model: executionInputFieldSourceSchema.optional(),
    serviceTier: executionInputFieldSourceSchema.optional(),
    reasoningLevel: executionInputFieldSourceSchema.optional(),
    permissionMode: executionInputFieldSourceSchema.optional(),
  })
  .strict();
export type ExistingThreadExecutionInputSources = z.infer<
  typeof existingThreadExecutionInputSourcesSchema
>;

export const createThreadRequestSchema = z.object({
  projectId: z.string().min(1),
  providerId: z.string().min(1).optional(),
  origin: threadCreateOriginSchema,
  title: z.string().min(1).optional(),
  input: z.array(promptInputSchema).min(1),
  model: z.string().min(1).optional(),
  serviceTier: serviceTierSchema.optional(),
  reasoningLevel: reasoningLevelSchema.optional(),
  permissionMode: permissionModeSchema.optional(),
  executionInputSources: createExecutionInputSourcesSchema.optional(),
  environment: environmentArgsSchema,
  parentThreadId: z.string().min(1).optional(),
});
export type CreateThreadRequest = z.infer<typeof createThreadRequestSchema>;

const automationThreadRequestSchema = z.object({
  // Automations must choose provider/model explicitly; omitted execution
  // options may still inherit scheduled-thread defaults.
  providerId: z.string().min(1),
  title: z.string().min(1).optional(),
  input: z.array(promptInputSchema).min(1),
  model: z.string().min(1),
  serviceTier: serviceTierSchema.optional(),
  reasoningLevel: reasoningLevelSchema.optional(),
  permissionMode: permissionModeSchema.optional(),
  environment: environmentArgsSchema,
  parentThreadId: z.string().min(1).optional(),
});
export type AutomationThreadRequest = z.infer<
  typeof automationThreadRequestSchema
>;

export const automationNameSchema = z
  .string()
  .min(1)
  .max(AUTOMATION_NAME_MAX_LENGTH);
export const scheduleCronSchema = z
  .string()
  .min(1)
  .max(SCHEDULE_CRON_MAX_LENGTH);
export const scheduleNameSchema = z
  .string()
  .min(1)
  .max(SCHEDULE_NAME_MAX_LENGTH);
export const scheduleTimezoneSchema = z
  .string()
  .min(1)
  .max(SCHEDULE_TIMEZONE_MAX_LENGTH);
export const threadSchedulePromptSchema = z
  .string()
  .min(1)
  .max(THREAD_SCHEDULE_PROMPT_MAX_LENGTH);
export const automationScheduleTriggerSchema = z.object({
  triggerType: z.literal("schedule"),
  cron: scheduleCronSchema,
  timezone: scheduleTimezoneSchema,
});
export type AutomationScheduleTrigger = z.infer<
  typeof automationScheduleTriggerSchema
>;

export const scheduledThreadAutomationActionSchema = z.object({
  actionType: z.literal("scheduled-thread"),
  threadRequest: automationThreadRequestSchema,
});

export const automationTriggerSchema = z.discriminatedUnion("triggerType", [
  automationScheduleTriggerSchema,
]);

export const automationActionSchema = z.discriminatedUnion("actionType", [
  scheduledThreadAutomationActionSchema,
]);
export type AutomationAction = z.infer<typeof automationActionSchema>;

export const automationValidationIssueSchema = z.string().min(1);
export const automationValidationSchema = z.object({
  isValid: z.boolean(),
  validationIssues: z.array(automationValidationIssueSchema),
});
export type AutomationValidation = z.infer<typeof automationValidationSchema>;

export const automationSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  name: automationNameSchema,
  enabled: z.boolean(),
  trigger: automationTriggerSchema,
  action: automationActionSchema,
  autoArchive: z.boolean(),
  nextRunAt: z.number().nullable(),
  lastRunAt: z.number().nullable(),
  runCount: z.number().int().nonnegative(),
  isValid: z.boolean(),
  validationIssues: z.array(automationValidationIssueSchema),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type Automation = z.infer<typeof automationSchema>;

export const threadScheduleSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  threadId: z.string().min(1),
  name: scheduleNameSchema,
  enabled: z.boolean(),
  kind: threadScheduleKindSchema,
  cron: scheduleCronSchema,
  timezone: scheduleTimezoneSchema,
  prompt: threadSchedulePromptSchema,
  nextFireAt: z.number(),
  lastFiredAt: z.number().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type ThreadSchedule = z.infer<typeof threadScheduleSchema>;

export const automationsOverviewProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
});
export type AutomationsOverviewProject = z.infer<
  typeof automationsOverviewProjectSchema
>;

export const automationsOverviewThreadSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  title: z.string().nullable(),
  titleFallback: z.string().nullable(),
});
export type AutomationsOverviewThread = z.infer<
  typeof automationsOverviewThreadSchema
>;

export const automationsOverviewAutomationSchema = z.object({
  automation: automationSchema,
  project: automationsOverviewProjectSchema,
});
export type AutomationsOverviewAutomation = z.infer<
  typeof automationsOverviewAutomationSchema
>;

export const automationsOverviewThreadScheduleSchema = z.object({
  project: automationsOverviewProjectSchema,
  schedule: threadScheduleSchema,
  thread: automationsOverviewThreadSchema,
});
export type AutomationsOverviewThreadSchedule = z.infer<
  typeof automationsOverviewThreadScheduleSchema
>;

export const automationsOverviewResponseSchema = z.object({
  automations: z.array(automationsOverviewAutomationSchema),
  threadSchedules: z.array(automationsOverviewThreadScheduleSchema),
});
export type AutomationsOverviewResponse = z.infer<
  typeof automationsOverviewResponseSchema
>;

export const createThreadScheduleRequestSchema = z
  .object({
    name: scheduleNameSchema,
    enabled: z.boolean().optional(),
    cron: scheduleCronSchema,
    timezone: scheduleTimezoneSchema,
    prompt: threadSchedulePromptSchema,
  })
  .strict();
export type CreateThreadScheduleRequest = z.infer<
  typeof createThreadScheduleRequestSchema
>;

export const updateThreadScheduleEnabledRequestSchema = z
  .object({
    enabled: z.boolean(),
  })
  .strict();
export type UpdateThreadScheduleEnabledRequest = z.infer<
  typeof updateThreadScheduleEnabledRequestSchema
>;

export const updateThreadScheduleConfigRequestSchema = z
  .object({
    name: scheduleNameSchema,
    cron: scheduleCronSchema,
    timezone: scheduleTimezoneSchema,
    prompt: threadSchedulePromptSchema,
  })
  .partial()
  .strict()
  .refine(
    (value) =>
      value.name !== undefined ||
      value.cron !== undefined ||
      value.timezone !== undefined ||
      value.prompt !== undefined,
    "At least one field must be provided",
  );
export type UpdateThreadScheduleConfigRequest = z.infer<
  typeof updateThreadScheduleConfigRequestSchema
>;

export const updateThreadScheduleRequestSchema = z.union([
  updateThreadScheduleEnabledRequestSchema,
  updateThreadScheduleConfigRequestSchema,
]);
export type UpdateThreadScheduleRequest = z.infer<
  typeof updateThreadScheduleRequestSchema
>;

export const createAutomationRequestSchema = z.object({
  name: automationNameSchema,
  enabled: z.boolean().optional(),
  trigger: automationTriggerSchema,
  action: automationActionSchema,
  autoArchive: z.boolean().optional(),
});
export type CreateAutomationRequest = z.infer<
  typeof createAutomationRequestSchema
>;

export const updateAutomationEnabledRequestSchema = z
  .object({
    enabled: z.boolean(),
  })
  .strict();
export type UpdateAutomationEnabledRequest = z.infer<
  typeof updateAutomationEnabledRequestSchema
>;

export const updateAutomationConfigRequestSchema = z
  .object({
    name: automationNameSchema,
    trigger: automationTriggerSchema,
    action: automationActionSchema,
    autoArchive: z.boolean(),
  })
  .partial()
  .strict()
  .refine(
    (value) =>
      value.name !== undefined ||
      value.trigger !== undefined ||
      value.action !== undefined ||
      value.autoArchive !== undefined,
    "At least one field must be provided",
  );
export type UpdateAutomationConfigRequest = z.infer<
  typeof updateAutomationConfigRequestSchema
>;

export const updateAutomationRequestSchema = z.union([
  updateAutomationEnabledRequestSchema,
  updateAutomationConfigRequestSchema,
]);
export type UpdateAutomationRequest = z.infer<
  typeof updateAutomationRequestSchema
>;

export const sendMessageRequestSchema = z.object({
  input: z.array(promptInputSchema).min(1),
  model: z.string().optional(),
  serviceTier: serviceTierSchema.optional(),
  reasoningLevel: reasoningLevelSchema.optional(),
  permissionMode: permissionModeSchema.optional(),
  executionInputSources: existingThreadExecutionInputSourcesSchema.optional(),
  mode: sendMessageModeSchema,
  senderThreadId: z.string().min(1).optional(),
});
export type SendMessageRequest = z.infer<typeof sendMessageRequestSchema>;

export const sendQueuedMessageModeSchema = z.enum(["auto", "steer"]);
export type SendQueuedMessageMode = z.infer<typeof sendQueuedMessageModeSchema>;

export const createQueuedMessageRequestSchema = z.object({
  input: z.array(promptInputSchema).min(1),
  model: z.string().optional(),
  serviceTier: serviceTierSchema.optional(),
  reasoningLevel: reasoningLevelSchema.optional(),
  permissionMode: permissionModeSchema.optional(),
  executionInputSources: existingThreadExecutionInputSourcesSchema.optional(),
  senderThreadId: z.string().min(1).optional(),
});
export type CreateQueuedMessageRequest = z.infer<
  typeof createQueuedMessageRequestSchema
>;

export const sendQueuedMessageRequestSchema = z.object({
  mode: sendQueuedMessageModeSchema,
});
export type SendQueuedMessageRequest = z.infer<
  typeof sendQueuedMessageRequestSchema
>;

export const reorderQueuedMessageRequestSchema = z.object({
  previousQueuedMessageId: z.string().min(1).nullable(),
  nextQueuedMessageId: z.string().min(1).nullable(),
});
export type ReorderQueuedMessageRequest = z.infer<
  typeof reorderQueuedMessageRequestSchema
>;

export const sendQueuedMessageResponseSchema = z.object({
  ok: z.literal(true),
  queuedMessage: threadQueuedMessageSchema,
});
export type SendQueuedMessageResponse = z.infer<
  typeof sendQueuedMessageResponseSchema
>;

export const threadListResponseSchema = z.array(threadListEntrySchema);
export type ThreadListResponse = z.infer<typeof threadListResponseSchema>;

export const threadResponseSchema = threadWithRuntimeSchema;
export type ThreadResponse = z.infer<typeof threadResponseSchema>;

export const threadIncludeOptionSchema = z.enum(["environment", "host"]);
export type ThreadIncludeOption = z.infer<typeof threadIncludeOptionSchema>;

export const threadGetQuerySchema = z.object({
  include: z
    .string()
    .min(1)
    .refine(
      (value) =>
        isCommaSeparatedIncludeQueryValue({
          allowedValues: threadIncludeOptionSchema.options,
          value,
        }),
      { message: "Invalid include" },
    )
    .optional(),
});
export type ThreadGetQuery = z.infer<typeof threadGetQuerySchema>;

export const threadWithIncludesResponseSchema = threadResponseSchema.extend({
  environment: environmentSchema.nullable().optional(),
  host: hostSchema.nullable().optional(),
});
export type ThreadWithIncludesResponse = z.infer<
  typeof threadWithIncludesResponseSchema
>;

export const threadPendingInteractionsResponseSchema = z.array(
  pendingInteractionSchema,
);
export type ThreadPendingInteractionsResponse = z.infer<
  typeof threadPendingInteractionsResponseSchema
>;

export const resolvePendingInteractionRequestSchema =
  pendingInteractionResolutionSchema;
export type ResolvePendingInteractionRequest = z.infer<
  typeof resolvePendingInteractionRequestSchema
>;

export const threadQueuedMessageListResponseSchema = z.array(
  threadQueuedMessageSchema,
);
export type ThreadQueuedMessageListResponse = z.infer<
  typeof threadQueuedMessageListResponseSchema
>;

export const threadChildSummaryResponseSchema = z.object({
  nonDeletedChildCount: z.number().int().nonnegative(),
});
export type ThreadChildSummaryResponse = z.infer<
  typeof threadChildSummaryResponseSchema
>;

export const deleteThreadRequestSchema = z.object({
  childThreadsConfirmed: z.boolean(),
});
export type DeleteThreadRequest = z.infer<typeof deleteThreadRequestSchema>;

export const updateThreadRequestSchema = z
  .object({
    title: z.string().min(1).nullable(),
    parentThreadId: z.string().min(1).nullable(),
    // Sticky thread-level execution overrides applied on the next turn. `null`
    // clears the override; an omitted field is left unchanged. Settable
    // together or independently.
    model: z.string().min(1).nullable(),
    reasoningLevel: reasoningLevelSchema.nullable(),
  })
  .partial()
  .refine(
    (value) =>
      value.title !== undefined ||
      value.parentThreadId !== undefined ||
      value.model !== undefined ||
      value.reasoningLevel !== undefined,
    "At least one field must be provided",
  );
export type UpdateThreadRequest = z.infer<typeof updateThreadRequestSchema>;

export const environmentNameSchema = z.string().trim().min(1).max(80);

export const updateEnvironmentRequestSchema = z
  .object({
    // Omitted fields are left unchanged. `null` clears the configured value.
    mergeBaseBranch: gitBranchNameSchema.nullable(),
    name: environmentNameSchema.nullable(),
  })
  .partial()
  .refine(
    (value) => value.mergeBaseBranch !== undefined || value.name !== undefined,
    "At least one field must be provided",
  );
export type UpdateEnvironmentRequest = z.infer<
  typeof updateEnvironmentRequestSchema
>;

const localProjectPathRequestSchema = z
  .string()
  .trim()
  .min(1)
  .transform(normalizeProjectPathInput)
  .superRefine((path, ctx) => {
    const validationMessage = getProjectPathValidationMessage(path);
    if (!validationMessage) {
      return;
    }

    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: validationMessage,
    });
  });

const createLocalPathProjectSourceRequestSchema = z
  .object({
    hostId: z.string().min(1),
    type: z.literal("local_path"),
    path: localProjectPathRequestSchema,
  })
  .strict();

export const createProjectSourceRequestSchema =
  createLocalPathProjectSourceRequestSchema;
export type CreateProjectSourceRequest = z.infer<
  typeof createProjectSourceRequestSchema
>;

export const createProjectRequestSchema = z.object({
  name: z.string().min(1),
  source: createProjectSourceRequestSchema,
});
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;

export const reorderProjectRequestSchema = z.object({
  previousProjectId: z.string().min(1).nullable(),
  nextProjectId: z.string().min(1).nullable(),
});
export type ReorderProjectRequest = z.infer<typeof reorderProjectRequestSchema>;

export const reorderPinnedThreadRequestSchema = z.object({
  previousThreadId: z.string().min(1).nullable(),
  nextThreadId: z.string().min(1).nullable(),
});
export type ReorderPinnedThreadRequest = z.infer<
  typeof reorderPinnedThreadRequestSchema
>;

export const projectListIncludeOptionSchema = z.enum(["threads"]);
export type ProjectListIncludeOption = z.infer<
  typeof projectListIncludeOptionSchema
>;

export const projectListQuerySchema = z.object({
  include: z
    .string()
    .min(1)
    .refine(
      (value) =>
        isCommaSeparatedIncludeQueryValue({
          allowedValues: projectListIncludeOptionSchema.options,
          value,
        }),
      { message: "Invalid include" },
    )
    .optional(),
});
export type ProjectListQuery = z.infer<typeof projectListQuerySchema>;

export const projectFilesQuerySchema = z.object({
  query: z.string().min(1).max(FILE_LIST_QUERY_MAX_LENGTH).optional(),
  limit: z.string().regex(/^\d+$/).optional(),
  /**
   * Required + nullable. Pass an environment id to scope the file list to that
   * environment's workspace (e.g. a worktree); pass `null` to use the project's
   * default source. Encoded as the empty string on the wire because URL query
   * params can't represent JSON null directly.
   */
  environmentId: z.preprocess(
    (value) => (value === "" ? null : value),
    z.string().min(1).nullable(),
  ),
});
export type ProjectFilesQuery = z.infer<typeof projectFilesQuerySchema>;

export const pathListIncludeQueryValueSchema = z.enum(["true", "false"]);
export type PathListIncludeQueryValue = z.infer<
  typeof pathListIncludeQueryValueSchema
>;

export const projectPathsQuerySchema = projectFilesQuerySchema.extend({
  includeFiles: pathListIncludeQueryValueSchema,
  includeDirectories: pathListIncludeQueryValueSchema,
});
export type ProjectPathsQuery = z.infer<typeof projectPathsQuerySchema>;

/**
 * Query for searching paths in an environment's workspace. Unlike the
 * project-scoped variant this needs no `environmentId` — the environment is
 * the route param — and is project-agnostic, so it works for projectless
 * (personal) environments too.
 */
export const environmentPathsQuerySchema = z.object({
  query: z.string().min(1).max(FILE_LIST_QUERY_MAX_LENGTH).optional(),
  limit: z.string().regex(/^\d+$/).optional(),
  includeFiles: pathListIncludeQueryValueSchema,
  includeDirectories: pathListIncludeQueryValueSchema,
});
export type EnvironmentPathsQuery = z.infer<typeof environmentPathsQuerySchema>;

export const branchListQuerySchema = z.object({
  query: z.string().min(1).max(BRANCH_LIST_QUERY_MAX_LENGTH).optional(),
  limit: z.string().regex(/^\d+$/).optional(),
});
export type BranchListQuery = z.infer<typeof branchListQuerySchema>;

export const environmentDiffBranchesQuerySchema = branchListQuerySchema.extend({
  selectedBranch: gitBranchNameSchema.optional(),
});
export type EnvironmentDiffBranchesQuery = z.infer<
  typeof environmentDiffBranchesQuerySchema
>;

export const projectBranchesQuerySchema = branchListQuerySchema.extend({
  hostId: z.string().min(1),
  selectedBranch: gitBranchNameSchema.optional(),
});
export type ProjectBranchesQuery = z.infer<typeof projectBranchesQuerySchema>;

export const projectBranchesResponseSchema = projectSourceCheckoutSchema;
export type ProjectBranchesResponse = z.infer<
  typeof projectBranchesResponseSchema
>;

export const environmentDiffBranchesResponseSchema = z.object({
  /** Local branches under refs/heads, safe for checkout and write targets. */
  branches: z.array(z.string()),
  branchesTruncated: z.boolean(),
  /** Remote-tracking branches under refs/remotes, for base/diff selection. */
  remoteBranches: z.array(z.string()),
  remoteBranchesTruncated: z.boolean(),
  selectedBranch: gitBranchRefClassificationSchema.nullable(),
});
export type EnvironmentDiffBranchesResponse = z.infer<
  typeof environmentDiffBranchesResponseSchema
>;

export const projectAttachmentContentQuerySchema = z.object({
  path: z.string().min(1),
});
export type ProjectAttachmentContentQuery = z.infer<
  typeof projectAttachmentContentQuerySchema
>;

export const projectDefaultExecutionOptionsQuerySchema = z.object({});
export type ProjectDefaultExecutionOptionsQuery = z.infer<
  typeof projectDefaultExecutionOptionsQuerySchema
>;

export const promptHistoryQuerySchema = z
  .object({
    limit: z.string().regex(/^\d+$/),
  })
  .partial();
export type PromptHistoryQuery = z.infer<typeof promptHistoryQuerySchema>;

export const promptHistoryResponseSchema = z.array(promptHistoryEntrySchema);
export type PromptHistoryResponse = z.infer<typeof promptHistoryResponseSchema>;

export const systemExecutionOptionsModelLoadErrorCodeSchema = z.enum([
  "missing_executable",
  "timeout",
  "failed",
]);
export type SystemExecutionOptionsModelLoadErrorCode = z.infer<
  typeof systemExecutionOptionsModelLoadErrorCodeSchema
>;

export const systemExecutionOptionsModelLoadErrorSchema = z.object({
  providerId: z.string().min(1),
  code: systemExecutionOptionsModelLoadErrorCodeSchema,
});
export type SystemExecutionOptionsModelLoadError = z.infer<
  typeof systemExecutionOptionsModelLoadErrorSchema
>;

export const systemExecutionOptionsResponseSchema = z.object({
  providers: z.array(providerInfoSchema),
  /** Active models offered as fresh picker choices. */
  models: z.array(availableModelSchema),
  /**
   * Retired/legacy models the picker no longer offers but that may still be
   * the user's stored selection. Clients prepend the matching entry when a
   * stored model isn't in `models`, so deprecation doesn't silently rewrite
   * the user's choice.
   */
  selectedOnlyModels: z.array(availableModelSchema),
  /**
   * Error for the provider whose model list was requested. Null means the
   * lookup completed or no provider was available to query.
   */
  modelLoadError: systemExecutionOptionsModelLoadErrorSchema.nullable(),
});
export type SystemExecutionOptionsResponse = z.infer<
  typeof systemExecutionOptionsResponseSchema
>;

export const threadComposerBootstrapResponseSchema = z.object({
  defaultExecutionOptions: resolvedThreadExecutionOptionsSchema.nullable(),
  queuedMessages: threadQueuedMessageListResponseSchema,
  /**
   * Provider/model options for the thread's composer picker. Null when the
   * server deliberately skips resolving them — for archived or environment-less
   * threads, whose follow-up composer locks the provider and needs no list.
   * Null means "not resolved", distinct from a resolved-but-empty list, so
   * callers must not treat it as a system-wide answer (e.g. don't seed the
   * shared system-execution-options cache with it).
   */
  executionOptions: systemExecutionOptionsResponseSchema.nullable(),
  pendingInteractions: threadPendingInteractionsResponseSchema,
  promptHistory: promptHistoryResponseSchema,
});
export type ThreadComposerBootstrapResponse = z.infer<
  typeof threadComposerBootstrapResponseSchema
>;

const mergeBaseBranchQuerySchema = z
  .string("A merge base branch is required")
  .pipe(gitBranchNameSchema);

export const environmentStatusQuerySchema = z.object({
  mergeBaseBranch: mergeBaseBranchQuerySchema.optional(),
});
export type EnvironmentStatusQuery = z.infer<
  typeof environmentStatusQuerySchema
>;

export const environmentDiffQuerySchema = z.discriminatedUnion("target", [
  z.object({
    target: z.literal("uncommitted"),
  }),
  z.object({
    target: z.literal("branch_committed"),
    mergeBaseBranch: mergeBaseBranchQuerySchema,
  }),
  z.object({
    target: z.literal("all"),
    mergeBaseBranch: mergeBaseBranchQuerySchema,
  }),
  z.object({
    target: z.literal("commit"),
    sha: z.string().regex(/^[0-9a-f]{4,40}$/iu),
  }),
]);
export type EnvironmentDiffQuery = z.infer<typeof environmentDiffQuerySchema>;

const diffFileSideSchema = z.enum(["old", "new"]);

const mergeBaseRefQuerySchema = z.string().regex(/^[0-9a-f]{4,40}$/iu);

/**
 * Query for fetching a single file's contents at one side of a diff target.
 * Used by the diff card to populate `<FileDiff>`'s `oldFile`/`newFile` props
 * so `@pierre/diffs` can render expand-context buttons between hunks.
 *
 * For `branch_committed` / `all`, callers pass the resolved merge-base SHA
 * (`mergeBaseRef`, surfaced by `workspace.diff`) rather than the branch name
 * — the diff itself was computed against that SHA, so reading the old side
 * from the same SHA keeps the file content aligned with the hunk line
 * numbers. Reading from the branch tip is wrong whenever the branch has
 * moved past the merge-base since the file existed there.
 */
export const environmentDiffFileQuerySchema = z.discriminatedUnion("target", [
  z.object({
    target: z.literal("uncommitted"),
    path: z.string().min(1),
    side: diffFileSideSchema,
  }),
  z.object({
    target: z.literal("branch_committed"),
    mergeBaseRef: mergeBaseRefQuerySchema,
    path: z.string().min(1),
    side: diffFileSideSchema,
  }),
  z.object({
    target: z.literal("all"),
    mergeBaseRef: mergeBaseRefQuerySchema,
    path: z.string().min(1),
    side: diffFileSideSchema,
  }),
  z.object({
    target: z.literal("commit"),
    sha: z.string().regex(/^[0-9a-f]{4,40}$/iu),
    path: z.string().min(1),
    side: diffFileSideSchema,
  }),
]);
export type EnvironmentDiffFileQuery = z.infer<
  typeof environmentDiffFileQuerySchema
>;

export const environmentDiffFileResponseSchema = z.object({
  path: z.string(),
  content: z.string(),
  contentEncoding: z.enum(["base64", "utf8"]),
  mimeType: z.string().optional(),
  sizeBytes: z.number().int().nonnegative(),
});
export type EnvironmentDiffFileResponse = z.infer<
  typeof environmentDiffFileResponseSchema
>;

export const environmentArchiveThreadsResponseSchema = z.object({
  ok: z.literal(true),
  archivedThreadIds: z.array(z.string().min(1)),
});
export type EnvironmentArchiveThreadsResponse = z.infer<
  typeof environmentArchiveThreadsResponseSchema
>;

export const threadArchiveAllResponseSchema = z.object({
  ok: z.literal(true),
  archivedThreadIds: z.array(z.string().min(1)),
});
export type ThreadArchiveAllResponse = z.infer<
  typeof threadArchiveAllResponseSchema
>;

export const threadListQuerySchema = z.object({
  projectId: z.string().min(1).optional(),
  parentThreadId: z.string().min(1).optional(),
  archived: z.enum(["true", "false"]).optional(),
  /** Filter by parent thread presence: "true" means child threads; "false" means root threads. */
  hasParent: z.enum(["true", "false"]).optional(),
  limit: z.string().regex(/^\d+$/).optional(),
  offset: z.string().regex(/^\d+$/).optional(),
});
export type ThreadListQuery = z.infer<typeof threadListQuerySchema>;

export const timelinePaginationCursorSchema = z
  .object({
    anchorSeq: z.number().int().positive(),
    anchorId: z.string().min(1),
  })
  .strict();
export type TimelinePaginationCursor = z.infer<
  typeof timelinePaginationCursorSchema
>;

export const timelinePageMetadataSchema = z
  .object({
    kind: z.enum(["latest", "older"]),
    segmentLimit: z.number().int().positive(),
    returnedSegmentCount: z.number().int().nonnegative(),
    hasOlderRows: z.boolean(),
    olderCursor: timelinePaginationCursorSchema.nullable(),
  })
  .strict();

export const threadTimelineQuerySchema = z
  .object({
    includeNestedRows: z.enum(["true", "false"]),
    segmentLimit: z.string().regex(/^\d+$/),
    beforeAnchorSeq: z.string().regex(/^[1-9]\d*$/),
    beforeAnchorId: z.string().min(1),
    /**
     * When `"true"`, the response omits row generation and returns
     * `rows: []` with the tail-only fields (`activeThinking`, `pendingTodos`,
     * `contextWindowUsage`) populated normally. Used by the CLI to read
     * tail state without paying for the full row payload on every
     * `bb status` invocation. Implies `latest` page semantics.
     */
    summaryOnly: z.enum(["true", "false"]),
  })
  .partial()
  .superRefine((query, context) => {
    const hasBeforeAnchorSeq = query.beforeAnchorSeq !== undefined;
    const hasBeforeAnchorId = query.beforeAnchorId !== undefined;

    if (hasBeforeAnchorSeq === hasBeforeAnchorId) {
      return;
    }

    context.addIssue({
      code: "custom",
      message: "beforeAnchorSeq and beforeAnchorId must be provided together",
      path: hasBeforeAnchorSeq ? ["beforeAnchorId"] : ["beforeAnchorSeq"],
    });
  });
export type ThreadTimelineQuery = z.infer<typeof threadTimelineQuerySchema>;

export const timelineTurnSummaryDetailsQuerySchema = z.object({
  turnId: z.string().min(1),
  sourceSeqStart: z.string().regex(/^\d+$/),
  sourceSeqEnd: z.string().regex(/^\d+$/),
});
export type TimelineTurnSummaryDetailsQuery = z.infer<
  typeof timelineTurnSummaryDetailsQuerySchema
>;

export const threadEventsQuerySchema = z
  .object({
    afterSeq: z.string().regex(/^\d+$/),
    limit: z.string().regex(/^\d+$/),
  })
  .partial();
export type ThreadEventsQuery = z.infer<typeof threadEventsQuerySchema>;

export const threadEventWaitQuerySchema = z.object({
  type: z.string().min(1),
  afterSeq: z.string().regex(/^\d+$/).optional(),
  waitMs: z.string().regex(/^\d+$/).optional(),
});
export type ThreadEventWaitQuery = z.infer<typeof threadEventWaitQuerySchema>;

export const threadStorageFilesQuerySchema = z
  .object({
    query: z.string().min(1).max(FILE_LIST_QUERY_MAX_LENGTH),
    limit: z.string().regex(/^\d+$/),
  })
  .partial();
export type ThreadStorageFilesQuery = z.infer<
  typeof threadStorageFilesQuerySchema
>;

export const threadStoragePathsQuerySchema =
  threadStorageFilesQuerySchema.extend({
    includeFiles: pathListIncludeQueryValueSchema,
    includeDirectories: pathListIncludeQueryValueSchema,
  });
export type ThreadStoragePathsQuery = z.infer<
  typeof threadStoragePathsQuerySchema
>;

export const threadStorageContentQuerySchema = z.object({
  path: z.string().min(1),
});
export type ThreadStorageContentQuery = z.infer<
  typeof threadStorageContentQuerySchema
>;

export const threadHostFileContentQuerySchema = z.object({
  path: z.string().min(1),
});
export type ThreadHostFileContentQuery = z.infer<
  typeof threadHostFileContentQuerySchema
>;

// Keep app path limits in sync with packages/domain/src/apps.ts and the
// injected app client validator in app-client-script.ts.
const appEntryPathSegmentPattern = /^[A-Za-z0-9._-]{1,120}$/u;

function isValidAppEntryPath(value: string): boolean {
  if (
    value.length === 0 ||
    value.length > 512 ||
    value.includes("\0") ||
    value.includes("\\") ||
    value.startsWith("/") ||
    value.endsWith("/")
  ) {
    return false;
  }

  const segments = value.split("/");
  return segments.every(
    (segment) =>
      segment !== "." &&
      segment !== ".." &&
      !segment.startsWith(".") &&
      appEntryPathSegmentPattern.test(segment),
  );
}

export const appIconNameValues = [
  "AlertCircle",
  "AlertTriangle",
  "AlignLeft",
  "Archive",
  "ArchiveRestore",
  "ArrowDown",
  "ArrowRight",
  "ArrowUp",
  "AudioLines",
  "Check",
  "ChevronDown",
  "ChevronLeft",
  "ChevronRight",
  "ChevronUp",
  "ChevronsDown",
  "ChevronsUp",
  "Circle",
  "CircleCheck",
  "CircleDashed",
  "CircleX",
  "Columns2",
  "Container",
  "Copy",
  "CornerDownLeft",
  "CornerDownRight",
  "Edit",
  "ExternalLink",
  "FileDiff",
  "File",
  "FileQuestion",
  "FileX2",
  "Folder",
  "FolderOpen",
  "FolderMinus",
  "FolderPlus",
  "GitBranch",
  "GitMerge",
  "GridView",
  "Info",
  "Laptop",
  "ListTodo",
  "Maximize2",
  "MessageSquarePlus",
  "MessageSquare",
  "Mic",
  "Minimize2",
  "MoreHorizontal",
  "PanelBottom",
  "PanelLeft",
  "PanelRight",
  "Paperclip",
  "Plus",
  "RotateCcw",
  "Rows2",
  "Search",
  "Settings",
  "Spinner",
  "Square",
  "Terminal",
  "Trash2",
  "UserRound",
  "UserRoundPlus",
  "X",
  "Zap",
] as const;
export const appIconNameSchema = z.enum(appIconNameValues);

export const appEntryKindSchema = z.enum(["html", "md"]);

export const appEntryPathSchema = z
  .string()
  .refine(isValidAppEntryPath, "Invalid app entry path");

export const appEntrySchema = z
  .object({
    path: appEntryPathSchema,
    kind: appEntryKindSchema,
  })
  .strict();
export type AppEntry = z.infer<typeof appEntrySchema>;

/**
 * Inert reserved metadata. Capabilities are NOT enforced anywhere: every
 * served app page receives the full `window.bb` runtime regardless of what
 * the manifest declares (app iframes are same-origin with the public API, so
 * a manifest gate was never a security boundary). The field stays in the
 * strict manifest schema so existing manifests on disk that declare it keep
 * loading; it is echoed verbatim in app summaries.
 */
export const appCapabilitySchema = z.enum(["data", "message"]);
export type AppCapability = z.infer<typeof appCapabilitySchema>;

const appDisplayNameSchema = z.string().max(80);

export const appManifestSchema = z
  .object({
    manifestVersion: z.literal(1).default(1),
    id: applicationIdSchema,
    name: appDisplayNameSchema.optional(),
    icon: appIconNameSchema.optional(),
    entry: appEntryPathSchema.optional(),
    /** Inert reserved metadata — see {@link appCapabilitySchema}. */
    capabilities: z.array(appCapabilitySchema).default([]),
  })
  .strict()
  .transform((manifest) => ({
    ...manifest,
    name:
      manifest.name === undefined || manifest.name.trim().length === 0
        ? manifest.id
        : manifest.name,
  }));
export type AppManifest = z.infer<typeof appManifestSchema>;

export const appIconSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("builtin"),
      name: appIconNameSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("logo"),
      url: z.string().min(1),
    })
    .strict(),
]);
export type AppIcon = z.infer<typeof appIconSchema>;

/**
 * Provenance of an externally sourced app. `null` means the app is locally
 * managed (created or edited in place, not tracked against an app source).
 */
export const appSourceRefSchema = z
  .object({
    name: appSourceNameSchema,
    commitSha: z.string().min(1),
  })
  .strict();
export type AppSourceRef = z.infer<typeof appSourceRefSchema>;

export const appSummarySchema = z
  .object({
    applicationId: applicationIdSchema,
    name: z.string().min(1).max(80),
    entry: appEntrySchema,
    capabilities: z.array(appCapabilitySchema),
    icon: appIconSchema,
    source: appSourceRefSchema.nullable(),
  })
  .strict();
export type AppSummary = z.infer<typeof appSummarySchema>;

export const appDetailSchema = appSummarySchema
  .extend({
    appsRootPath: z.string().min(1),
    appRootPath: z.string().min(1),
    appDataPath: z.string().min(1),
  })
  .strict();
export type AppDetail = z.infer<typeof appDetailSchema>;

export const createAppRequestSchema = z
  .object({
    applicationId: applicationIdSchema.optional(),
    name: appDisplayNameSchema.optional(),
  })
  .strict()
  .superRefine((request, context) => {
    const hasName =
      request.name !== undefined && request.name.trim().length > 0;
    if (request.applicationId === undefined && !hasName) {
      context.addIssue({
        code: "custom",
        message: "Provide applicationId or name",
      });
    }
  });
export type CreateAppRequest = z.infer<typeof createAppRequestSchema>;

/**
 * A git remote URL or local path. Rejecting a leading `-` keeps the value out
 * of git's option namespace: passed in an argv position git scans for flags, a
 * `-`-prefixed value could be parsed as an option (e.g. an injected
 * `--upload-pack`). No real origin or git ref begins with a dash.
 */
export const appSourceOriginSchema = z
  .string()
  .min(1)
  .refine((value) => !value.startsWith("-"), "Origin cannot begin with '-'");

/** A branch, tag, or commit pin. Rejects option-like values — see {@link appSourceOriginSchema}. */
export const appSourceGitRefSchema = z
  .string()
  .min(1)
  .refine((value) => !value.startsWith("-"), "Ref cannot begin with '-'");

/**
 * User intent for one app source: a git repo (or local path) whose top-level
 * directories containing a valid manifest.json are installed as global apps.
 * `ref: null` tracks the remote default branch; otherwise a branch, tag, or
 * commit pin.
 */
export const appSourceConfigSchema = z
  .object({
    name: appSourceNameSchema,
    origin: appSourceOriginSchema,
    ref: appSourceGitRefSchema.nullable(),
  })
  .strict();
export type AppSourceConfig = z.infer<typeof appSourceConfigSchema>;

/**
 * Per-app outcome of the latest sync. `installed` apps match the source;
 * `modified` apps have local edits and are never overwritten without force;
 * `conflict` ids are owned by a local app or another source; `invalid` apps
 * failed manifest validation in the source checkout.
 */
export const appSourceAppStatusSchema = z.enum([
  "installed",
  "modified",
  "conflict",
  "invalid",
]);
export type AppSourceAppStatus = z.infer<typeof appSourceAppStatusSchema>;

export const appSourceAppStateSchema = z
  .object({
    applicationId: applicationIdSchema,
    status: appSourceAppStatusSchema,
    error: z.string().nullable(),
  })
  .strict();
export type AppSourceAppState = z.infer<typeof appSourceAppStateSchema>;

/**
 * Machine-owned sync progress, persisted per source and rewritten whole on
 * every sync. `lastCommitSha`/`lastSyncedAt` describe the last successful
 * sync and survive failed attempts; `lastError` is null after a success.
 */
export const appSourceSyncStateSchema = z
  .object({
    lastSyncStartedAt: isoUtcDateTimeSchema.nullable(),
    lastSyncedAt: isoUtcDateTimeSchema.nullable(),
    lastCommitSha: z.string().min(1).nullable(),
    lastError: z.string().nullable(),
    apps: z.array(appSourceAppStateSchema),
  })
  .strict();
export type AppSourceSyncState = z.infer<typeof appSourceSyncStateSchema>;

/**
 * Public per-source status: config + sync progress, minus the internal-only
 * `lastSyncStartedAt` (a progress marker no client consumes).
 */
export const appSourceStatusSchema = appSourceConfigSchema
  .extend({
    ...appSourceSyncStateSchema.omit({ lastSyncStartedAt: true }).shape,
    syncing: z.boolean(),
  })
  .strict();
export type AppSourceStatus = z.infer<typeof appSourceStatusSchema>;

export const addAppSourceRequestSchema = z
  .object({
    origin: appSourceOriginSchema,
    /** Absent: derived from the origin's trailing repo name. */
    name: appSourceNameSchema.optional(),
    /** Absent: track the remote default branch. */
    ref: appSourceGitRefSchema.optional(),
  })
  .strict();
export type AddAppSourceRequest = z.infer<typeof addAppSourceRequestSchema>;

export const syncAppSourceRequestSchema = z
  .object({
    /** Re-materializes diverged apps, discarding their local edits. */
    force: z.boolean(),
  })
  .strict();
export type SyncAppSourceRequest = z.infer<typeof syncAppSourceRequestSchema>;

export const appDataEntrySchema = z
  .object({
    path: appDataPathSchema,
    value: jsonValueSchema,
    version: z.string().min(1),
    sizeBytes: z.number().int().nonnegative(),
    modifiedAtMs: z.number().nonnegative(),
  })
  .strict();
export type AppDataEntry = z.infer<typeof appDataEntrySchema>;

export const appDataReadResponseSchema = appDataEntrySchema;
export type AppDataReadResponse = z.infer<typeof appDataReadResponseSchema>;

export const appDataListQuerySchema = z
  .object({
    prefix: appDataPathSchema.or(z.literal("")),
  })
  .partial();
export type AppDataListQuery = z.infer<typeof appDataListQuerySchema>;

export const appDataListResponseSchema = z
  .object({
    entries: z.array(appDataEntrySchema),
  })
  .strict();
export type AppDataListResponse = z.infer<typeof appDataListResponseSchema>;

export const appDataWriteRequestSchema = z
  .object({
    value: jsonValueSchema,
  })
  .strict();
export type AppDataWriteRequest = z.infer<typeof appDataWriteRequestSchema>;

export const appMessageRequestSchema = z
  .object({
    payload: jsonValueSchema,
    appSessionToken: z
      .string()
      .regex(/^appsess_[A-Za-z0-9_-]+$/u)
      .optional(),
    targetThreadId: z.string().min(1).optional(),
  })
  .strict();
export type AppMessageRequest = z.infer<typeof appMessageRequestSchema>;

export const appDataChangedBroadcastMessageSchema = z
  .object({
    type: z.literal("app-data.changed"),
    applicationId: applicationIdSchema,
    path: appDataPathSchema,
    value: jsonValueSchema.nullable(),
    deleted: z.boolean(),
    version: z.string().min(1).nullable(),
  })
  .strict();

export const appDataResyncBroadcastMessageSchema = z
  .object({
    type: z.literal("app-data.resync"),
    applicationId: applicationIdSchema,
  })
  .strict();

export const appDataBroadcastMessageSchema = z.discriminatedUnion("type", [
  appDataChangedBroadcastMessageSchema,
  appDataResyncBroadcastMessageSchema,
]);
export type AppDataBroadcastMessage = z.infer<
  typeof appDataBroadcastMessageSchema
>;

export const serverMessageSchema = z.union([
  changedMessageSchema,
  appDataBroadcastMessageSchema,
]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;

const appDataChangedBroadcastMessageLenientSchema = z.object({
  type: z.literal("app-data.changed"),
  applicationId: applicationIdSchema,
  path: appDataPathSchema,
  value: jsonValueSchema.nullable(),
  deleted: z.boolean(),
  version: z.string().min(1).nullable(),
});

const appDataResyncBroadcastMessageLenientSchema = z.object({
  type: z.literal("app-data.resync"),
  applicationId: applicationIdSchema,
});

/**
 * Lenient counterpart of {@link serverMessageSchema} for INBOUND parsing on
 * clients. The strict schema guards the server's outgoing boundary; clients
 * (SDK consumers, the web app) may be older than the server they talk to, so
 * they strip unknown fields and filter unknown change kinds instead of
 * dropping whole messages on additive server changes. Output stays assignable
 * to {@link ServerMessage}.
 */
export const serverMessageLenientSchema = z.union([
  changedMessageLenientSchema,
  appDataChangedBroadcastMessageLenientSchema,
  appDataResyncBroadcastMessageLenientSchema,
]);

export interface BbDataEntry {
  path: AppDataPath;
  value: JsonValue;
}

export interface BbDataReadArgs {
  path: AppDataPath;
}

export interface BbDataWriteArgs extends BbDataReadArgs {
  value: JsonValue;
}

export interface BbDataDeleteArgs extends BbDataReadArgs {}

export interface BbDataListArgs {
  prefix?: AppDataPath | "";
}

export interface BbDataChangeEvent {
  path: AppDataPath;
  value: JsonValue | undefined;
  deleted: boolean;
}

export type BbDataChangeCallback = (event: BbDataChangeEvent) => void;

export interface BbDataOnChangeArgs {
  callback: BbDataChangeCallback;
  prefix?: AppDataPath | "";
}

export interface BbData {
  entries(args?: BbDataListArgs): Promise<AppDataEntry[]>;
  read(args: BbDataReadArgs): Promise<JsonValue | undefined>;
  write(args: BbDataWriteArgs): Promise<void>;
  delete(args: BbDataDeleteArgs): Promise<void>;
  list(args?: BbDataListArgs): Promise<BbDataEntry[]>;
  onChange(args: BbDataOnChangeArgs): () => void;
}

export interface BbMessageSendArgs {
  payload: JsonValue;
  targetThreadId?: string;
}

export interface BbMessage {
  send(args: BbMessageSendArgs): Promise<void>;
}

/**
 * Contract for the `window.bb` runtime that the server injects into served
 * app pages. The injected object is the full SDK surface — `@bb/sdk`'s
 * `InjectedAppWindowBb` (app-window.ts) is the source of truth and declares
 * the realtime `on(...)` surface in addition to the fields here; this type
 * mirrors the app-facing core so contract consumers can type `window.bb`
 * without depending on `@bb/sdk`. The runtime always knows which app it
 * serves, so both id fields are required; `window.bb` itself is optional
 * because pages outside the app iframe never receive the runtime.
 */
export interface Bb {
  /** @deprecated Alias of `applicationId`. */
  appId: ApplicationId;
  applicationId: ApplicationId;
  data: BbData;
  message: BbMessage;
}

declare global {
  interface Window {
    bb?: Bb;
  }
}

export const systemExecutionOptionsQuerySchema = z
  .object({
    providerId: z.string().min(1),
    hostId: z.string().min(1),
    environmentId: z.string().min(1),
  })
  .partial();
export type SystemExecutionOptionsQuery = z.infer<
  typeof systemExecutionOptionsQuerySchema
>;

export const systemProvidersQuerySchema = z
  .object({
    hostId: z.string().min(1),
    environmentId: z.string().min(1),
  })
  .partial();
export type SystemProvidersQuery = z.infer<typeof systemProvidersQuerySchema>;

export interface ProjectAttachmentUploadForm {
  [key: string]: string | Blob;
}

export interface SystemVoiceTranscriptionForm {
  [key: string]: string | Blob;
}

export const updateProjectRequestSchema = z
  .object({
    name: z.string().min(1),
  })
  .partial()
  .refine(
    (value) => value.name !== undefined,
    "At least one field must be provided",
  );
export type UpdateProjectRequest = z.infer<typeof updateProjectRequestSchema>;

export const updateProjectSourceRequestSchema = z
  .object({
    type: z.literal("local_path"),
    path: localProjectPathRequestSchema.optional(),
    isDefault: z.literal(true).optional(),
  })
  .strict()
  .refine(
    (value) => value.path !== undefined || value.isDefault !== undefined,
    "At least one field besides type must be provided",
  );
export type UpdateProjectSourceRequest = z.infer<
  typeof updateProjectSourceRequestSchema
>;

export const environmentActionTypeSchema = z.enum(["commit", "squash_merge"]);

export const squashMergeOptionsSchema = z
  .object({
    mergeBaseBranch: gitBranchNameSchema,
  })
  .strict();
export type SquashMergeOptions = z.infer<typeof squashMergeOptionsSchema>;

export const environmentActionRequestSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("commit"),
    })
    .strict(),
  z
    .object({
      action: z.literal("squash_merge"),
      options: squashMergeOptionsSchema,
    })
    .strict(),
]);
export type EnvironmentActionRequest = z.infer<
  typeof environmentActionRequestSchema
>;

export const commitActionResponseSchema = z.object({
  ok: z.literal(true),
  action: z.literal("commit"),
  message: z.string().min(1),
  commitSha: z.string().min(1),
  commitSubject: z.string().min(1),
});
export type CommitActionResponse = z.infer<typeof commitActionResponseSchema>;

export const squashMergeActionResponseSchema = z.object({
  ok: z.literal(true),
  action: z.literal("squash_merge"),
  merged: z.boolean(),
  message: z.string().min(1),
  commitSha: z.string().min(1),
  commitSubject: z.string().min(1),
});
export type SquashMergeActionResponse = z.infer<
  typeof squashMergeActionResponseSchema
>;

export const environmentActionResponseSchema = z.discriminatedUnion("action", [
  commitActionResponseSchema,
  squashMergeActionResponseSchema,
]);
export type EnvironmentActionResponse = z.infer<
  typeof environmentActionResponseSchema
>;

export const environmentActionFailureDetailsSchema = z.discriminatedUnion(
  "kind",
  [
    z.object({
      kind: z.literal("commit_failed"),
      errorMessage: z.string(),
    }),
    z.object({
      kind: z.literal("squash_merge_conflict"),
      conflictFiles: z.array(z.string()),
    }),
    z.object({
      kind: z.literal("squash_merge_commit_failed"),
      stage: z.enum(["prep_commit", "squash_commit"]),
      errorMessage: z.string(),
    }),
    z.object({
      kind: z.literal("workspace_unavailable"),
      failure: workspaceResolutionFailureSchema,
    }),
  ],
);
export type EnvironmentActionFailureDetails = z.infer<
  typeof environmentActionFailureDetailsSchema
>;

export const environmentActionApiErrorSchema = apiErrorSchema.extend({
  details: environmentActionFailureDetailsSchema.optional(),
});
export type EnvironmentActionApiError = z.infer<
  typeof environmentActionApiErrorSchema
>;

export const terminalSessionSchema = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1),
  environmentId: z.string().min(1),
  hostId: z.string().min(1),
  title: z.string().min(1),
  initialCwd: z.string().min(1),
  cols: terminalColsSchema,
  rows: terminalRowsSchema,
  status: terminalSessionStatusSchema,
  exitCode: z.number().int().nullable(),
  closeReason: terminalSessionCloseReasonSchema.nullable(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  lastUserInputAt: z.number().int().nonnegative().nullable(),
});
export type TerminalSession = z.infer<typeof terminalSessionSchema>;

export const threadTerminalListResponseSchema = z.object({
  sessions: z.array(terminalSessionSchema),
});
export type ThreadTerminalListResponse = z.infer<
  typeof threadTerminalListResponseSchema
>;

export const createThreadTerminalRequestSchema = z
  .object({
    cols: terminalColsSchema,
    rows: terminalRowsSchema,
  })
  .strict();
export type CreateThreadTerminalRequest = z.infer<
  typeof createThreadTerminalRequestSchema
>;

export const closeThreadTerminalRequestSchema = z
  .object({
    mode: z.enum(["force", "if-clean"]),
    reason: z.literal("user"),
  })
  .strict();
export type CloseThreadTerminalRequest = z.infer<
  typeof closeThreadTerminalRequestSchema
>;

export const updateThreadTerminalRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
  })
  .strict();
export type UpdateThreadTerminalRequest = z.infer<
  typeof updateThreadTerminalRequestSchema
>;

export const terminalOutputChunkSchema = z
  .object({
    seq: z.number().int().nonnegative(),
    dataBase64: terminalDataBase64Schema,
  })
  .strict();
export type TerminalOutputChunk = z.infer<typeof terminalOutputChunkSchema>;

export const terminalClientMessageSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("input"),
      dataBase64: terminalDataBase64Schema,
    })
    .strict(),
  z
    .object({
      type: z.literal("resize"),
      cols: terminalColsSchema,
      rows: terminalRowsSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("close"),
      reason: z.literal("user"),
    })
    .strict(),
  z
    .object({
      type: z.literal("ping"),
    })
    .strict(),
]);
export type TerminalClientMessage = z.infer<typeof terminalClientMessageSchema>;

export const terminalServerMessageSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("attached"),
      session: terminalSessionSchema,
      nextSeq: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      type: z.literal("output"),
      chunk: terminalOutputChunkSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("session-updated"),
      session: terminalSessionSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("exited"),
      session: terminalSessionSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("error"),
      code: z.string().min(1),
      message: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("pong"),
    })
    .strict(),
]);
export type TerminalServerMessage = z.infer<typeof terminalServerMessageSchema>;

export const timelineTurnSummaryDetailsRequestSchema = z.object({
  turnId: z.string().min(1),
  sourceSeqStart: z.number().int().nonnegative(),
  sourceSeqEnd: z.number().int().nonnegative(),
});
export type TimelineTurnSummaryDetailsRequest = z.infer<
  typeof timelineTurnSummaryDetailsRequestSchema
>;

export const timelineTurnSummaryDetailsResponseSchema = z.object({
  rows: z.array(timelineRowSchema),
});
export type TimelineTurnSummaryDetailsResponse = z.infer<
  typeof timelineTurnSummaryDetailsResponseSchema
>;

export const threadTimelineResponseSchema = z.object({
  rows: z.array(timelineRowSchema),
  activeThinking: activeThinkingSchema.nullable(),
  pendingTodos: threadTimelinePendingTodosSchema.nullable(),
  contextWindowUsage: threadContextWindowUsageSchema.optional(),
  timelinePage: timelinePageMetadataSchema,
});
export type ThreadTimelineResponse = z.infer<
  typeof threadTimelineResponseSchema
>;

// SystemProviderInfo is the same shape as ProviderInfo from domain.
// Re-export with the API-facing name for backward compatibility.
export { providerInfoSchema as systemProviderInfoSchema } from "@bb/domain";
export type { ProviderInfo as SystemProviderInfo } from "@bb/domain";

export const systemVoiceTranscriptionResponseSchema = z.object({
  text: z.string(),
});
export type SystemVoiceTranscriptionResponse = z.infer<
  typeof systemVoiceTranscriptionResponseSchema
>;

export const workspaceFileSchema = z.object({
  path: z.string(),
  name: z.string(),
});
export type WorkspaceFile = z.infer<typeof workspaceFileSchema>;

export const workspacePathEntryKindSchema = z.enum(["file", "directory"]);

export const workspacePathEntrySchema = z.object({
  kind: workspacePathEntryKindSchema,
  path: z.string(),
  name: z.string(),
  score: z.number(),
  positions: z.array(z.number().int().nonnegative()),
});
export type WorkspacePathEntry = z.infer<typeof workspacePathEntrySchema>;

export const workspaceFileListResponseSchema = z.object({
  files: z.array(workspaceFileSchema),
  truncated: z.boolean(),
});
export type WorkspaceFileListResponse = z.infer<
  typeof workspaceFileListResponseSchema
>;

export const workspacePathListResponseSchema = z.object({
  paths: z.array(workspacePathEntrySchema),
  truncated: z.boolean(),
});
export type WorkspacePathListResponse = z.infer<
  typeof workspacePathListResponseSchema
>;

/** `command` = Claude Code legacy slash command (`.claude/commands/*.md`). */
export const providerCommandSourceSchema = z.enum(["skill", "command"]);
export type ProviderCommandSource = z.infer<typeof providerCommandSourceSchema>;

export const providerCommandOriginSchema = z.enum(["project", "user"]);
export type ProviderCommandOrigin = z.infer<typeof providerCommandOriginSchema>;

export const providerCommandSchema = z.object({
  /** Invocation name, e.g. "review" or "frontend:component". */
  name: z.string(),
  source: providerCommandSourceSchema,
  origin: providerCommandOriginSchema,
  /** `null` = no description (menu falls back to the name). */
  description: z.string().nullable(),
  /** `null` = no argument hint. */
  argumentHint: z.string().nullable(),
});
export type ProviderCommand = z.infer<typeof providerCommandSchema>;

/**
 * The command typeahead menu's visual sections, top-to-bottom: skills first,
 * then Claude Code's legacy project commands, then user commands. This single
 * ordered list is the one source of truth for both the server's flat sort
 * (which buckets the response in this order) and the composer menu's section
 * grouping, so keyboard navigation (which walks the flat order) can never
 * disagree with what the user sees.
 */
export const PROVIDER_COMMAND_SECTIONS = [
  "skill",
  "project-command",
  "user-command",
] as const;
export type ProviderCommandSection = (typeof PROVIDER_COMMAND_SECTIONS)[number];

/**
 * Derive the menu section a command belongs to from its source + origin:
 * `skill` source → the skills section; otherwise the legacy `command` source
 * splits by origin into the project- and user-command sections.
 */
export function providerCommandSection(cmd: {
  source: ProviderCommandSource;
  origin: ProviderCommandOrigin;
}): ProviderCommandSection {
  if (cmd.source === "skill") {
    return "skill";
  }
  return cmd.origin === "project" ? "project-command" : "user-command";
}

/**
 * Section rank used as the primary sort key for the command-list response, so
 * the flat order is grouped in {@link PROVIDER_COMMAND_SECTIONS} order. Lower
 * ranks sort first.
 */
export function providerCommandSectionRank(cmd: {
  source: ProviderCommandSource;
  origin: ProviderCommandOrigin;
}): number {
  return PROVIDER_COMMAND_SECTIONS.indexOf(providerCommandSection(cmd));
}

export const commandListResponseSchema = z.object({
  commands: z.array(providerCommandSchema),
  truncated: z.boolean(),
});
export type CommandListResponse = z.infer<typeof commandListResponseSchema>;

/**
 * Command typeahead query. Extends the shared project file-search query
 * (`query`/`limit`/`environmentId`, including the empty-string→null wire
 * convention) with the `provider` whose skill/command surface to discover.
 * `query` here is a case-insensitive substring filter on command name/description.
 */
export const projectCommandsQuerySchema = projectFilesQuerySchema.extend({
  /** Provider whose command/skill surface to discover (e.g. `claude-code`, `codex`). */
  provider: z.string().min(1),
});
export type ProjectCommandsQuery = z.infer<typeof projectCommandsQuerySchema>;

export const threadStorageFileListResponseSchema =
  workspaceFileListResponseSchema.extend({
    /**
     * Absolute on-host path to the thread's storage directory. Useful for
     * clients that need to construct a full path for filesystem operations
     * (e.g. opening a storage file in the user's editor). The path is on
     * the thread's host machine, so it is only usable when that host is the
     * user's local machine.
     */
    storageRootPath: z.string(),
  });
export type ThreadStorageFileListResponse = z.infer<
  typeof threadStorageFileListResponseSchema
>;

export const threadStoragePathListResponseSchema =
  workspacePathListResponseSchema.extend({
    /**
     * Absolute on-host path to the thread's storage directory. Useful for
     * clients that need to construct a full path for filesystem operations
     * (e.g. opening a storage file in the user's editor). The path is on
     * the thread's host machine, so it is only usable when that host is the
     * user's local machine.
     */
    storageRootPath: z.string(),
  });
export type ThreadStoragePathListResponse = z.infer<
  typeof threadStoragePathListResponseSchema
>;

export const projectResponseSchema = projectSchema.extend({
  sources: z.array(projectSourceSchema),
});
export type ProjectResponse = z.infer<typeof projectResponseSchema>;

export const projectWithThreadsResponseSchema = projectResponseSchema.extend({
  threads: z.array(threadListEntrySchema),
  /**
   * Project's stored execution defaults (provider/model/reasoning/permission/
   * tier). `null` when the project has never had a thread created in the app
   * UI. Inlined here so the new-thread composer can seed its picker without a
   * second round-trip per visit — the value comes from the sidebar bootstrap
   * the page is already loading.
   */
  defaultExecutionOptions: projectExecutionDefaultsSchema.nullable(),
});
export type ProjectWithThreadsResponse = z.infer<
  typeof projectWithThreadsResponseSchema
>;

export const sidebarBootstrapResponseSchema = z.object({
  projects: z.array(projectWithThreadsResponseSchema),
  personalProject: projectWithThreadsResponseSchema,
});
export type SidebarBootstrapResponse = z.infer<
  typeof sidebarBootstrapResponseSchema
>;

export const systemConfigResponseSchema = z.object({
  /** User-opt-in experiments (Settings → Experiments), persisted server-side. */
  experiments: experimentsSchema,
  featureFlags: featureFlagsSchema,
  hostDaemonPort: z.number().nullable(),
  voiceTranscriptionEnabled: z.boolean(),
});
export type SystemConfigResponse = z.infer<typeof systemConfigResponseSchema>;

export const systemVersionResponseSchema = z.object({
  /** Version of the running bb-app package, read from package.json. */
  currentVersion: z.string(),
  /** Latest version published to npm, or null when the lookup is unavailable. */
  latestVersion: z.string().nullable(),
  /** Identifier for where the latest version was fetched from. */
  source: z.literal("npm"),
  /** True only when prod-mode, both versions parse, and latest > current. */
  updateAvailable: z.boolean(),
  /** Mirrors deps.config.isDevelopment so the frontend can skip the toast. */
  isDevelopment: z.boolean(),
  /** Command users should run to upgrade. Server-owned product policy. */
  upgradeCommand: z.string(),
});
export type SystemVersionResponse = z.infer<typeof systemVersionResponseSchema>;

export const systemConfigReloadResponseSchema = z.object({
  ok: z.literal(true),
});
export type SystemConfigReloadResponse = z.infer<
  typeof systemConfigReloadResponseSchema
>;

export const environmentWorkspaceNotApplicableReasonSchema = z.enum([
  "non_git_environment",
]);
export type EnvironmentWorkspaceNotApplicableReason = z.infer<
  typeof environmentWorkspaceNotApplicableReasonSchema
>;

const environmentWorkspaceNotApplicableOutcomeSchema = z
  .object({
    outcome: z.literal("not_applicable"),
    reason: environmentWorkspaceNotApplicableReasonSchema,
    message: z.string().min(1),
  })
  .strict();

export const environmentStatusResponseSchema = z.discriminatedUnion("outcome", [
  z
    .object({
      outcome: z.literal("available"),
      workspace: workspaceStatusSchema,
    })
    .strict(),
  environmentWorkspaceNotApplicableOutcomeSchema,
  z
    .object({
      outcome: z.literal("unavailable"),
      failure: workspaceResolutionFailureSchema,
    })
    .strict(),
]);

/**
 * `pullRequest` is required + nullable: `null` means "no PR for this branch"
 * (a real, distinct state), covering every detection failure the daemon folds
 * together. Non-git environments resolve to `null` without a daemon call.
 */
export const environmentPullRequestResponseSchema = z
  .object({
    pullRequest: threadPullRequestSchema.nullable(),
  })
  .strict();
export type EnvironmentPullRequestResponse = z.infer<
  typeof environmentPullRequestResponseSchema
>;

export const environmentDiffResponseSchema = z.discriminatedUnion("outcome", [
  z
    .object({
      outcome: z.literal("available"),
      diff: threadGitDiffResponseSchema,
    })
    .strict(),
  environmentWorkspaceNotApplicableOutcomeSchema,
  z
    .object({
      outcome: z.literal("unavailable"),
      failure: workspaceResolutionFailureSchema,
    })
    .strict(),
]);
export type EnvironmentDiffResponse = z.infer<
  typeof environmentDiffResponseSchema
>;

export const uploadedPromptAttachmentSchema = z.object({
  type: z.enum(["localImage", "localFile"]),
  path: z.string(),
  name: z.string(),
  mimeType: z.string().optional(),
  sizeBytes: z.number(),
});
export type UploadedPromptAttachment = z.infer<
  typeof uploadedPromptAttachmentSchema
>;
export type EnvironmentStatusResponse = z.infer<
  typeof environmentStatusResponseSchema
>;

export {
  replayCaptureDetailSchema,
  replayCaptureListResponseSchema,
  replayCaptureHostSummarySchema,
  replayCaptureSummarySchema,
  replayRunRequestSchema,
  replayRunResponseSchema,
  replaySpeedSchema,
} from "@bb/replay-capture/schema";
export type {
  ReplayCaptureDetail,
  ReplayCaptureHostSummary,
  ReplayCaptureListResponse,
  ReplayCaptureSummary,
  ReplayRunRequest,
  ReplayRunResponse,
  ReplayRunSpeed,
} from "@bb/replay-capture/schema";

// ─── Workflows ─────────────────────────────────────────────────────────

export const workflowListQuerySchema = z.object({
  projectId: z.string().min(1),
  /** Omitted = resolve the listing root from the project's default source. */
  hostId: z.string().min(1).optional(),
});
export type WorkflowListQuery = z.infer<typeof workflowListQuerySchema>;

/** Winners-only registry listings (project > user > builtin) from the resolved source root. */
export const workflowListResponseSchema = z.array(
  hostDaemonWorkflowListingSchema,
);
export type WorkflowListResponse = z.infer<typeof workflowListResponseSchema>;

/** Inline launches carry the script source verbatim; the server validates and snapshots it. */
const inlineWorkflowRunSourceSchema = z.object({
  type: z.literal("inline"),
  script: z.string().min(1),
});

/** Named launches resolve `name` through the host registry tiers (project > user > builtin). */
const namedWorkflowRunSourceSchema = z.object({
  type: z.literal("named"),
  name: z.string().min(1),
});

export const createWorkflowRunSourceSchema = z.discriminatedUnion("type", [
  inlineWorkflowRunSourceSchema,
  namedWorkflowRunSourceSchema,
]);
export type CreateWorkflowRunSource = z.infer<
  typeof createWorkflowRunSourceSchema
>;

/**
 * The per-project workflow policy (plan M7): `sandboxCeiling` is the most
 * permissive sandbox the project's workflow launches — and per-call
 * `agent({sandbox})` specs — may use; "danger-full-access" must be granted
 * here before a launch can resolve it. `defaultBudgetOutputTokens` fills the
 * run budget when a launch carries no override; null = no budget default
 * (unbounded). GET returns the built-in defaults when the project has never
 * set a policy; PUT replaces the whole policy (both fields required — a null
 * budget means "no budget default", never "keep the old value"). Every run
 * snapshots its ceiling at create time, and each `workflow.start` queue
 * clamps that snapshot to the project's CURRENT effective ceiling — so
 * raising the ceiling never loosens an existing run, while LOWERING it (grant
 * revocation) takes effect the next time a held run starts or an interrupted
 * run resumes. Budget changes apply to future launches only.
 */
export const projectWorkflowPolicySchema = z
  .object({
    sandboxCeiling: workflowSandboxSchema,
    defaultBudgetOutputTokens: z.number().int().positive().nullable(),
  })
  .strict();
export type ProjectWorkflowPolicyResponse = z.infer<
  typeof projectWorkflowPolicySchema
>;
export const updateProjectWorkflowPolicyRequestSchema =
  projectWorkflowPolicySchema;
export type UpdateProjectWorkflowPolicyRequest = ProjectWorkflowPolicyResponse;

/**
 * Launch a workflow run. Optionality always carries real semantics:
 * `hostId` omitted = inherit `{hostId, workspacePath}` from the anchor
 * thread's environment when `anchorThreadId` is set (409
 * `thread_environment_unavailable`/`environment_not_ready` when the anchor
 * has no usable environment — never a silent fallback to the project
 * source), else the project's default source (409 when none); explicit
 * `hostId` always wins and 404s when that host has no local-path source;
 * `anchorThreadId` omitted = unanchored run; `args` omitted = launched
 * without args (distinct from `args: null`, which is JSON null args); the
 * override fields omitted = fall through to the workflow meta default, then
 * server policy; `clientRequestId` omitted = no launch replay protection (a
 * replayed `clientRequestId` returns the original run without re-creating
 * anything).
 */
export const createWorkflowRunRequestSchema = z.object({
  projectId: z.string().min(1),
  source: createWorkflowRunSourceSchema,
  hostId: z.string().min(1).optional(),
  anchorThreadId: z.string().min(1).optional(),
  args: jsonValueSchema.optional(),
  clientRequestId: z.string().min(1).max(200).optional(),
  providerId: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  effort: reasoningLevelSchema.optional(),
  sandbox: workflowSandboxSchema.optional(),
  budgetOutputTokens: z.number().int().positive().optional(),
});
export type CreateWorkflowRunRequest = z.infer<
  typeof createWorkflowRunRequestSchema
>;

export const workflowRunUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  toolUses: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
});
export type WorkflowRunUsage = z.infer<typeof workflowRunUsageSchema>;

/**
 * The canonical public workflow-run projection (detail and list rows share
 * it). Deliberately excludes `scriptSource` — the snapshot is a potentially
 * large blob kept for resume/audit, not for client rendering; `scriptHash`
 * identifies it.
 */
export const workflowRunResponseSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  hostId: z.string().min(1),
  workspacePath: z.string().min(1),
  anchorThreadId: z.string().min(1).nullable(),
  workflowName: z.string().min(1),
  sourceTier: workflowRunSourceTierSchema,
  scriptHash: z.string().min(1),
  argsJson: z.string().nullable(),
  seed: z.number().int(),
  keyVersion: z.string().min(1),
  providerId: z.string().min(1),
  model: z.string().nullable(),
  effort: reasoningLevelSchema,
  sandbox: workflowSandboxSchema,
  concurrency: z.number().int(),
  maxAgents: z.number().int(),
  maxFanout: z.number().int(),
  budgetOutputTokens: z.number().int().nullable(),
  status: workflowRunStatusSchema,
  failureReason: z.string().nullable(),
  progressSnapshot: workflowProgressSnapshotSchema.nullable(),
  usage: workflowRunUsageSchema,
  resultJson: z.string().nullable(),
  retention: workflowRunRetentionSchema,
  createdAt: z.number().int(),
  startedAt: z.number().int().nullable(),
  settledAt: z.number().int().nullable(),
  updatedAt: z.number().int(),
});
export type WorkflowRunResponse = z.infer<typeof workflowRunResponseSchema>;

export const workflowRunListQuerySchema = z.object({
  /** Omitted = runs across all projects (the sidebar's recent-runs list). */
  projectId: z.string().min(1).optional(),
  limit: z.string().regex(/^\d+$/).optional(),
});
export type WorkflowRunListQuery = z.infer<typeof workflowRunListQuerySchema>;

export const workflowRunListResponseSchema = z.array(workflowRunResponseSchema);
export type WorkflowRunListResponse = z.infer<
  typeof workflowRunListResponseSchema
>;

export const workflowRunEventsQuerySchema = z
  .object({
    afterSeq: z.string().regex(/^\d+$/),
  })
  .partial();
export type WorkflowRunEventsQuery = z.infer<
  typeof workflowRunEventsQuerySchema
>;

/** One durable run-event row with its payload parsed (`event.type` discriminates). */
export const workflowRunEventRowResponseSchema = z.object({
  sequence: z.number().int().positive(),
  agentIndex: z.number().int().nullable(),
  createdAt: z.number().int(),
  event: workflowRunEventSchema,
});
export type WorkflowRunEventRowResponse = z.infer<
  typeof workflowRunEventRowResponseSchema
>;

export const workflowRunEventsResponseSchema = z.array(
  workflowRunEventRowResponseSchema,
);
export type WorkflowRunEventsResponse = z.infer<
  typeof workflowRunEventsResponseSchema
>;

export const workflowRunWaitQuerySchema = z
  .object({
    waitMs: z.string().regex(/^\d+$/),
  })
  .partial();
export type WorkflowRunWaitQuery = z.infer<typeof workflowRunWaitQuerySchema>;
