import { z } from "zod";

export const BROWSER_AUTOMATION_MAX_URL_LENGTH = 4096;
export const BROWSER_AUTOMATION_MAX_TARGETS_PER_THREAD = 4;
export const BROWSER_AUTOMATION_DEFAULT_TIMEOUT_MS = 30_000;
export const BROWSER_AUTOMATION_MAX_TIMEOUT_MS = 120_000;
export const BROWSER_AUTOMATION_MAX_AX_NODES = 500;
export const BROWSER_AUTOMATION_MAX_AX_DEPTH = 20;
export const BROWSER_AUTOMATION_MAX_TEXT_LENGTH = 16_384;
export const BROWSER_AUTOMATION_MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024;
const BROWSER_AUTOMATION_MAX_ID_LENGTH = 128;
const BROWSER_AUTOMATION_MAX_REF_LENGTH = 128;
const BROWSER_AUTOMATION_NAMED_KEYS = [
  "Enter",
  "Tab",
  "Escape",
  "Space",
  "PageDown",
  "PageUp",
  "ArrowLeft",
  "ArrowUp",
  "ArrowRight",
  "ArrowDown",
  "Backspace",
] as const;
const BROWSER_AUTOMATION_MAX_SCREENSHOT_BASE64_LENGTH =
  Math.ceil(BROWSER_AUTOMATION_MAX_SCREENSHOT_BYTES / 3) * 4;

const browserAutomationIdSchema = z
  .string()
  .min(1)
  .max(BROWSER_AUTOMATION_MAX_ID_LENGTH);

export function isBrowserAutomationUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === "http:" || parsed.protocol === "https:";
}

export const browserAutomationUrlSchema = z
  .string()
  .min(1)
  .max(BROWSER_AUTOMATION_MAX_URL_LENGTH)
  .refine(isBrowserAutomationUrl, "Browser automation URLs must be http or https");

export const browserAutomationTargetStatusSchema = z.enum([
  "opening",
  "ready",
  "closed",
]);
export type BrowserAutomationTargetStatus = z.infer<
  typeof browserAutomationTargetStatusSchema
>;

export const browserAutomationTargetSchema = z
  .object({
    targetId: browserAutomationIdSchema,
    threadId: z.string().min(1),
    hostId: z.string().min(1),
    status: browserAutomationTargetStatusSchema,
    navigationEpoch: z.number().int().nonnegative(),
    navigating: z.boolean(),
    visible: z.literal(true),
    url: z.string().max(BROWSER_AUTOMATION_MAX_URL_LENGTH),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();
export type BrowserAutomationTarget = z.infer<
  typeof browserAutomationTargetSchema
>;

export const browserAutomationOpenFailureCodeSchema = z.enum([
  "thread_not_open",
  "tab_unavailable",
]);
export type BrowserAutomationOpenFailureCode = z.infer<
  typeof browserAutomationOpenFailureCodeSchema
>;

export const browserAutomationClientUnavailableReasonSchema = z.enum([
  "no_client",
  "incompatible",
  "disconnected",
]);
export type BrowserAutomationClientUnavailableReason = z.infer<
  typeof browserAutomationClientUnavailableReasonSchema
>;

export const browserAutomationCapabilityMessageSchema = z
  .object({
    type: z.literal("browser-automation.capability"),
    windowId: browserAutomationIdSchema,
  })
  .strict();
export type BrowserAutomationCapabilityMessage = z.infer<
  typeof browserAutomationCapabilityMessageSchema
>;

export const browserAutomationCapabilityUnavailableMessageSchema = z
  .object({
    type: z.literal("browser-automation.capability-unavailable"),
  })
  .strict();
export type BrowserAutomationCapabilityUnavailableMessage = z.infer<
  typeof browserAutomationCapabilityUnavailableMessageSchema
>;

export const browserAutomationOpenReadyMessageSchema = z
  .object({
    type: z.literal("browser-automation.open-ready"),
    requestId: browserAutomationIdSchema,
    targetId: browserAutomationIdSchema,
    windowId: browserAutomationIdSchema,
    tabId: z.string().min(1).max(256),
    url: z.string().max(BROWSER_AUTOMATION_MAX_URL_LENGTH),
  })
  .strict();
export type BrowserAutomationOpenReadyMessage = z.infer<
  typeof browserAutomationOpenReadyMessageSchema
>;

export const browserAutomationOpenFailedMessageSchema = z
  .object({
    type: z.literal("browser-automation.open-failed"),
    requestId: browserAutomationIdSchema,
    targetId: browserAutomationIdSchema,
    code: browserAutomationOpenFailureCodeSchema,
  })
  .strict();
export type BrowserAutomationOpenFailedMessage = z.infer<
  typeof browserAutomationOpenFailedMessageSchema
>;

export const browserAutomationTargetClosedMessageSchema = z
  .object({
    type: z.literal("browser-automation.target-closed"),
    targetId: browserAutomationIdSchema,
    windowId: browserAutomationIdSchema,
    tabId: z.string().min(1).max(256),
  })
  .strict();
export type BrowserAutomationTargetClosedMessage = z.infer<
  typeof browserAutomationTargetClosedMessageSchema
>;

export type BrowserAutomationClientMessage =
  | BrowserAutomationCapabilityMessage
  | BrowserAutomationCapabilityUnavailableMessage
  | BrowserAutomationOpenReadyMessage
  | BrowserAutomationOpenFailedMessage
  | BrowserAutomationTargetClosedMessage
  | BrowserAutomationCommandResultMessage
  | BrowserAutomationCommandFailedMessage
  | BrowserAutomationCancelRequestMessage;

export const browserAutomationOpenMessageSchema = z
  .object({
    type: z.literal("browser-automation.open"),
    requestId: browserAutomationIdSchema,
    targetId: browserAutomationIdSchema,
    threadId: z.string().min(1),
    url: browserAutomationUrlSchema,
  })
  .strict();
export type BrowserAutomationOpenMessage = z.infer<
  typeof browserAutomationOpenMessageSchema
>;

export const browserAutomationOpenMessageLenientSchema = z.object({
  type: z.literal("browser-automation.open"),
  requestId: browserAutomationIdSchema,
  targetId: browserAutomationIdSchema,
  threadId: z.string().min(1),
  url: browserAutomationUrlSchema,
});

export const browserAutomationCloseMessageSchema = z
  .object({
    type: z.literal("browser-automation.close"),
    targetId: browserAutomationIdSchema,
  })
  .strict();
export type BrowserAutomationCloseMessage = z.infer<
  typeof browserAutomationCloseMessageSchema
>;

export const browserAutomationCloseMessageLenientSchema = z.object({
  type: z.literal("browser-automation.close"),
  targetId: browserAutomationIdSchema,
});

export const browserAutomationSnapshotRefSchema = z
  .string()
  .min(1)
  .max(BROWSER_AUTOMATION_MAX_REF_LENGTH)
  .regex(/^e\d+g\d+r\d+$/)
  .transform((ref) => {
    const generationStart = ref.indexOf("g") + 1;
    const refStart = ref.indexOf("r", generationStart);
    return {
      navigationEpoch: Number(ref.slice(1, generationStart - 1)),
      snapshotGeneration: Number(ref.slice(generationStart, refStart)),
      refNumber: Number(ref.slice(refStart + 1)),
      ref,
    };
  })
  .refine(
    (parsed) =>
      Number.isSafeInteger(parsed.navigationEpoch) &&
      Number.isSafeInteger(parsed.snapshotGeneration) &&
      Number.isSafeInteger(parsed.refNumber),
    "Browser snapshot reference exceeds numeric limits",
  );
export type BrowserAutomationSnapshotRef = z.infer<
  typeof browserAutomationSnapshotRefSchema
>;

export function parseBrowserSnapshotRef(
  ref: string,
): BrowserAutomationSnapshotRef | null {
  const parsed = browserAutomationSnapshotRefSchema.safeParse(ref);
  return parsed.success ? parsed.data : null;
}

export function formatBrowserSnapshotRef(args: {
  navigationEpoch: number;
  snapshotGeneration: number;
  refNumber: number;
}): string {
  return `e${args.navigationEpoch}g${args.snapshotGeneration}r${args.refNumber}`;
}

export const browserAutomationKeySchema = z.union([
  z.enum(BROWSER_AUTOMATION_NAMED_KEYS),
  z.string().length(1).regex(/^[\x20-\x7e]$/),
]);
export type BrowserAutomationKey = z.infer<typeof browserAutomationKeySchema>;

const browserAutomationRefSchema = z
  .string()
  .min(1)
  .max(BROWSER_AUTOMATION_MAX_REF_LENGTH)
  .refine((ref) => parseBrowserSnapshotRef(ref) !== null, "Invalid Browser snapshot reference");
const browserAutomationGenerationSchema = z.number().int().nonnegative();

export const browserAutomationCommandSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("navigate"), url: browserAutomationUrlSchema }).strict(),
  z.object({ kind: z.literal("wait"), text: z.string().min(1).max(1_024) }).strict(),
  z.object({ kind: z.literal("snapshot") }).strict(),
  z.object({
    kind: z.literal("click"),
    ref: browserAutomationRefSchema,
    snapshotGeneration: browserAutomationGenerationSchema,
  }).strict(),
  z.object({
    kind: z.literal("type"),
    ref: browserAutomationRefSchema,
    snapshotGeneration: browserAutomationGenerationSchema,
    text: z.string().max(BROWSER_AUTOMATION_MAX_TEXT_LENGTH),
  }).strict(),
  z.object({ kind: z.literal("press"), key: browserAutomationKeySchema }).strict(),
  z.object({
    kind: z.literal("select"),
    ref: browserAutomationRefSchema,
    snapshotGeneration: browserAutomationGenerationSchema,
    value: z.string().min(1).max(512),
  }).strict(),
  z.object({ kind: z.literal("screenshot") }).strict(),
]);
export type BrowserAutomationCommand = z.infer<
  typeof browserAutomationCommandSchema
>;

export const browserAutomationPageStateSchema = z.object({
  navigationEpoch: browserAutomationGenerationSchema,
  ready: z.boolean(),
  url: z.string().max(BROWSER_AUTOMATION_MAX_URL_LENGTH),
}).strict();
export type BrowserAutomationPageState = z.infer<
  typeof browserAutomationPageStateSchema
>;

export interface BrowserAutomationSnapshotNode {
  bounds?: { height: number; width: number; x: number; y: number };
  checked?: boolean;
  children: BrowserAutomationSnapshotNode[];
  disabled?: boolean;
  expanded?: boolean;
  href?: string;
  name: string;
  ref?: string;
  role: string;
  selected?: boolean;
  value?: string;
  visible: boolean;
}

const browserAutomationBoundsSchema = z.object({
  height: z.number().finite().nonnegative(),
  width: z.number().finite().nonnegative(),
  x: z.number().finite(),
  y: z.number().finite(),
}).strict();

const browserAutomationSnapshotNodeShallowSchema = z.object({
  bounds: browserAutomationBoundsSchema.optional(),
  checked: z.boolean().optional(),
  children: z.array(z.unknown()),
  disabled: z.boolean().optional(),
  expanded: z.boolean().optional(),
  href: z.string().max(BROWSER_AUTOMATION_MAX_URL_LENGTH).optional(),
  name: z.string().max(512),
  ref: browserAutomationRefSchema.optional(),
  role: z.string().max(512),
  selected: z.boolean().optional(),
  value: z.string().max(512).optional(),
  visible: z.boolean(),
}).strict();

const browserAutomationSnapshotNodesSchema = z.custom<
  BrowserAutomationSnapshotNode[]
>((value) => {
  if (
    !Array.isArray(value) ||
    value.length > BROWSER_AUTOMATION_MAX_AX_NODES
  ) return false;
  const pending = value.map((node) => ({ depth: 1, node }));
  let count = 0;
  while (pending.length > 0) {
    const next = pending.pop();
    if (next === undefined) break;
    count += 1;
    if (
      count > BROWSER_AUTOMATION_MAX_AX_NODES ||
      next.depth > BROWSER_AUTOMATION_MAX_AX_DEPTH
    ) {
      return false;
    }
    const parsed = browserAutomationSnapshotNodeShallowSchema.safeParse(
      next.node,
    );
    if (
      !parsed.success ||
      count + pending.length + parsed.data.children.length >
        BROWSER_AUTOMATION_MAX_AX_NODES
    ) return false;
    for (const child of parsed.data.children) {
      pending.push({ depth: next.depth + 1, node: child });
    }
  }
  return true;
}, "Browser automation snapshot is invalid or exceeds tree limits");

function decodedBase64Length(value: string): number {
  if (value.length === 0) return 0;
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

export const browserAutomationStateResultSchema =
  browserAutomationPageStateSchema.extend({ kind: z.literal("state") }).strict();
export const browserAutomationSnapshotResultSchema =
  browserAutomationPageStateSchema.extend({
    kind: z.literal("snapshot"),
    generation: browserAutomationGenerationSchema,
    nodes: browserAutomationSnapshotNodesSchema,
  }).strict();
export const browserAutomationScreenshotResultSchema =
  browserAutomationPageStateSchema.extend({
    kind: z.literal("screenshot"),
    base64: z.string()
      .max(BROWSER_AUTOMATION_MAX_SCREENSHOT_BASE64_LENGTH)
      .regex(/^[A-Za-z0-9+/]*={0,2}$/)
      .refine((value) => value.length % 4 === 0, "Invalid base64 length"),
    mimeType: z.literal("image/png"),
  }).strict().refine(
    (result) => decodedBase64Length(result.base64) <= BROWSER_AUTOMATION_MAX_SCREENSHOT_BYTES,
    "Browser automation screenshot exceeds the size limit",
  );
export const browserAutomationCommandResultSchema = z.discriminatedUnion("kind", [
  browserAutomationStateResultSchema,
  browserAutomationSnapshotResultSchema,
  browserAutomationScreenshotResultSchema,
]);
export type BrowserAutomationCommandResult = z.infer<
  typeof browserAutomationCommandResultSchema
>;

export const browserAutomationCommandErrorCodeSchema = z.enum([
  "cancelled",
  "stale_revision",
  "native_operation_failed",
]);
export type BrowserAutomationCommandErrorCode = z.infer<
  typeof browserAutomationCommandErrorCodeSchema
>;

const browserAutomationCommandCorrelationSchema = z.object({
  commandId: browserAutomationIdSchema,
  targetId: browserAutomationIdSchema,
  windowId: browserAutomationIdSchema,
  tabId: z.string().min(1).max(256),
});

export const browserAutomationCommandMessageSchema =
  browserAutomationCommandCorrelationSchema.extend({
    type: z.literal("browser-automation.command"),
    navigationEpoch: browserAutomationGenerationSchema,
    timeoutMs: z.number().int().positive().max(BROWSER_AUTOMATION_MAX_TIMEOUT_MS),
    command: browserAutomationCommandSchema,
  }).strict();
export type BrowserAutomationCommandMessage = z.infer<
  typeof browserAutomationCommandMessageSchema
>;
export const browserAutomationCommandMessageLenientSchema =
  browserAutomationCommandMessageSchema.loose();

export const browserAutomationCancelMessageSchema =
  browserAutomationCommandCorrelationSchema.extend({
    type: z.literal("browser-automation.cancel"),
  }).strict();
export type BrowserAutomationCancelMessage = z.infer<
  typeof browserAutomationCancelMessageSchema
>;
export const browserAutomationCancelMessageLenientSchema =
  browserAutomationCancelMessageSchema.loose();

export const browserAutomationCommandResultMessageSchema =
  browserAutomationCommandCorrelationSchema.extend({
    type: z.literal("browser-automation.command-result"),
    result: browserAutomationCommandResultSchema,
  }).strict();
export type BrowserAutomationCommandResultMessage = z.infer<
  typeof browserAutomationCommandResultMessageSchema
>;

export const browserAutomationCommandFailedMessageSchema =
  browserAutomationCommandCorrelationSchema.extend({
    type: z.literal("browser-automation.command-failed"),
    code: browserAutomationCommandErrorCodeSchema,
    detail: z.string().min(1).max(512),
    state: browserAutomationPageStateSchema.optional(),
  }).strict();
export type BrowserAutomationCommandFailedMessage = z.infer<
  typeof browserAutomationCommandFailedMessageSchema
>;

export const browserAutomationCancelRequestMessageSchema =
  browserAutomationCommandCorrelationSchema.extend({
    type: z.literal("browser-automation.cancel-request"),
  }).strict();
export type BrowserAutomationCancelRequestMessage = z.infer<
  typeof browserAutomationCancelRequestMessageSchema
>;
