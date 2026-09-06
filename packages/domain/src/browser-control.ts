import { z } from "zod";
import { jsonValueSchema } from "./json-value.js";

export const BROWSER_CONTROL_MAX_SCRIPT_SOURCE_BYTES = 64 * 1024;
export const BROWSER_CONTROL_MAX_INPUT_BYTES = 64 * 1024;
export const BROWSER_CONTROL_MAX_RESULT_BYTES = 9 * 1024 * 1024;
export const BROWSER_CONTROL_MIN_TIMEOUT_MS = 100;
export const BROWSER_CONTROL_MAX_TIMEOUT_MS = 120_000;
export const BROWSER_CONTROL_MAX_FRAME_ID_LENGTH = 128;
export const BROWSER_CONTROL_MAX_FRAMES = 64;

function jsonByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export function isAllowedBrowserNavigationUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return (
    parsed.protocol === "http:" ||
    parsed.protocol === "https:" ||
    (parsed.protocol === "file:" &&
      (parsed.hostname === "" || parsed.hostname === "localhost") &&
      parsed.username === "" &&
      parsed.password === "")
  );
}

export const browserFrameTargetSchema = z
  .object({
    frameId: z.string().min(1).max(BROWSER_CONTROL_MAX_FRAME_ID_LENGTH),
    documentEpoch: z.number().int().nonnegative(),
  })
  .strict();
export type BrowserFrameTarget = z.infer<typeof browserFrameTargetSchema>;

export const browserFrameDescriptorSchema = z
  .object({
    frameId: z.string().min(1).max(BROWSER_CONTROL_MAX_FRAME_ID_LENGTH),
    documentEpoch: z.number().int().nonnegative(),
    parentFrameId: z
      .string()
      .min(1)
      .max(BROWSER_CONTROL_MAX_FRAME_ID_LENGTH)
      .nullable(),
    url: z.string().max(4_096),
    name: z.string().max(256).nullable(),
    depth: z.number().int().nonnegative().max(8),
  })
  .strict();
export type BrowserFrameDescriptor = z.infer<
  typeof browserFrameDescriptorSchema
>;

const browserLocatorFrameSchema = z.object({
  frame: browserFrameTargetSchema.optional(),
});

const browserCssLocatorSchema = z
  .object({
    selectors: z.array(z.string().min(1).max(2_048)).min(1).max(8),
    ...browserLocatorFrameSchema.shape,
  })
  .strict();
const browserAccessibilityLocatorSchema = z
  .object({
    role: z.string().trim().min(1).max(128),
    name: z.string().trim().min(1).max(512).optional(),
    ...browserLocatorFrameSchema.shape,
  })
  .strict();
export const browserPageLocatorSchema = z.union([
  browserCssLocatorSchema,
  browserAccessibilityLocatorSchema,
]);
export type BrowserPageLocator = z.infer<typeof browserPageLocatorSchema>;

export const browserTabDescriptorSchema = z
  .object({
    clientId: z.string().min(1).max(128),
    windowId: z.string().min(1).max(128),
    tabId: z.string().min(1).max(256),
    threadId: z.string().min(1).max(256).nullable(),
    projectId: z.string().min(1).max(256).nullable(),
    url: z.string().max(16_384),
    title: z.string().max(2_048).nullable(),
    connected: z.boolean(),
    active: z.boolean(),
    navigationEpoch: z.number().int().nonnegative(),
  })
  .strict();
export type BrowserTabDescriptor = z.infer<typeof browserTabDescriptorSchema>;

export const browserTabOwnerDescriptorSchema = z
  .object({
    clientId: z.string().min(1).max(128),
    windowId: z.string().min(1).max(128),
    ownerId: z.string().min(1).max(256),
    threadId: z.string().min(1).max(256).nullable(),
    projectId: z.string().min(1).max(256).nullable(),
    active: z.boolean(),
  })
  .strict();
export type BrowserTabOwnerDescriptor = z.infer<
  typeof browserTabOwnerDescriptorSchema
>;

export const browserTabTargetSchema = browserTabDescriptorSchema.pick({
  clientId: true,
  windowId: true,
  tabId: true,
  navigationEpoch: true,
});
export type BrowserTabTarget = z.infer<typeof browserTabTargetSchema>;

const locatorTargetSchema = z
  .object({ target: z.literal("locator"), locator: browserPageLocatorSchema })
  .strict();
const pointTargetSchema = z
  .object({
    target: z.literal("point"),
    x: z.number().finite().nonnegative(),
    y: z.number().finite().nonnegative(),
  })
  .strict();
export const browserPointerTargetSchema = z.discriminatedUnion("target", [
  locatorTargetSchema,
  pointTargetSchema,
]);
export type BrowserPointerTarget = z.infer<typeof browserPointerTargetSchema>;

export const browserViewportProfileSchema = z.enum([
  "phone-390x844",
  "tablet-768x1024",
  "desktop-1280x720",
]);
export type BrowserViewportProfile = z.infer<
  typeof browserViewportProfileSchema
>;

export const browserWaitUrlMatchSchema = z.enum(["exact", "glob"]);
export type BrowserWaitUrlMatch = z.infer<typeof browserWaitUrlMatchSchema>;

export function browserUrlMatches(
  url: string,
  expected: string,
  match: BrowserWaitUrlMatch,
): boolean {
  if (match === "exact") return url === expected;
  const parts = expected.split("*");
  if (parts.length === 1) return url === expected;
  let offset = 0;
  for (const [index, part] of parts.entries()) {
    if (index === parts.length - 1) {
      return url.endsWith(part) && url.length - part.length >= offset;
    }
    const found = url.indexOf(part, offset);
    if (found < offset || (index === 0 && found !== 0)) return false;
    offset = found + part.length;
  }
  return false;
}

const browserWaitUrlSchema = z
  .object({
    url: z.string().min(1).max(4_096),
    match: browserWaitUrlMatchSchema,
  })
  .strict();

export const browserWaitCriteriaSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("locator"),
      locator: browserPageLocatorSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("text"),
      text: z.string().min(1).max(2_048),
      frame: browserFrameTargetSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("url"),
      ...browserWaitUrlSchema.shape,
    })
    .strict(),
  z
    .object({
      kind: z.literal("navigation"),
      phase: z.enum(["start", "commit"]),
      sameDocument: z.boolean(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("load-state"),
      document: z.enum(["current", "next"]),
      state: z.enum(["domcontentloaded", "load", "networkidle"]),
    })
    .strict(),
  z.object({ kind: z.literal("popup") }).strict(),
  z
    .object({
      kind: z.literal("request"),
      ...browserWaitUrlSchema.shape,
      method: z.string().trim().min(1).max(16).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("response"),
      ...browserWaitUrlSchema.shape,
      method: z.string().trim().min(1).max(16).optional(),
      status: z.number().int().min(100).max(599).optional(),
    })
    .strict(),
  z.object({ kind: z.literal("download-blocked") }).strict(),
]);
export type BrowserWaitCriteria = z.infer<typeof browserWaitCriteriaSchema>;

const browserWaitResultBaseSchema = z.object({
  target: browserTabTargetSchema,
  originalTarget: browserTabTargetSchema.optional(),
  observedTarget: browserTabTargetSchema.optional(),
});
export const browserWaitResultSchema = z.discriminatedUnion("kind", [
  browserWaitResultBaseSchema.extend({ kind: z.literal("locator") }).strict(),
  browserWaitResultBaseSchema.extend({ kind: z.literal("text") }).strict(),
  browserWaitResultBaseSchema
    .extend({ kind: z.literal("url"), url: z.string().max(4_096) })
    .strict(),
  browserWaitResultBaseSchema
    .extend({
      kind: z.literal("navigation"),
      url: z.string().max(4_096),
      phase: z.enum(["start", "commit", "complete"]),
      sameDocument: z.boolean(),
    })
    .strict(),
  browserWaitResultBaseSchema
    .extend({
      kind: z.literal("load-state"),
      state: z.enum(["domcontentloaded", "load", "networkidle"]),
    })
    .strict(),
  browserWaitResultBaseSchema
    .extend({ kind: z.literal("popup"), url: z.string().max(4_096) })
    .strict(),
  browserWaitResultBaseSchema
    .extend({
      kind: z.literal("request"),
      url: z.string().max(4_096),
      method: z.string().max(16),
    })
    .strict(),
  browserWaitResultBaseSchema
    .extend({
      kind: z.literal("response"),
      url: z.string().max(4_096),
      method: z.string().max(16),
      status: z.number().int().min(100).max(599),
    })
    .strict(),
  browserWaitResultBaseSchema
    .extend({
      kind: z.literal("download-blocked"),
      url: z.string().max(4_096),
      blocked: z.literal(true),
    })
    .strict(),
]);
export type BrowserWaitResult = z.infer<typeof browserWaitResultSchema>;

export function isBrowserTransitionWaitAction(action: {
  kind: "wait";
  criteria: BrowserWaitCriteria;
}): boolean {
  return (
    action.criteria.kind === "url" ||
    action.criteria.kind === "navigation" ||
    (action.criteria.kind === "load-state" &&
      action.criteria.document === "next")
  );
}

export const browserActionabilityPolicySchema = z
  .object({
    timeoutMs: z
      .number()
      .int()
      .min(BROWSER_CONTROL_MIN_TIMEOUT_MS)
      .max(BROWSER_CONTROL_MAX_TIMEOUT_MS),
    pollIntervalMs: z.number().int().min(16).max(250),
    stableFrameCount: z.number().int().min(1).max(4),
  })
  .strict();
export type BrowserActionabilityPolicy = z.infer<
  typeof browserActionabilityPolicySchema
>;

export const browserControlErrorSchema = z
  .object({
    code: z.string().min(1).max(128),
    message: z.string().min(1).max(2_048),
    details: jsonValueSchema
      .refine(
        (value) => jsonByteLength(value) <= 8_192,
        "Browser error details are too large",
      )
      .optional(),
  })
  .strict();
export type BrowserControlError = z.infer<typeof browserControlErrorSchema>;

const browserListFramesActionSchema = z
  .object({
    kind: z.literal("list-frames"),
    maxFrames: z
      .number()
      .int()
      .min(1)
      .max(BROWSER_CONTROL_MAX_FRAMES)
      .optional(),
  })
  .strict();
const browserSnapshotActionSchema = z
  .object({
    kind: z.literal("snapshot"),
    mode: z.enum(["dom", "interactive"]),
    maxNodes: z.number().int().min(1).max(2_000).optional(),
    frame: browserFrameTargetSchema.optional(),
  })
  .strict();
const browserPointerActionSchema = (
  kind: "click" | "hover" | "double-click" | "right-click" | "middle-click",
) =>
  z
    .object({ kind: z.literal(kind), target: browserPointerTargetSchema })
    .strict();
const browserDragActionSchema = z
  .object({
    kind: z.literal("drag"),
    from: browserPointerTargetSchema,
    to: browserPointerTargetSchema,
  })
  .strict();
const browserTypeActionSchema = z
  .object({
    kind: z.literal("type"),
    locator: browserPageLocatorSchema,
    text: z.string().max(65_536),
    clear: z.boolean().optional(),
  })
  .strict();
const browserSelectActionSchema = z
  .object({
    kind: z.literal("select"),
    locator: browserPageLocatorSchema,
    value: z.string().min(1).max(2_048),
  })
  .strict();
const browserSelectMultipleActionSchema = z
  .object({
    kind: z.literal("select-multiple"),
    locator: browserPageLocatorSchema,
    values: z.array(z.string().min(1).max(2_048)).min(1).max(64),
  })
  .strict();
const browserUploadActionSchema = z
  .object({
    kind: z.literal("upload"),
    locator: browserPageLocatorSchema,
    files: z
      .array(
        z
          .object({
            name: z.string().min(1).max(255),
            mimeType: z.string().max(255),
            base64: z.string().max(2_000_000),
          })
          .strict(),
      )
      .min(1)
      .max(4),
  })
  .strict();
const browserCheckActionSchema = z
  .object({ kind: z.literal("check"), locator: browserPageLocatorSchema })
  .strict();
const browserUncheckActionSchema = z
  .object({ kind: z.literal("uncheck"), locator: browserPageLocatorSchema })
  .strict();
const browserFocusActionSchema = z
  .object({ kind: z.literal("focus"), locator: browserPageLocatorSchema })
  .strict();
const browserScrollIntoViewActionSchema = z
  .object({
    kind: z.literal("scroll-into-view"),
    locator: browserPageLocatorSchema,
  })
  .strict();
const browserKeyActionSchema = z
  .object({
    kind: z.literal("key"),
    key: z.string().min(1).max(64),
    code: z.string().min(1).max(64).optional(),
    modifiers: z
      .array(z.enum(["Alt", "Control", "Meta", "Shift"]))
      .max(4)
      .optional(),
  })
  .strict();
const browserScrollActionSchema = z
  .object({
    kind: z.literal("scroll"),
    x: z.number().finite().optional(),
    y: z.number().finite().optional(),
    deltaX: z.number().finite().optional(),
    deltaY: z.number().finite().optional(),
    behavior: z.enum(["auto", "smooth"]).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.x !== undefined ||
      value.y !== undefined ||
      value.deltaX !== undefined ||
      value.deltaY !== undefined,
    "scroll requires an absolute position or delta",
  );
const browserNavigateActionSchema = z
  .object({
    kind: z.literal("navigate"),
    url: z.string().min(1).max(16_384),
  })
  .strict();
const browserOpenTabActionSchema = z
  .object({
    kind: z.literal("open-tab"),
    url: z.string().min(1).max(16_384),
  })
  .strict();
const browserActivateTabActionSchema = z
  .object({
    kind: z.literal("activate-tab"),
    tabId: z.string().min(1).max(256),
  })
  .strict();
const browserCloseTabActionSchema = z
  .object({ kind: z.literal("close-tab") })
  .strict();
const browserBackActionSchema = z.object({ kind: z.literal("back") }).strict();
const browserForwardActionSchema = z
  .object({ kind: z.literal("forward") })
  .strict();
const browserReloadActionSchema = z
  .object({ kind: z.literal("reload") })
  .strict();
const browserSetViewportProfileActionSchema = z
  .object({
    kind: z.literal("set-viewport-profile"),
    profile: browserViewportProfileSchema,
  })
  .strict();
const browserWaitActionSchema = z
  .object({
    kind: z.literal("wait"),
    criteria: browserWaitCriteriaSchema,
  })
  .strict();
const browserClearViewportProfileActionSchema = z
  .object({ kind: z.literal("clear-viewport-profile") })
  .strict();
const browserSetDialogHandlerActionSchema = z
  .object({
    kind: z.literal("set-dialog-handler"),
    behavior: z.enum(["accept", "dismiss"]),
    promptText: z.string().max(4_096).optional(),
  })
  .strict();
const browserSetPermissionsActionSchema = z
  .object({
    kind: z.literal("set-permissions"),
    decision: z.enum(["allow", "deny"]),
    origin: z.string().min(1).max(2_048),
    permissions: z
      .array(
        z.enum([
          "clipboard-read",
          "clipboard-sanitized-write",
          "display-capture",
          "fullscreen",
          "geolocation",
          "media",
          "notifications",
        ]),
      )
      .max(7),
  })
  .strict();
const browserDiagnosticsActionSchema = z
  .object({ kind: z.literal("diagnostics") })
  .strict();
const browserGetStorageActionSchema = z
  .object({ kind: z.literal("get-storage") })
  .strict();
const browserSetStorageActionSchema = z
  .object({
    kind: z.literal("set-storage"),
    local: z.record(z.string().max(256), z.string().max(65_536)),
    session: z.record(z.string().max(256), z.string().max(65_536)),
    cookies: z.array(z.string().min(1).max(4_096)).max(64),
  })
  .strict();
const browserClearStorageActionSchema = z
  .object({
    kind: z.literal("clear-storage"),
    stores: z
      .array(z.enum(["local", "session", "cookies"]))
      .min(1)
      .max(3),
  })
  .strict();
const browserListCookieImportSourcesActionSchema = z
  .object({ kind: z.literal("list-cookie-import-sources") })
  .strict();
const browserImportCookiesFromBrowserActionSchema = z
  .object({
    kind: z.literal("import-cookies-from-browser"),
    family: z.string().min(1).max(64),
    profileId: z.string().min(1).max(256),
  })
  .strict();
const browserClearImportedCookiesActionSchema = z
  .object({
    kind: z.literal("clear-imported-cookies"),
    confirm: z.literal(true),
  })
  .strict();
const browserScreenshotActionSchema = z
  .object({
    kind: z.literal("screenshot"),
    format: z.enum(["png", "jpeg"]).optional(),
    quality: z.number().int().min(1).max(100).optional(),
  })
  .strict();
const browserScreenshotFullPageActionSchema = z
  .object({ kind: z.literal("screenshot-full-page") })
  .strict();
const browserScreenshotElementActionSchema = z
  .object({
    kind: z.literal("screenshot-element"),
    locator: browserPageLocatorSchema,
    format: z.enum(["png", "jpeg"]),
    quality: z.number().int().min(1).max(100),
  })
  .strict();
const browserScriptActionSchema = z
  .object({
    kind: z.literal("script"),
    frame: browserFrameTargetSchema.optional(),
    world: z.enum(["isolated", "main"]).optional(),
    source: z
      .string()
      .min(1)
      .refine(
        (value) =>
          new TextEncoder().encode(value).byteLength <=
          BROWSER_CONTROL_MAX_SCRIPT_SOURCE_BYTES,
        "Browser script source exceeds the byte limit",
      ),
    input: jsonValueSchema.refine(
      (value) => jsonByteLength(value) <= BROWSER_CONTROL_MAX_INPUT_BYTES,
      "Browser script input exceeds the byte limit",
    ),
    timeoutMs: z
      .number()
      .int()
      .min(BROWSER_CONTROL_MIN_TIMEOUT_MS)
      .max(BROWSER_CONTROL_MAX_TIMEOUT_MS),
  })
  .strict();
const browserTrustLocalhostCertificateActionSchema = z
  .object({
    kind: z.literal("trust-localhost-certificate"),
  })
  .strict();
export type BrowserControlActionVariant = z.ZodTypeAny;
export const browserControlActionVariants = {
  "list-frames": browserListFramesActionSchema,
  snapshot: browserSnapshotActionSchema,
  click: browserPointerActionSchema("click"),
  hover: browserPointerActionSchema("hover"),
  "double-click": browserPointerActionSchema("double-click"),
  "right-click": browserPointerActionSchema("right-click"),
  "middle-click": browserPointerActionSchema("middle-click"),
  drag: browserDragActionSchema,
  type: browserTypeActionSchema,
  select: browserSelectActionSchema,
  "select-multiple": browserSelectMultipleActionSchema,
  upload: browserUploadActionSchema,
  check: browserCheckActionSchema,
  uncheck: browserUncheckActionSchema,
  focus: browserFocusActionSchema,
  "scroll-into-view": browserScrollIntoViewActionSchema,
  key: browserKeyActionSchema,
  scroll: browserScrollActionSchema,
  navigate: browserNavigateActionSchema,
  "open-tab": browserOpenTabActionSchema,
  "activate-tab": browserActivateTabActionSchema,
  "close-tab": browserCloseTabActionSchema,
  back: browserBackActionSchema,
  forward: browserForwardActionSchema,
  reload: browserReloadActionSchema,
  "set-viewport-profile": browserSetViewportProfileActionSchema,
  wait: browserWaitActionSchema,
  "clear-viewport-profile": browserClearViewportProfileActionSchema,
  "set-dialog-handler": browserSetDialogHandlerActionSchema,
  "set-permissions": browserSetPermissionsActionSchema,
  diagnostics: browserDiagnosticsActionSchema,
  "get-storage": browserGetStorageActionSchema,
  "set-storage": browserSetStorageActionSchema,
  "clear-storage": browserClearStorageActionSchema,
  "list-cookie-import-sources": browserListCookieImportSourcesActionSchema,
  "import-cookies-from-browser": browserImportCookiesFromBrowserActionSchema,
  "clear-imported-cookies": browserClearImportedCookiesActionSchema,
  screenshot: browserScreenshotActionSchema,
  "screenshot-full-page": browserScreenshotFullPageActionSchema,
  "screenshot-element": browserScreenshotElementActionSchema,
  script: browserScriptActionSchema,
  "trust-localhost-certificate": browserTrustLocalhostCertificateActionSchema,
} as const satisfies Record<string, z.ZodTypeAny>;
export type BrowserControlActionKind =
  keyof typeof browserControlActionVariants;
const browserCaptureCreateSchema = z
  .object({
    kind: z.literal("capture"),
    mode: z.enum(["viewport", "full-page", "element"]),
    format: z.enum(["png", "jpeg"]).optional(),
    quality: z.number().int().min(1).max(100).optional(),
    locator: browserPageLocatorSchema.optional(),
  })
  .strict();
export const BROWSER_CAPTURE_MAX_BYTES = 256 * 1024 * 1024;
export const BROWSER_CAPTURE_AGGREGATE_MAX_BYTES = 512 * 1024 * 1024;
export const BROWSER_CAPTURE_TTL_MS = 2 * 60_000;
export const BROWSER_CAPTURE_CHUNK_BYTES = 262_144;
export const BROWSER_CAPTURE_MAX_LIFETIME_MS = 10 * 60_000;
export const browserCapturePixelSizeSchema = z
  .object({
    width: z.number().int().positive().max(32_768),
    height: z.number().int().positive().max(32_768),
  })
  .strict()
  .refine(
    ({ width, height }) => width * height <= 50_000_000,
    "Browser capture exceeds the pixel limit",
  );
export const browserCaptureByteLengthSchema = z
  .number()
  .int()
  .positive()
  .max(BROWSER_CAPTURE_MAX_BYTES);
/**
 * Canonical public descriptor for one bounded immutable Browser capture,
 * whether the bytes come from the native page or a plugin-generated image.
 * `target` carries the full original tab identity including the
 * `navigationEpoch` the capture describes; reads of the completed bytes stay
 * valid across navigation, while creating a capture rejects stale targets.
 * `expiresAt` is the broker-authoritative lease end (ms epoch).
 */
export const browserCaptureDescriptorSchema = z
  .object({
    captureId: z.string().min(1).max(256),
    mimeType: z.enum(["image/png", "image/jpeg"]),
    pixelSize: browserCapturePixelSizeSchema,
    byteLength: browserCaptureByteLengthSchema,
    target: browserTabTargetSchema,
    expiresAt: z.number().int().positive(),
  })
  .strict();
export type BrowserCaptureDescriptor = z.infer<
  typeof browserCaptureDescriptorSchema
>;
export const browserCaptureResultSchema = z
  .object({
    format: z.enum(["png", "jpeg"]),
    captureId: z.string().min(1).max(256),
    pixelSize: browserCapturePixelSizeSchema,
    byteLength: browserCaptureByteLengthSchema,
  })
  .strict();
export type BrowserCaptureResult = z.infer<typeof browserCaptureResultSchema>;
const browserCaptureAssemblyDescriptorSchema = z
  .object({
    captureId: z.string().min(1).max(256),
    byteLength: browserCaptureByteLengthSchema,
  })
  .passthrough();
export const browserCaptureReadRequestSchema = z
  .object({
    captureId: z.string().min(1).max(256),
    offset: z.number().int().nonnegative(),
    length: z.number().int().min(1).max(262_144),
  })
  .strict();
export type BrowserCaptureReadRequest = z.infer<
  typeof browserCaptureReadRequestSchema
>;
export const browserCaptureReadResponseSchema = z
  .object({
    captureId: z.string().min(1).max(256),
    offset: z.number().int().nonnegative(),
    base64: z
      .string()
      .min(4)
      .max(4 * Math.ceil(BROWSER_CAPTURE_CHUNK_BYTES / 3))
      .regex(
        /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
      ),
    eof: z.boolean(),
  })
  .strict();
export type BrowserCaptureReadResponse = z.infer<
  typeof browserCaptureReadResponseSchema
>;

export function decodeBrowserCaptureChunk(
  chunk: BrowserCaptureReadResponse,
  request: BrowserCaptureReadRequest,
  byteLength: number,
): Uint8Array {
  const parsed = browserCaptureReadResponseSchema.parse(chunk);
  if (
    parsed.captureId !== request.captureId ||
    parsed.offset !== request.offset
  ) {
    throw new Error("Browser capture chunk has a foreign resource or offset");
  }
  const binary = atob(parsed.base64);
  if (btoa(binary) !== parsed.base64) {
    throw new Error("Browser capture chunk has invalid base64 padding");
  }
  const expected = Math.min(request.length, byteLength - request.offset);
  if (
    binary.length !== expected ||
    expected <= 0 ||
    parsed.eof !== (request.offset + binary.length === byteLength)
  ) {
    throw new Error("Browser capture chunk has an invalid range or end marker");
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export async function assembleBrowserCapture(args: {
  descriptor: { captureId: string; byteLength: number };
  signal?: AbortSignal;
  read(request: BrowserCaptureReadRequest): Promise<BrowserCaptureReadResponse>;
  release(): Promise<unknown>;
}): Promise<Uint8Array<ArrayBuffer>> {
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    args.signal?.throwIfAborted();
    const descriptor = browserCaptureAssemblyDescriptorSchema.parse(
      args.descriptor,
    );
    bytes = new Uint8Array(descriptor.byteLength);
    for (let offset = 0; offset < bytes.length;) {
      args.signal?.throwIfAborted();
      const request = {
        captureId: descriptor.captureId,
        offset,
        length: Math.min(BROWSER_CAPTURE_CHUNK_BYTES, bytes.length - offset),
      };
      const chunk = await args.read(request);
      args.signal?.throwIfAborted();
      const decoded = decodeBrowserCaptureChunk(chunk, request, bytes.length);
      bytes.set(decoded, offset);
      offset += decoded.length;
    }
  } catch (error) {
    try {
      await args.release();
    } catch (releaseError) {
      throw new AggregateError(
        [error, releaseError],
        "Browser capture and resource release failed",
      );
    }
    throw error;
  }
  await args.release();
  return bytes;
}
export const browserCaptureReleaseRequestSchema = z
  .object({
    captureId: z.string().min(1).max(256),
  })
  .strict();
export type BrowserCaptureReleaseRequest = z.infer<
  typeof browserCaptureReleaseRequestSchema
>;
export const browserCaptureCreateMessageSchema = z
  .object({
    type: z.literal("browser-capture-create"),
    requestId: z.string().min(1).max(128),
    tabId: z.string().min(1).max(256),
    format: z.enum(["png", "jpeg"]).optional(),
    quality: z.number().int().min(1).max(100).optional(),
    expectedNavigationEpoch: z.number().int().nonnegative(),
    mode: z.enum(["viewport", "full-page", "element"]),
    locator: browserPageLocatorSchema.optional(),
  })
  .strict();
export type BrowserCaptureCreateMessage = z.infer<
  typeof browserCaptureCreateMessageSchema
>;
export const browserCaptureDescriptorMessageSchema = z.discriminatedUnion(
  "ok",
  [
    browserCaptureResultSchema.extend({
      type: z.literal("browser-capture-created"),
      requestId: z.string().min(1).max(128),
      navigationEpoch: z.number().int().nonnegative(),
      ok: z.literal(true),
    }),
    z
      .object({
        type: z.literal("browser-capture-created"),
        requestId: z.string().min(1).max(128),
        ok: z.literal(false),
        error: browserControlErrorSchema,
      })
      .strict(),
  ],
);
export type BrowserCaptureDescriptorMessage = z.infer<
  typeof browserCaptureDescriptorMessageSchema
>;
export const browserCaptureReadRequestMessageSchema =
  browserCaptureReadRequestSchema.extend({
    type: z.literal("browser-capture-read"),
    requestId: z.string().min(1).max(128),
    tabId: z.string().min(1).max(256),
  });
export type BrowserCaptureReadRequestMessage = z.infer<
  typeof browserCaptureReadRequestMessageSchema
>;
export const browserCaptureReadResponseMessageSchema = z.discriminatedUnion(
  "ok",
  [
    browserCaptureReadResponseSchema.extend({
      type: z.literal("browser-capture-chunk"),
      requestId: z.string().min(1).max(128),
      tabId: z.string().min(1).max(256),
      ok: z.literal(true),
    }),
    z
      .object({
        type: z.literal("browser-capture-chunk"),
        requestId: z.string().min(1).max(128),
        tabId: z.string().min(1).max(256),
        captureId: z.string().min(1).max(256),
        offset: z.number().int().nonnegative(),
        ok: z.literal(false),
        error: browserControlErrorSchema,
      })
      .strict(),
  ],
);
export type BrowserCaptureReadResponseMessage = z.infer<
  typeof browserCaptureReadResponseMessageSchema
>;
export const browserCaptureReleaseMessageSchema =
  browserCaptureReleaseRequestSchema.extend({
    type: z.literal("browser-capture-release"),
    requestId: z.string().min(1).max(128),
    tabId: z.string().min(1).max(256),
  });
export type BrowserCaptureReleaseMessage = z.infer<
  typeof browserCaptureReleaseMessageSchema
>;
/**
 * App→broker registration of an app-owned generated capture (for example a
 * plugin-exported annotated PNG). The app validates the image signature and
 * dimensions and keeps the bytes Blob-backed locally; the broker records
 * bounded provenance so SDK/CLI reads and releases route to this exact app
 * client, and enforces the same aggregate capacity and TTL as native
 * captures. `expectedNavigationEpoch` must equal the tab's current epoch —
 * creating a generated capture from a stale target rejects.
 */
export const browserCaptureRegisterMessageSchema = z
  .object({
    type: z.literal("browser-capture-register"),
    requestId: z.string().min(1).max(128),
    tabId: z.string().min(1).max(256),
    captureId: z.string().min(1).max(256),
    mimeType: z.enum(["image/png", "image/jpeg"]),
    pixelSize: browserCapturePixelSizeSchema,
    byteLength: browserCaptureByteLengthSchema,
    expectedNavigationEpoch: z.number().int().nonnegative(),
  })
  .strict();
export type BrowserCaptureRegisterMessage = z.infer<
  typeof browserCaptureRegisterMessageSchema
>;
/** Broker acknowledgement for a generated-capture registration. */
export const browserCaptureRegisteredMessageSchema = z.discriminatedUnion(
  "ok",
  [
    z
      .object({
        type: z.literal("browser-capture-registered"),
        requestId: z.string().min(1).max(128),
        captureId: z.string().min(1).max(256),
        ok: z.literal(true),
        expiresAt: z.number().int().positive(),
      })
      .strict(),
    z
      .object({
        type: z.literal("browser-capture-registered"),
        requestId: z.string().min(1).max(128),
        ok: z.literal(false),
        error: browserControlErrorSchema,
      })
      .strict(),
  ],
);
export type BrowserCaptureRegisteredMessage = z.infer<
  typeof browserCaptureRegisteredMessageSchema
>;
export const browserPluginRequestMessageSchema = z
  .object({
    type: z.literal("browser-plugin-request"),
    requestId: z.string().min(1).max(128),
    pluginId: z.string().min(1).max(256),
    target: browserTabTargetSchema,
    controllerId: z.string().min(1).max(256),
    registrationId: z.string().uuid(),
    input: jsonValueSchema.refine(
      (value) => jsonByteLength(value) <= BROWSER_CONTROL_MAX_INPUT_BYTES,
      "Browser contribution input exceeds the byte limit",
    ),
  })
  .strict();
export type BrowserPluginRequestMessage = z.infer<
  typeof browserPluginRequestMessageSchema
>;
export const browserPluginResponseMessageSchema = z
  .object({
    type: z.literal("browser-plugin-response"),
    requestId: z.string().min(1).max(128),
    pluginId: z.string().min(1).max(256),
    controllerId: z.string().min(1).max(256),
    registrationId: z.string().uuid(),
    ok: z.boolean(),
    value: jsonValueSchema.optional(),
    error: browserControlErrorSchema.optional(),
  })
  .strict();
export type BrowserPluginResponseMessage = z.infer<
  typeof browserPluginResponseMessageSchema
>;

export const browserAgentControlActionSchema = z.discriminatedUnion("kind", [
  browserControlActionVariants["list-frames"],
  browserControlActionVariants["snapshot"],
  browserControlActionVariants["click"],
  browserControlActionVariants["hover"],
  browserControlActionVariants["double-click"],
  browserControlActionVariants["right-click"],
  browserControlActionVariants["middle-click"],
  browserControlActionVariants["drag"],
  browserControlActionVariants["type"],
  browserControlActionVariants["select"],
  browserControlActionVariants["select-multiple"],
  browserControlActionVariants["upload"],
  browserControlActionVariants["check"],
  browserControlActionVariants["uncheck"],
  browserControlActionVariants["focus"],
  browserControlActionVariants["scroll-into-view"],
  browserControlActionVariants["key"],
  browserControlActionVariants["scroll"],
  browserControlActionVariants["navigate"],
  browserControlActionVariants["open-tab"],
  browserControlActionVariants["activate-tab"],
  browserControlActionVariants["close-tab"],
  browserControlActionVariants["back"],
  browserControlActionVariants["forward"],
  browserControlActionVariants["reload"],
  browserControlActionVariants["set-viewport-profile"],
  browserControlActionVariants["wait"],
  browserControlActionVariants["clear-viewport-profile"],
  browserControlActionVariants["set-dialog-handler"],
  browserControlActionVariants["set-permissions"],
  browserControlActionVariants["diagnostics"],
  browserControlActionVariants["get-storage"],
  browserControlActionVariants["set-storage"],
  browserControlActionVariants["clear-storage"],
  browserControlActionVariants["list-cookie-import-sources"],
  browserControlActionVariants["import-cookies-from-browser"],
  browserControlActionVariants["clear-imported-cookies"],
  browserControlActionVariants["screenshot"],
  browserControlActionVariants["screenshot-full-page"],
  browserControlActionVariants["screenshot-element"],
  browserControlActionVariants["trust-localhost-certificate"],
]);
export const browserControlActionSchema = z.discriminatedUnion("kind", [
  browserControlActionVariants["list-frames"],
  browserControlActionVariants["snapshot"],
  browserControlActionVariants["click"],
  browserControlActionVariants["hover"],
  browserControlActionVariants["double-click"],
  browserControlActionVariants["right-click"],
  browserControlActionVariants["middle-click"],
  browserControlActionVariants["drag"],
  browserControlActionVariants["type"],
  browserControlActionVariants["select"],
  browserControlActionVariants["select-multiple"],
  browserControlActionVariants["upload"],
  browserControlActionVariants["check"],
  browserControlActionVariants["uncheck"],
  browserControlActionVariants["focus"],
  browserControlActionVariants["scroll-into-view"],
  browserControlActionVariants["key"],
  browserControlActionVariants["scroll"],
  browserControlActionVariants["navigate"],
  browserControlActionVariants["open-tab"],
  browserControlActionVariants["activate-tab"],
  browserControlActionVariants["close-tab"],
  browserControlActionVariants["back"],
  browserControlActionVariants["forward"],
  browserControlActionVariants["reload"],
  browserControlActionVariants["set-viewport-profile"],
  browserControlActionVariants["wait"],
  browserControlActionVariants["clear-viewport-profile"],
  browserControlActionVariants["set-dialog-handler"],
  browserControlActionVariants["set-permissions"],
  browserControlActionVariants["diagnostics"],
  browserControlActionVariants["get-storage"],
  browserControlActionVariants["set-storage"],
  browserControlActionVariants["clear-storage"],
  browserControlActionVariants["list-cookie-import-sources"],
  browserControlActionVariants["import-cookies-from-browser"],
  browserControlActionVariants["clear-imported-cookies"],
  browserControlActionVariants["screenshot"],
  browserControlActionVariants["screenshot-full-page"],
  browserControlActionVariants["screenshot-element"],
  browserControlActionVariants["script"],
  browserControlActionVariants["trust-localhost-certificate"],
  browserCaptureCreateSchema,
]);
export type BrowserControlAction = z.infer<typeof browserControlActionSchema>;
export type BrowserAgentControlAction = z.infer<
  typeof browserAgentControlActionSchema
>;

export const browserControllerRegistrationSchema = z
  .object({
    pluginId: z.string().min(1).max(256),
    controllerId: z.string().min(1).max(256),
    tabId: z.string().min(1).max(256),
    registrationId: z.string().uuid(),
  })
  .strict();
export type BrowserControllerRegistration = z.infer<
  typeof browserControllerRegistrationSchema
>;

export const browserClientStateMessageSchema = z
  .object({
    type: z.literal("browser-client-state"),
    clientId: z.string().min(1).max(128),
    windowId: z.string().min(1).max(128),
    active: z.boolean(),
    canActivateThreadOwner: z.boolean(),
    tabs: z
      .array(
        browserTabDescriptorSchema.omit({ clientId: true, windowId: true }),
      )
      .max(128),
    controllers: z
      .array(browserControllerRegistrationSchema)
      .max(512)
      .superRefine((controllers, context) => {
        const keys = new Set<string>();
        for (const [index, controller] of controllers.entries()) {
          const key = `${controller.pluginId}\u0000${controller.controllerId}\u0000${controller.tabId}`;
          if (keys.has(key)) {
            context.addIssue({
              code: "custom",
              message:
                "Browser controller registrations must be unique per plugin, controller, and tab",
              path: [index],
            });
          }
          keys.add(key);
        }
      }),
    owners: z
      .array(
        browserTabOwnerDescriptorSchema.omit({
          clientId: true,
          windowId: true,
        }),
      )
      .max(32),
  })
  .strict();
export type BrowserClientStateMessage = z.infer<
  typeof browserClientStateMessageSchema
>;

export const browserControlRequestMessageSchema = z
  .object({
    type: z.literal("browser-control-request"),
    requestId: z.string().min(1).max(128),
    target: browserTabTargetSchema,
    action: browserControlActionSchema,
    actionabilityPolicy: browserActionabilityPolicySchema,
  })
  .strict();
export type BrowserControlRequestMessage = z.infer<
  typeof browserControlRequestMessageSchema
>;

const browserOpenTabRequestBaseSchema = z.object({
  type: z.literal("browser-open-tab-request"),
  requestId: z.string().min(1).max(128),
  clientId: z.string().min(1).max(128),
  windowId: z.string().min(1).max(128),
  url: z.string().min(1).max(16_384),
});

export const browserOpenTabRequestMessageSchema = z.discriminatedUnion("mode", [
  browserOpenTabRequestBaseSchema
    .extend({
      mode: z.literal("owner"),
      ownerId: z.string().min(1).max(256),
    })
    .strict(),
  browserOpenTabRequestBaseSchema
    .extend({
      mode: z.literal("thread"),
      threadId: z.string().min(1).max(256),
      projectId: z.string().min(1).max(256),
    })
    .strict(),
]);
export type BrowserOpenTabRequestMessage = z.infer<
  typeof browserOpenTabRequestMessageSchema
>;

export const browserOpenTabResponseMessageSchema = z
  .object({
    type: z.literal("browser-open-tab-response"),
    requestId: z.string().min(1).max(128),
    clientId: z.string().min(1).max(128),
    windowId: z.string().min(1).max(128),
    ownerId: z.string().min(1).max(256),
    ok: z.boolean(),
    target: browserTabTargetSchema.optional(),
    error: browserControlErrorSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.ok === (value.target === undefined) ||
      value.ok === (value.error !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "successful responses require target; failures require error",
      });
    }
  });
export type BrowserOpenTabResponseMessage = z.infer<
  typeof browserOpenTabResponseMessageSchema
>;
export const browserControlCancelMessageSchema = z
  .object({
    type: z.literal("browser-control-cancel"),
    requestId: z.string().min(1).max(128),
    reason: z.enum([
      "cancelled",
      "timeout",
      "client-disconnected",
      "target-changed",
    ]),
  })
  .strict();
export type BrowserControlCancelMessage = z.infer<
  typeof browserControlCancelMessageSchema
>;

export const browserControlResponseMessageSchema = z
  .object({
    type: z.literal("browser-control-response"),
    requestId: z.string().min(1).max(128),
    target: browserTabTargetSchema,
    observedTarget: browserTabTargetSchema.optional(),
    ok: z.boolean(),
    value: jsonValueSchema.optional(),
    error: browserControlErrorSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.ok === (value.value === undefined) ||
      value.ok === (value.error !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "successful responses require value; failures require error",
      });
    }
    if (jsonByteLength(value) > BROWSER_CONTROL_MAX_RESULT_BYTES) {
      context.addIssue({
        code: "custom",
        message: "Browser response is too large",
      });
    }
  });
export type BrowserControlResponseMessage = z.infer<
  typeof browserControlResponseMessageSchema
>;
