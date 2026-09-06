import { z } from "zod";
import {
  browserFrameDescriptorSchema,
  browserFrameTargetSchema,
  browserWaitCriteriaSchema,
  browserCaptureResultSchema,
  browserCaptureReadResponseSchema,
} from "@bb/domain";
import type {
  BrowserFrameDescriptor,
  BrowserFrameTarget,
} from "@bb/domain";

export const BB_DESKTOP_BROWSER_MAX_URL_LENGTH = 4096;
export const BB_DESKTOP_BROWSER_MAX_TITLE_LENGTH = 1024;

const bbDesktopBrowserViewBoundsSchema = z
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

interface ClampBbDesktopBrowserViewBoundsArgs {
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

export const bbDesktopBrowserTabRefSchema = z
  .object({
    tabId: z.string().min(1),
  })
  .strict();
export type BbDesktopBrowserTabRef = z.infer<
  typeof bbDesktopBrowserTabRefSchema
>;

const bbDesktopBrowserCookieImportSchema = z
  .object({
    name: z.string().min(1).max(4096),
    value: z.string().max(65_536),
    domain: z.string().min(1).max(4096),
    path: z.string().min(1).max(4096),
    secure: z.boolean(),
    httpOnly: z.boolean(),
    sameSite: z.enum(["no_restriction", "lax", "strict", "unspecified"]),
    expirationDate: z.number().finite().positive().nullable(),
  })
  .strict();
export type BbDesktopBrowserCookieImport = z.infer<
  typeof bbDesktopBrowserCookieImportSchema
>;
export const bbDesktopBrowserCookieImportSourceSchema = z
  .object({
    family: z.string().min(1).max(64),
    label: z.string().min(1).max(256),
    profiles: z
      .array(
        z
          .object({
            id: z.string().min(1).max(256),
            label: z.string().min(1).max(256),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();
export type BbDesktopBrowserCookieImportSource = z.infer<
  typeof bbDesktopBrowserCookieImportSourceSchema
>;

export const bbDesktopBrowserListCookieImportSourcesRequestSchema = z
  .object({ tabId: z.string().min(1) })
  .strict();
export type BbDesktopBrowserListCookieImportSourcesRequest = z.infer<
  typeof bbDesktopBrowserListCookieImportSourcesRequestSchema
>;

export const bbDesktopBrowserListCookieImportSourcesResultSchema = z
  .object({
    sources: z.array(bbDesktopBrowserCookieImportSourceSchema).max(16),
  })
  .strict();
export type BbDesktopBrowserListCookieImportSourcesResult = z.infer<
  typeof bbDesktopBrowserListCookieImportSourcesResultSchema
>;

export const bbDesktopBrowserImportCookiesFromBrowserRequestSchema = z
  .object({
    family: z.string().min(1).max(64),
    profileId: z.string().min(1).max(256),
    tabId: z.string().min(1),
  })
  .strict();
export type BbDesktopBrowserImportCookiesFromBrowserRequest = z.infer<
  typeof bbDesktopBrowserImportCookiesFromBrowserRequestSchema
>;

export const bbDesktopBrowserImportCookiesRequestSchema = z
  .object({
    tabId: z.string().min(1),
    cookies: z.array(bbDesktopBrowserCookieImportSchema).min(1).max(5_000),
  })
  .strict();
export type BbDesktopBrowserImportCookiesRequest = z.infer<
  typeof bbDesktopBrowserImportCookiesRequestSchema
>;

export const bbDesktopBrowserImportCookiesResultSchema = z
  .object({
    importedCookies: z.number().int().nonnegative(),
  })
  .strict();
export type BbDesktopBrowserImportCookiesResult = z.infer<
  typeof bbDesktopBrowserImportCookiesResultSchema
>;

export const bbDesktopBrowserStateSchema = z
  .object({
    tabId: z.string().min(1),
    url: z.string().max(BB_DESKTOP_BROWSER_MAX_URL_LENGTH),
    title: z.string().max(BB_DESKTOP_BROWSER_MAX_TITLE_LENGTH).nullable(),
    isLoading: z.boolean(),
    canGoBack: z.boolean(),
    canGoForward: z.boolean(),
    errorText: z.string().max(BB_DESKTOP_BROWSER_MAX_TITLE_LENGTH).nullable(),
    /** Present when the desktop shell supports exact page-runtime targeting. */
    navigationEpoch: z.number().int().nonnegative().optional(),
  })
  .strict();
export type BbDesktopBrowserState = z.infer<typeof bbDesktopBrowserStateSchema>;

export const bbDesktopBrowserOpenTabRequestSchema = z
  .object({
    url: z.string().min(1).max(BB_DESKTOP_BROWSER_MAX_URL_LENGTH),
  })
  .strict();
export type BbDesktopBrowserOpenTabRequest = z.infer<
  typeof bbDesktopBrowserOpenTabRequestSchema
>;

export const bbDesktopBrowserScopedOpenTabRequestSchema = z
  .object({
    tabId: z.string().min(1),
    url: z.string().min(1).max(BB_DESKTOP_BROWSER_MAX_URL_LENGTH),
  })
  .strict();
export type BbDesktopBrowserScopedOpenTabRequest = z.infer<
  typeof bbDesktopBrowserScopedOpenTabRequestSchema
>;

const BB_DESKTOP_BROWSER_MAX_SNAPSHOT_DATA_URL_LENGTH = 8_388_608;

/** Hard limits for the Browser-page isolated-world runtime. */
export const BB_DESKTOP_BROWSER_PAGE_SCRIPT_MAX_SOURCE_BYTES = 64 * 1024;
export const BB_DESKTOP_BROWSER_PAGE_SCRIPT_MAX_INPUT_BYTES = 8 * 1024 * 1024;
export const BB_DESKTOP_BROWSER_PAGE_SCRIPT_MAX_RESULT_BYTES = 512 * 1024;
export const BB_DESKTOP_BROWSER_PAGE_SCRIPT_MIN_TIMEOUT_MS = 100;
export const BB_DESKTOP_BROWSER_PAGE_SCRIPT_MAX_TIMEOUT_MS = 120_000;
export const BB_DESKTOP_BROWSER_PAGE_RUNTIME_VERSION = 1 as const;

export type BbDesktopBrowserJsonValue =
  | null
  | boolean
  | number
  | string
  | BbDesktopBrowserJsonValue[]
  | { [key: string]: BbDesktopBrowserJsonValue };

export const bbDesktopBrowserJsonValueSchema: z.ZodType<BbDesktopBrowserJsonValue> =
  z.lazy(() =>
    z.union([
      z.null(),
      z.boolean(),
      z.number().finite(),
      z.string(),
      z.array(bbDesktopBrowserJsonValueSchema),
      z.record(z.string(), bbDesktopBrowserJsonValueSchema),
    ]),
  );

function jsonByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

/** A new invoke channel carries this shape; the frozen attach wire is unchanged. */
export const bbDesktopBrowserPageScriptRequestSchema = z
  .object({
    tabId: z.string().min(1).max(256),
    expectedNavigationEpoch: z.number().int().nonnegative(),
    frame: browserFrameTargetSchema.optional(),
    requestId: z.string().min(1).max(128),
    world: z.enum(["isolated", "main"]).optional(),
    /** Function expression receiving `{ input, signal }` in the requested world. */
    source: z
      .string()
      .min(1)
      .refine(
        (value) =>
          new TextEncoder().encode(value).byteLength <=
          BB_DESKTOP_BROWSER_PAGE_SCRIPT_MAX_SOURCE_BYTES,
        "Browser page script source exceeds the byte limit",
      ),
    input: bbDesktopBrowserJsonValueSchema.refine(
      (value) =>
        jsonByteLength(value) <= BB_DESKTOP_BROWSER_PAGE_SCRIPT_MAX_INPUT_BYTES,
      "Browser page script input exceeds the byte limit",
    ),
    timeoutMs: z
      .number()
      .int()
      .min(BB_DESKTOP_BROWSER_PAGE_SCRIPT_MIN_TIMEOUT_MS)
      .max(BB_DESKTOP_BROWSER_PAGE_SCRIPT_MAX_TIMEOUT_MS),
  })
  .strict();
export type BbDesktopBrowserPageScriptRequest = z.infer<
  typeof bbDesktopBrowserPageScriptRequestSchema
>;

export const bbDesktopBrowserPageScriptCancelRequestSchema = z
  .object({
    tabId: z.string().min(1).max(256),
    requestId: z.string().min(1).max(128),
  })
  .strict();
export type BbDesktopBrowserPageScriptCancelRequest = z.infer<
  typeof bbDesktopBrowserPageScriptCancelRequestSchema
>;

export const bbDesktopBrowserPageScriptResultSchema = z
  .object({
    frame: browserFrameTargetSchema.optional(),
    requestId: z.string().min(1).max(128),
    navigationEpoch: z.number().int().nonnegative(),
    value: bbDesktopBrowserJsonValueSchema,
  })
  .strict()
  .refine(
    (value) =>
      jsonByteLength(value.value) <=
      BB_DESKTOP_BROWSER_PAGE_SCRIPT_MAX_RESULT_BYTES,
    "Browser page script result exceeds the byte limit",
  );
export type BbDesktopBrowserPageScriptResult = z.infer<
  typeof bbDesktopBrowserPageScriptResultSchema
>;

export const BB_DESKTOP_BROWSER_MAX_FRAMES = 64;
export const BB_DESKTOP_BROWSER_FRAME_RUNTIME_VERSION = 1 as const;
export const BB_DESKTOP_BROWSER_TRUSTED_INPUT_VERSION = 1 as const;
export const BB_DESKTOP_BROWSER_EVENT_WAIT_VERSION = 1 as const;

export const bbDesktopBrowserFrameTargetSchema = browserFrameTargetSchema;
export type { BrowserFrameTarget };
export const bbDesktopBrowserFrameDescriptorSchema =
  browserFrameDescriptorSchema;
export type { BrowserFrameDescriptor };

export const bbDesktopBrowserListFramesRequestSchema = z
  .object({
    tabId: z.string().min(1).max(256),
    expectedNavigationEpoch: z.number().int().nonnegative(),
    maxFrames: z.number().int().min(1).max(BB_DESKTOP_BROWSER_MAX_FRAMES),
  })
  .strict();
export type BbDesktopBrowserListFramesRequest = z.infer<
  typeof bbDesktopBrowserListFramesRequestSchema
>;

export const bbDesktopBrowserListFramesResultSchema = z
  .object({
    navigationEpoch: z.number().int().nonnegative(),
    frames: z
      .array(bbDesktopBrowserFrameDescriptorSchema)
      .max(BB_DESKTOP_BROWSER_MAX_FRAMES),
  })
  .strict();
export type BbDesktopBrowserListFramesResult = z.infer<
  typeof bbDesktopBrowserListFramesResultSchema
>;

const bbDesktopBrowserTrustedInputActionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("click"),
      x: z.number().finite().nonnegative(),
      y: z.number().finite().nonnegative(),
      button: z.enum(["left", "middle", "right"]),
      clickCount: z.number().int().min(1).max(2),
    })
    .strict(),
  z
    .object({
      kind: z.literal("type"),
      text: z.string().max(65_536),
      clear: z.boolean(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("key"),
      key: z.string().min(1).max(64),
      code: z.string().min(1).max(64).optional(),
      modifiers: z
        .array(z.enum(["Alt", "Control", "Meta", "Shift"]))
        .max(4)
        .refine(
          (value) => new Set(value).size === value.length,
          "Trusted input modifiers must be unique",
        ),
    })
    .strict(),
]);
export type BbDesktopBrowserTrustedInputAction = z.infer<
  typeof bbDesktopBrowserTrustedInputActionSchema
>;

export const bbDesktopBrowserTrustedInputRequestSchema = z
  .object({
    tabId: z.string().min(1).max(256),
    expectedNavigationEpoch: z.number().int().nonnegative(),
    requestId: z.string().min(1).max(128),
    frame: bbDesktopBrowserFrameTargetSchema.optional(),
    action: bbDesktopBrowserTrustedInputActionSchema,
  })
  .strict();
export type BbDesktopBrowserTrustedInputRequest = z.infer<
  typeof bbDesktopBrowserTrustedInputRequestSchema
>;
export const bbDesktopBrowserTrustedInputCancelRequestSchema = z
  .object({
    tabId: z.string().min(1).max(256),
    requestId: z.string().min(1).max(128),
  })
  .strict();
export type BbDesktopBrowserTrustedInputCancelRequest = z.infer<
  typeof bbDesktopBrowserTrustedInputCancelRequestSchema
>;

export const bbDesktopBrowserTrustedInputResultSchema = z
  .object({
    navigationEpoch: z.number().int().nonnegative(),
    frame: bbDesktopBrowserFrameTargetSchema.optional(),
    dispatched: z.number().int().min(1).max(8),
  })
  .strict();
export type BbDesktopBrowserTrustedInputResult = z.infer<
  typeof bbDesktopBrowserTrustedInputResultSchema
>;

export const bbDesktopBrowserWaitRequestSchema = z
  .object({
    tabId: z.string().min(1).max(256),
    expectedNavigationEpoch: z.number().int().nonnegative(),
    requestId: z.string().min(1).max(128),
    criteria: browserWaitCriteriaSchema,
  })
  .strict();
export type BbDesktopBrowserWaitRequest = z.infer<
  typeof bbDesktopBrowserWaitRequestSchema
>;

export const bbDesktopBrowserWaitCancelRequestSchema = z
  .object({
    tabId: z.string().min(1).max(256),
    requestId: z.string().min(1).max(128),
  })
  .strict();
export type BbDesktopBrowserWaitCancelRequest = z.infer<
  typeof bbDesktopBrowserWaitCancelRequestSchema
>;

const bbDesktopBrowserWaitObservationSchema = z
  .object({
    kind: z.enum([
      "locator",
      "text",
      "url",
      "navigation",
      "load-state",
      "popup",
      "request",
      "response",
      "download-blocked",
    ]),
    url: z.string().max(4_096).optional(),
    method: z.string().max(16).optional(),
    status: z.number().int().min(100).max(599).optional(),
    phase: z.enum(["start", "commit", "complete"]).optional(),
    sameDocument: z.boolean().optional(),
    state: z.enum(["domcontentloaded", "load", "networkidle"]).optional(),
    blocked: z.boolean().optional(),
  })
  .strict();

export const bbDesktopBrowserWaitResultSchema = z
  .object({
    requestId: z.string().min(1).max(128),
    navigationEpoch: z.number().int().nonnegative(),
    value: bbDesktopBrowserWaitObservationSchema,
  })
  .strict();
export type BbDesktopBrowserWaitResult = z.infer<
  typeof bbDesktopBrowserWaitResultSchema
>;


export const bbDesktopBrowserPointerInputEventSchema = z.discriminatedUnion(
  "type",
  [
    z
      .object({
        type: z.literal("mouseMove"),
        x: z.number().finite().nonnegative(),
        y: z.number().finite().nonnegative(),
      })
      .strict(),
    z
      .object({
        type: z.literal("mouseDown"),
        x: z.number().finite().nonnegative(),
        y: z.number().finite().nonnegative(),
        button: z.enum(["left", "middle", "right"]),
        clickCount: z.number().int().min(1).max(2),
      })
      .strict(),
    z
      .object({
        type: z.literal("mouseUp"),
        x: z.number().finite().nonnegative(),
        y: z.number().finite().nonnegative(),
        button: z.enum(["left", "middle", "right"]),
        clickCount: z.number().int().min(1).max(2),
      })
      .strict(),
    z
      .object({
        type: z.literal("mouseWheel"),
        x: z.number().finite().nonnegative(),
        y: z.number().finite().nonnegative(),
        deltaX: z.number().finite(),
        deltaY: z.number().finite(),
      })
      .strict(),
  ],
);
export type BbDesktopBrowserPointerInputEvent = z.infer<
  typeof bbDesktopBrowserPointerInputEventSchema
>;

export const bbDesktopBrowserPointerInputRequestSchema = z
  .object({
    tabId: z.string().min(1).max(256),
    expectedNavigationEpoch: z.number().int().nonnegative(),
    requestId: z.string().min(1).max(128),
    frame: bbDesktopBrowserFrameTargetSchema.optional(),
    events: z.array(bbDesktopBrowserPointerInputEventSchema).min(1).max(32),
  })
  .strict();
export type BbDesktopBrowserPointerInputRequest = z.infer<
  typeof bbDesktopBrowserPointerInputRequestSchema
>;
export const bbDesktopBrowserPointerInputCancelRequestSchema = z
  .object({
    tabId: z.string().min(1).max(256),
    requestId: z.string().min(1).max(128),
  })
  .strict();
export type BbDesktopBrowserPointerInputCancelRequest = z.infer<
  typeof bbDesktopBrowserPointerInputCancelRequestSchema
>;

export const bbDesktopBrowserCloseRequestSchema = z
  .object({
    tabId: z.string().min(1).max(256),
    expectedNavigationEpoch: z.number().int().nonnegative(),
  })
  .strict();
export type BbDesktopBrowserCloseRequest = z.infer<
  typeof bbDesktopBrowserCloseRequestSchema
>;

export const bbDesktopBrowserCloseResultSchema = z
  .object({
    navigationEpoch: z.number().int().nonnegative(),
  })
  .strict();
export const bbDesktopBrowserTrustLocalhostCertificateResultSchema = z
  .object({
    navigationEpoch: z.number().int().nonnegative(),
    trustedOrigin: z.string().min(1).max(2_048),
  })
  .strict();
export type BbDesktopBrowserTrustLocalhostCertificateResult = z.infer<
  typeof bbDesktopBrowserTrustLocalhostCertificateResultSchema
>;
export type BbDesktopBrowserCloseResult = z.infer<
  typeof bbDesktopBrowserCloseResultSchema
>;

export const bbDesktopBrowserPointerInputResultSchema = z
  .object({
    navigationEpoch: z.number().int().nonnegative(),
    dispatched: z.number().int().nonnegative().max(32),
  })
  .strict();
export type BbDesktopBrowserPointerInputResult = z.infer<
  typeof bbDesktopBrowserPointerInputResultSchema
>;

export const bbDesktopBrowserViewportProfileSchema = z.enum([
  "phone-390x844",
  "tablet-768x1024",
  "desktop-1280x720",
]);
export type BbDesktopBrowserViewportProfile = z.infer<
  typeof bbDesktopBrowserViewportProfileSchema
>;

export const bbDesktopBrowserSetViewportProfileRequestSchema = z
  .object({
    tabId: z.string().min(1).max(256),
    expectedNavigationEpoch: z.number().int().nonnegative(),
    profile: bbDesktopBrowserViewportProfileSchema,
  })
  .strict();
export type BbDesktopBrowserSetViewportProfileRequest = z.infer<
  typeof bbDesktopBrowserSetViewportProfileRequestSchema
>;

export const bbDesktopBrowserClearViewportProfileRequestSchema = z
  .object({
    tabId: z.string().min(1).max(256),
    generation: z.number().int().positive().optional(),
  })
  .strict();
export type BbDesktopBrowserClearViewportProfileRequest = z.infer<
  typeof bbDesktopBrowserClearViewportProfileRequestSchema
>;

export const bbDesktopBrowserViewportProfileResultSchema = z
  .object({
    navigationEpoch: z.number().int().nonnegative(),
    generation: z.number().int().positive(),
    profile: bbDesktopBrowserViewportProfileSchema,
  })
  .strict();
export type BbDesktopBrowserViewportProfileResult = z.infer<
  typeof bbDesktopBrowserViewportProfileResultSchema
>;

export const bbDesktopBrowserPageCaptureRequestSchema = z
  .object({
    tabId: z.string().min(1).max(256),
    requestId: z.string().min(1).max(128),
    format: z.enum(["png", "jpeg"]),
    quality: z.number().int().min(1).max(100),
    expectedNavigationEpoch: z.number().int().nonnegative(),
  })
  .strict();
export type BbDesktopBrowserPageCaptureRequest = z.infer<
  typeof bbDesktopBrowserPageCaptureRequestSchema
>;
export const BB_DESKTOP_BROWSER_CAPTURE_MAX_ENCODED_BYTES = 256 * 1024 * 1024;
export const BB_DESKTOP_BROWSER_CAPTURE_AGGREGATE_MAX_BYTES = 512 * 1024 * 1024;
export const BB_DESKTOP_BROWSER_CAPTURE_TTL_MS = 120_000;
export const BB_DESKTOP_BROWSER_CAPTURE_MAX_LIFETIME_MS = 10 * 60_000;
export const BB_DESKTOP_BROWSER_CAPTURE_CHUNK_MAX_BYTES = 262_144;

export const bbDesktopBrowserCaptureDescriptorSchema = browserCaptureResultSchema.extend({
  navigationEpoch: z.number().int().nonnegative(),
});
export type BbDesktopBrowserCaptureDescriptor = z.infer<
  typeof bbDesktopBrowserCaptureDescriptorSchema
>;
export const bbDesktopBrowserCaptureChunkReadSchema = z
  .object({
    captureId: z.string().min(1).max(256),
    tabId: z.string().min(1).max(256),
    offset: z.number().int().nonnegative(),
    length: z
      .number()
      .int()
      .min(1)
      .max(BB_DESKTOP_BROWSER_CAPTURE_CHUNK_MAX_BYTES),
  })
  .strict();
export type BbDesktopBrowserCaptureChunkRead = z.infer<
  typeof bbDesktopBrowserCaptureChunkReadSchema
>;
export const bbDesktopBrowserCaptureChunkResultSchema = browserCaptureReadResponseSchema;
export type BbDesktopBrowserCaptureChunkResult = z.infer<
  typeof bbDesktopBrowserCaptureChunkResultSchema
>;
export const bbDesktopBrowserCaptureReleaseSchema = z
  .object({
    captureId: z.string().min(1).max(256),
    tabId: z.string().min(1).max(256),
  })
  .strict();
export type BbDesktopBrowserCaptureRelease = z.infer<
  typeof bbDesktopBrowserCaptureReleaseSchema
>;
export const bbDesktopBrowserPageCaptureCancelRequestSchema = z
  .object({
    tabId: z.string().min(1).max(256),
    requestId: z.string().min(1).max(128),
  })
  .strict();
export type BbDesktopBrowserPageCaptureCancelRequest = z.infer<
  typeof bbDesktopBrowserPageCaptureCancelRequestSchema
>;
export const bbDesktopBrowserPageCaptureResultSchema = bbDesktopBrowserCaptureDescriptorSchema;
export type BbDesktopBrowserPageCaptureResult = z.infer<
  typeof bbDesktopBrowserPageCaptureResultSchema
>;
export const bbDesktopBrowserAutomationRequestSchema = z
  .object({
    tabId: z.string().min(1).max(256),
    expectedNavigationEpoch: z.number().int().nonnegative(),
    action: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("set-dialog-handler"),
          behavior: z.enum(["accept", "dismiss"]),
          promptText: z.string().max(4_096).optional(),
        })
        .strict(),
      z
        .object({
          kind: z.literal("set-permissions"),
          decision: z.enum(["allow", "deny"]),
          origin: z.string().min(1).max(2_048),
          permissions: z.array(z.string().min(1).max(128)).max(16),
        })
        .strict(),
      z.object({ kind: z.literal("diagnostics") }).strict(),
      z
        .object({
          kind: z.literal("capture-full-page"),
          format: z.enum(["png", "jpeg"]),
          quality: z.number().int().min(1).max(100),
        })
        .strict(),
      z
        .object({
          kind: z.literal("capture-clip"),
          format: z.enum(["png", "jpeg"]),
          quality: z.number().int().min(1).max(100),
          x: z.number().finite().nonnegative(),
          y: z.number().finite().nonnegative(),
          width: z.number().finite().positive(),
          height: z.number().finite().positive(),
          frame: bbDesktopBrowserFrameTargetSchema.optional(),
        })
        .strict(),
    ]),
  })
  .strict();
export type BbDesktopBrowserAutomationRequest = z.infer<
  typeof bbDesktopBrowserAutomationRequestSchema
>;

export const bbDesktopBrowserAutomationResultSchema = z
  .object({
    navigationEpoch: z.number().int().nonnegative(),
    value: bbDesktopBrowserJsonValueSchema,
  })
  .strict()
  .refine(
    (value) =>
      jsonByteLength(value.value) <=
      BB_DESKTOP_BROWSER_MAX_SNAPSHOT_DATA_URL_LENGTH,
    "Browser automation result exceeds the byte limit",
  );
export type BbDesktopBrowserAutomationResult = z.infer<
  typeof bbDesktopBrowserAutomationResultSchema
>;

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

export const BB_DESKTOP_BROWSER_MAX_FIND_TEXT_LENGTH = 1024;

export const bbDesktopBrowserFindInPageRequestSchema = z
  .object({
    tabId: z.string().min(1),
    text: z.string().min(1).max(BB_DESKTOP_BROWSER_MAX_FIND_TEXT_LENGTH),
    forward: z.boolean(),
    newSession: z.boolean(),
  })
  .strict();
export type BbDesktopBrowserFindInPageRequest = z.infer<
  typeof bbDesktopBrowserFindInPageRequestSchema
>;

export const bbDesktopBrowserStopFindInPageRequestSchema = z
  .object({
    tabId: z.string().min(1),
    action: z.enum(["clearSelection", "keepSelection", "activateSelection"]),
  })
  .strict();
export type BbDesktopBrowserStopFindInPageRequest = z.infer<
  typeof bbDesktopBrowserStopFindInPageRequestSchema
>;

export const bbDesktopBrowserFindResultSchema = z
  .object({
    tabId: z.string().min(1),
    requestId: z.number().int(),
    activeMatchOrdinal: z.number().int().nonnegative(),
    matches: z.number().int().nonnegative(),
    finalUpdate: z.boolean(),
  })
  .strict();
export type BbDesktopBrowserFindResult = z.infer<
  typeof bbDesktopBrowserFindResultSchema
>;

export type BbDesktopBrowserStateHandler = (
  state: BbDesktopBrowserState,
) => void;
export type BbDesktopBrowserOpenTabHandler = (
  request: BbDesktopBrowserOpenTabRequest,
) => void;
export type BbDesktopBrowserScopedOpenTabHandler = (
  request: BbDesktopBrowserScopedOpenTabRequest,
) => void;
export type BbDesktopBrowserSnapshotHandler = (
  snapshot: BbDesktopBrowserSnapshot,
) => void;
export type BbDesktopBrowserFocusHandler = (tabId: string) => void;
export type BbDesktopBrowserFindResultHandler = (
  result: BbDesktopBrowserFindResult,
) => void;
export type BbDesktopBrowserUnsubscribe = () => void;

export interface BbDesktopBrowserApi {
  attach(request: BbDesktopBrowserAttachRequest): void;
  detach(tabId: string): void;
  experimental_closeBrowserTab?(
    request: BbDesktopBrowserCloseRequest,
  ): Promise<BbDesktopBrowserCloseResult>;
  navigate(request: BbDesktopBrowserNavigateRequest): void;
  goBack(tabId: string): void;
  goForward(tabId: string): void;
  reload(tabId: string): void;
  stop(tabId: string): void;
  focus(tabId: string): void;
  setBounds(request: BbDesktopBrowserSetBoundsRequest): void;
  setVisible(request: BbDesktopBrowserSetVisibleRequest): void;
  setVisibleWithoutFocus(request: BbDesktopBrowserSetVisibleRequest): void;
  experimental_trustLocalhostCertificate?(
    request: BbDesktopBrowserCloseRequest,
  ): Promise<BbDesktopBrowserTrustLocalhostCertificateResult>;
  experimental_browserControlVersion?: 2;
  experimental_listBrowserFrames?(
    request: BbDesktopBrowserListFramesRequest,
  ): Promise<BbDesktopBrowserListFramesResult>;
  experimental_sendBrowserTrustedInput?(
    request: BbDesktopBrowserTrustedInputRequest,
    options?: { signal?: AbortSignal },
  ): Promise<BbDesktopBrowserTrustedInputResult>;
  experimental_waitBrowserEvent?(
    request: BbDesktopBrowserWaitRequest,
    options?: { signal?: AbortSignal },
  ): Promise<BbDesktopBrowserWaitResult>;
  experimental_cancelBrowserEvent?(
    request: BbDesktopBrowserWaitCancelRequest,
  ): void;
  experimental_cancelBrowserTrustedInput?(
    request: BbDesktopBrowserTrustedInputCancelRequest,
  ): void;
  experimental_cancelBrowserPointerInput?(
    request: BbDesktopBrowserPointerInputCancelRequest,
  ): void;
  /**
   * Send a bounded, native pointer sequence to one exact Browser page
   * revision. This deliberately exposes no WebContents or generic input API.
   */
  experimental_sendBrowserPointerInput?(
    request: BbDesktopBrowserPointerInputRequest,
    options?: { signal?: AbortSignal },
  ): Promise<BbDesktopBrowserPointerInputResult>;
  /**
   * Apply a host-owned, temporary viewport profile to one Browser view.
   * Profiles clear on any main-frame navigation or Browser-view teardown.
   */
  experimental_setBrowserViewportProfile?(
    request: BbDesktopBrowserSetViewportProfileRequest,
  ): Promise<BbDesktopBrowserViewportProfileResult>;
  /** Clear only the profile activation identified by `generation`. */
  experimental_clearBrowserViewportProfile?(
    request: BbDesktopBrowserClearViewportProfileRequest,
  ): Promise<void>;
  /**
   * Execute one bounded function in the selected Browser page. The default
   * isolated world and the explicit main world both exclude Node, Electron,
   * and BB shell APIs. The signal stays renderer-local; preload sends only
   * serializable cancellation IPC. Navigation, detach, timeout, or
   * cancellation rejects.
   */
  experimental_runBrowserPageScript?(
    request: BbDesktopBrowserPageScriptRequest,
    options?: { signal?: AbortSignal },
  ): Promise<BbDesktopBrowserPageScriptResult>;
  experimental_captureBrowserPage?(
    request: BbDesktopBrowserPageCaptureRequest,
    options?: { signal?: AbortSignal },
  ): Promise<BbDesktopBrowserPageCaptureResult>;
  experimental_readBrowserCaptureChunk?(
    request: BbDesktopBrowserCaptureChunkRead,
  ): Promise<BbDesktopBrowserCaptureChunkResult>;
  experimental_releaseBrowserCapture?(
    request: BbDesktopBrowserCaptureRelease,
  ): Promise<void>;
  experimental_runBrowserAutomation?(
    request: BbDesktopBrowserAutomationRequest,
  ): Promise<BbDesktopBrowserAutomationResult>;
  experimental_importCookies?(
    request: BbDesktopBrowserImportCookiesRequest,
  ): Promise<BbDesktopBrowserImportCookiesResult>;
  experimental_listCookieImportSources?(
    request: BbDesktopBrowserListCookieImportSourcesRequest,
  ): Promise<BbDesktopBrowserListCookieImportSourcesResult>;
  experimental_importCookiesFromBrowser?(
    request: BbDesktopBrowserImportCookiesFromBrowserRequest,
  ): Promise<BbDesktopBrowserImportCookiesResult>;
  experimental_clearImportedCookies?(
    request: BbDesktopBrowserTabRef,
  ): Promise<void>;
  /** Subscribe to navigation-state pushes for every view in this window. */
  onState(listener: BbDesktopBrowserStateHandler): BbDesktopBrowserUnsubscribe;
  onOpenTab(
    listener: BbDesktopBrowserOpenTabHandler,
  ): BbDesktopBrowserUnsubscribe;
  onScopedOpenTab?(
    listener: BbDesktopBrowserScopedOpenTabHandler,
  ): BbDesktopBrowserUnsubscribe;
  onFocus(listener: BbDesktopBrowserFocusHandler): BbDesktopBrowserUnsubscribe;
  onSnapshot?(
    listener: BbDesktopBrowserSnapshotHandler,
  ): BbDesktopBrowserUnsubscribe;
  findInPage?(request: BbDesktopBrowserFindInPageRequest): void;
  stopFindInPage?(request: BbDesktopBrowserStopFindInPageRequest): void;
  onFindResult?(
    listener: BbDesktopBrowserFindResultHandler,
  ): BbDesktopBrowserUnsubscribe;
}
