import { z } from "zod";
import {
  experimental_browserCaptureDescriptorSchema,
  experimental_browserFrameTargetSchema,
  experimental_browserPageLocatorSchema,
  experimental_browserTabTargetSchema,
} from "@get-bb/plugin-sdk/browser";

export type AnnotationJsonValue =
  | string
  | number
  | boolean
  | null
  | AnnotationJsonValue[]
  | { [key: string]: AnnotationJsonValue };

export const browserAnnotationIntentSchema = z.enum([
  "fix",
  "change",
  "question",
  "approve",
]);
export type BrowserAnnotationIntent = z.infer<
  typeof browserAnnotationIntentSchema
>;

export type BrowserPageLocator = z.infer<
  typeof experimental_browserPageLocatorSchema
>;

const browserAnnotationPointerTargetSchema = z.discriminatedUnion("target", [
  z
    .object({
      target: z.literal("locator"),
      locator: experimental_browserPageLocatorSchema,
    })
    .strict(),
  z
    .object({
      target: z.literal("point"),
      x: z.number().finite().nonnegative(),
      y: z.number().finite().nonnegative(),
    })
    .strict(),
]);

export type BrowserAnnotationTarget = z.infer<
  typeof experimental_browserTabTargetSchema
>;
export const browserAnnotationTimeoutMsSchema = z
  .number()
  .int()
  .min(100)
  .max(120_000);


// ---------------------------------------------------------------------------
// Canonical element annotation (redacted element-types shape).
// ---------------------------------------------------------------------------

const boundedText = (max: number) => z.string().max(max);
const nullableBoundedText = (max: number) => boundedText(max).nullable();
const annotationRectSchema = z
  .object({
    height: z.number().finite().nonnegative(),
    width: z.number().finite().nonnegative(),
    x: z.number().finite(),
    y: z.number().finite(),
  })
  .strict();

export const browserElementAnnotationSchema = z
  .object({
    accessibility: z
      .object({
        ariaLabel: nullableBoundedText(256),
        ariaLabelledBy: nullableBoundedText(256),
        description: nullableBoundedText(256),
        name: nullableBoundedText(256),
        role: nullableBoundedText(128),
      })
      .strict(),
    ancestorPath: z.array(boundedText(128)).max(16),
    capturedAt: boundedText(64),
    devicePixelRatio: z.number().finite().positive().max(16),
    dom: z
      .object({
        attributes: z
          .record(boundedText(64), boundedText(256))
          .refine((attributes) => Object.keys(attributes).length <= 32),
        classes: z.array(boundedText(128)).max(16),
        id: nullableBoundedText(256),
        selector: boundedText(700),
        tag: boundedText(64),
      })
      .strict(),
    fullDomPath: boundedText(900),
    html: nullableBoundedText(4_096),
    nearbyElements: z.array(boundedText(160)).max(6),
    nearbyText: z.array(boundedText(200)).max(10),
    pageUrl: boundedText(4_096).refine(
      (value) => /^https?:\/\//i.test(value),
      "Annotation page URL must be an http(s) URL",
    ),
    reactComponents: nullableBoundedText(500),
    rect: annotationRectSchema,
    rectPage: annotationRectSchema,
    scroll: annotationRectSchema.pick({ x: true, y: true }),
    selectedText: nullableBoundedText(500),
    sensitive: z.boolean(),
    sourceFile: nullableBoundedText(500),
    styles: z
      .object({
        backgroundColor: boundedText(128),
        border: boundedText(256),
        borderRadius: boundedText(128),
        color: boundedText(128),
        display: boundedText(64),
        fontFamily: boundedText(256),
        fontSize: boundedText(64),
        fontWeight: boundedText(64),
        height: boundedText(64),
        lineHeight: boundedText(64),
        margin: boundedText(128),
        opacity: boundedText(64),
        padding: boundedText(128),
        position: boundedText(64),
        textAlign: boundedText(64),
        width: boundedText(64),
        zIndex: boundedText(64),
      })
      .strict(),
    text: boundedText(200),
    title: nullableBoundedText(1_024),
    viewport: z
      .object({
        height: z.number().finite().positive().max(100_000),
        width: z.number().finite().positive().max(100_000),
      })
      .strict(),
  })
  .strict()
  .superRefine((annotation, context) => {
    if (
      annotation.sensitive &&
      (annotation.text.length > 0 || annotation.html !== null)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "A sensitive annotation must not carry element text or HTML content",
        path: ["sensitive"],
      });
    }
  });
export type BrowserElementAnnotation = z.infer<
  typeof browserElementAnnotationSchema
>;

export const browserElementAnnotationNoteSchema = z
  .object({
    annotation: browserElementAnnotationSchema,
    comment: boundedText(2_000),
    createdAt: boundedText(64),
    id: boundedText(128),
    pageId: boundedText(256),
    intent: browserAnnotationIntentSchema,
    screenshot: experimental_browserCaptureDescriptorSchema.nullable(),
    priority: z.enum(["blocking", "important", "suggestion"]),
  })
  .strict();
export type BrowserElementAnnotationNote = z.infer<
  typeof browserElementAnnotationNoteSchema
>;

export const browserScreenshotEditorSchema = z
  .object({
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{3,8}$/u, "Editor color must be a hex color"),
    fontSize: z.number().finite().positive().max(4_096),
    past: z.array(z.array(z.unknown()).max(500)).max(50),
    redo: z.array(z.array(z.unknown()).max(500)).max(50),
    shapes: z.array(z.unknown()).max(500),
    tool: z.enum(["pen", "highlight", "arrow", "rect", "ellipse", "text"]),
    width: z.number().finite().positive().max(4_096),
  })
  .strict();
export type BrowserScreenshotEditor = z.infer<
  typeof browserScreenshotEditorSchema
>;

const finiteCoordinate = z
  .number()
  .finite()
  .refine((value) => Math.abs(value) <= 1_000_000, {
    message: "Shape coordinates must be within bounds",
  });
const shapePointSchema = z
  .object({ x: finiteCoordinate, y: finiteCoordinate })
  .strict();

const MAX_SHAPE_POINTS = 4_096;
const MAX_AGGREGATE_SHAPES = 25_500;

const browserScreenshotShapeSchema = z.discriminatedUnion("kind", [
  z
    .object({
      color: z
        .string()
        .regex(/^#[0-9a-fA-F]{3,8}$/u, "Shape color must be a hex color"),
      id: boundedText(128),
      kind: z.enum(["pen", "highlight"]),
      points: z.array(shapePointSchema).max(MAX_SHAPE_POINTS),
      width: z.number().finite().positive().max(4_096),
    })
    .strict(),
  z
    .object({
      color: z
        .string()
        .regex(/^#[0-9a-fA-F]{3,8}$/u, "Shape color must be a hex color"),
      from: shapePointSchema,
      id: boundedText(128),
      kind: z.literal("arrow"),
      to: shapePointSchema,
      width: z.number().finite().positive().max(4_096),
    })
    .strict(),
  z
    .object({
      color: z
        .string()
        .regex(/^#[0-9a-fA-F]{3,8}$/u, "Shape color must be a hex color"),
      from: shapePointSchema,
      id: boundedText(128),
      kind: z.enum(["rect", "ellipse"]),
      to: shapePointSchema,
      width: z.number().finite().positive().max(4_096),
    })
    .strict(),
  z
    .object({
      at: shapePointSchema,
      color: z
        .string()
        .regex(/^#[0-9a-fA-F]{3,8}$/u, "Shape color must be a hex color"),
      fontSize: z.number().finite().positive().max(4_096),
      id: boundedText(128),
      kind: z.literal("text"),
      text: boundedText(4_096),
    })
    .strict(),
]);
export type BrowserScreenshotShape = z.infer<
  typeof browserScreenshotShapeSchema
>;

/** The editor snapshot schema with every shape fully validated. */
export const browserScreenshotEditorStateSchema = z
  .object({
    image:
      experimental_browserCaptureDescriptorSchema.shape.pixelSize.safeExtend({
        id: z.string().min(1).max(128),
      }),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{3,8}$/u, "Editor color must be a hex color"),
    fontSize: z.number().finite().positive().max(4_096),
    past: z.array(z.array(browserScreenshotShapeSchema).max(500)).max(50),
    pendingText: z
      .object({
        at: shapePointSchema,
        fontSize: z.number().finite().positive().max(4_096),
        id: boundedText(128),
        text: z.string().max(4_096),
      })
      .strict()
      .nullable(),
    redo: z.array(z.array(browserScreenshotShapeSchema).max(500)).max(50),
    shapes: z.array(browserScreenshotShapeSchema).max(500),
    tool: z.enum(["pen", "highlight", "arrow", "rect", "ellipse", "text"]),
    width: z.number().finite().positive().max(4_096),
  })
  .strict()
  .superRefine((editor, context) => {
    const aggregate =
      editor.shapes.length +
      editor.past.reduce((total, frame) => total + frame.length, 0) +
      editor.redo.reduce((total, frame) => total + frame.length, 0);
    if (aggregate > MAX_AGGREGATE_SHAPES) {
      context.addIssue({
        code: "custom",
        message: "Editor history exceeds the aggregate shape limit",
        path: ["past"],
      });
    }
    let points = editor.pendingText === null ? 0 : 1;
    let textLength = editor.pendingText?.text.length ?? 0;
    if (
      editor.pendingText !== null &&
      (editor.pendingText.at.x < 0 ||
        editor.pendingText.at.y < 0 ||
        editor.pendingText.at.x > editor.image.width ||
        editor.pendingText.at.y > editor.image.height)
    ) {
      context.addIssue({
        code: "custom",
        message: "Pending text lies outside its source image",
      });
      return;
    }
    for (const shapes of [editor.shapes, ...editor.past, ...editor.redo]) {
      for (const shape of shapes) {
        const positions =
          "points" in shape
            ? shape.points
            : shape.kind === "text"
              ? [shape.at]
              : [shape.from, shape.to];
        points += positions.length;
        if (shape.kind === "text") textLength += shape.text.length;
        if (
          positions.some(
            (point) =>
              point.x < 0 ||
              point.y < 0 ||
              point.x > editor.image.width ||
              point.y > editor.image.height,
          )
        ) {
          context.addIssue({
            code: "custom",
            message: "Drawing lies outside its source image",
          });
          return;
        }
      }
    }
    if (points > 100_000 || textLength > 1_000_000) {
      context.addIssue({
        code: "custom",
        message: "Editor history exceeds its content budget",
      });
    }
  });
export type BrowserScreenshotEditorState = z.infer<
  typeof browserScreenshotEditorStateSchema
>;

export const browserReviewDraftSchema = z.discriminatedUnion("kind", [
  z
    .object({
      annotation: browserElementAnnotationSchema,
      comment: boundedText(2_000),
      intent: browserAnnotationIntentSchema,
      kind: z.literal("new"),
      screenshot: experimental_browserCaptureDescriptorSchema.nullable(),
      captureError: nullableBoundedText(512),
    })
    .strict(),
  z
    .object({
      comment: boundedText(2_000),
      intent: browserAnnotationIntentSchema,
      kind: z.literal("edit"),
      noteId: boundedText(128),
    })
    .strict(),
]);
export type BrowserReviewDraft = z.infer<typeof browserReviewDraftSchema>;

export const browserScreenshotSessionSchema = z
  .object({
    editor: browserScreenshotEditorStateSchema,
    screenshot: experimental_browserCaptureDescriptorSchema,
  })
  .strict();
export type BrowserScreenshotSession = z.infer<
  typeof browserScreenshotSessionSchema
>;

export const browserElementSessionSchema = z
  .object({
    notes: z.array(browserElementAnnotationNoteSchema).max(100),
    pageSnapshot: experimental_browserCaptureDescriptorSchema.nullable(),
    review: browserReviewDraftSchema.nullable(),
  })
  .strict();
export type BrowserElementSession = z.infer<typeof browserElementSessionSchema>;

// ---------------------------------------------------------------------------
// Operation request wire schema.
// ---------------------------------------------------------------------------

export const browserAnnotationOperationSchema = z.discriminatedUnion(
  "operation",
  [
    z.object({ operation: z.literal("get") }).strict(),
    z
      .object({
        operation: z.literal("grab"),
        element: browserAnnotationPointerTargetSchema,
        frame: experimental_browserFrameTargetSchema.optional(),
        timeoutMs: browserAnnotationTimeoutMsSchema.optional(),
      })
      .strict(),
    z
      .object({
        operation: z.literal("annotate"),
        element: browserAnnotationPointerTargetSchema,
        frame: experimental_browserFrameTargetSchema.optional(),
        intent: browserAnnotationIntentSchema,
        feedback: z.string().trim().min(1).max(2_000),
        timeoutMs: browserAnnotationTimeoutMsSchema.optional(),
      })
      .strict(),
    z
      .object({
        operation: z.literal("pick"),
        mode: z.enum(["grab", "annotate"]),
        timeoutMs: browserAnnotationTimeoutMsSchema.optional(),
      })
      .strict(),
    z
      .object({
        operation: z.literal("update-note"),
        id: z.string().min(1).max(128),
        intent: browserAnnotationIntentSchema,
        feedback: z.string().trim().min(1).max(2_000),
      })
      .strict(),
    z
      .object({
        operation: z.literal("remove-note"),
        id: z.string().min(1).max(128),
      })
      .strict(),
    z
      .object({
        operation: z.literal("move-note"),
        id: z.string().min(1).max(128),
        direction: z.enum(["up", "down"]),
      })
      .strict(),
    z.object({ operation: z.literal("clear-notes") }).strict(),
    z.object({ operation: z.literal("screenshot") }).strict(),
    z
      .object({
        operation: z.literal("set-editor"),
        editor: browserScreenshotEditorStateSchema,
      })
      .strict(),
    z.object({ operation: z.literal("undo") }).strict(),
    z.object({ operation: z.literal("redo") }).strict(),
    z.object({ operation: z.literal("clear-drawing") }).strict(),
    z
      .object({
        operation: z.literal("export"),
        format: z.enum(["text", "png"]),
      })
      .strict(),
    z
      .object({
        operation: z.literal("copy"),
        format: z.enum(["text", "png"]),
      })
      .strict(),
    z
      .object({
        operation: z.literal("download"),
        format: z.literal("png"),
      })
      .strict(),
    z.object({ operation: z.literal("add-to-chat") }).strict(),
    z
      .object({
        operation: z.literal("set-review"),
        review: browserReviewDraftSchema.nullable(),
      })
      .strict(),
  ],
);
export type BrowserAnnotationOperation = z.infer<
  typeof browserAnnotationOperationSchema
>;

/**
 * Strict shared request the agent tool/CLI send: canonical exact-tab target,
 * validated operation, and an explicit broker timeout that is rejected (never
 * silently clamped) when it falls outside 100–120000 ms.
 */
export const browserAnnotationRequestSchema = z
  .object({
    target: experimental_browserTabTargetSchema,
    operation: browserAnnotationOperationSchema,
    timeoutMs: browserAnnotationTimeoutMsSchema.optional(),
  })
  .strict()
  .superRefine((request, context) => {
    const operationTimeout =
      "timeoutMs" in request.operation
        ? request.operation.timeoutMs
        : undefined;
    if (
      request.timeoutMs !== undefined &&
      operationTimeout !== undefined &&
      request.timeoutMs !== operationTimeout
    ) {
      context.addIssue({
        code: "custom",
        message: "Request and operation timeouts must agree",
      });
    }
  })
  .transform((request) => {
    const timeoutMs =
      request.timeoutMs ??
      ("timeoutMs" in request.operation
        ? request.operation.timeoutMs
        : undefined) ??
      30_000;
    const operation =
      request.operation.operation === "grab" ||
      request.operation.operation === "annotate" ||
      request.operation.operation === "pick"
        ? { ...request.operation, timeoutMs }
        : request.operation;
    return { target: request.target, operation, timeoutMs };
  });
export type BrowserAnnotationRequest = z.infer<
  typeof browserAnnotationRequestSchema
>;

export function parseBrowserAnnotationRequest(
  raw: unknown,
): BrowserAnnotationRequest {
  const parsed = browserAnnotationRequestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `Invalid Browser annotation request: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}

const grabResultSchema = z
  .object({
    annotation: browserElementAnnotationSchema,
    text: boundedText(64_000).nullable(),
  })
  .strict();
const annotateResultSchema = z
  .object({
    annotation: browserElementAnnotationSchema,
    intent: browserAnnotationIntentSchema,
    feedback: boundedText(2_000),
    tab: experimental_browserTabTargetSchema,
  })
  .strict();
const pickResultSchema = z
  .object({
    annotation: browserElementAnnotationSchema,
    pageSnapshot: experimental_browserCaptureDescriptorSchema.nullable(),
    screenshot: experimental_browserCaptureDescriptorSchema.nullable(),
    captureError: nullableBoundedText(512),
  })
  .strict();
const getResultSchema = z
  .object({
    notes: z.array(browserElementAnnotationNoteSchema).max(100),
    screenshot: browserScreenshotSessionSchema.nullable(),
    review: browserReviewDraftSchema.nullable(),
  })
  .strict();
const updateNoteResultSchema = z
  .object({ id: boundedText(128), updated: z.literal(true) })
  .strict();
const removeNoteResultSchema = z
  .object({ id: boundedText(128), removed: z.literal(true) })
  .strict();
const moveNoteResultSchema = z
  .object({ id: boundedText(128), moved: z.literal(true) })
  .strict();
const clearNotesResultSchema = z.object({ cleared: z.literal(true) }).strict();
const screenshotResultSchema = z
  .object({ screenshot: experimental_browserCaptureDescriptorSchema })
  .strict();
const setEditorResultSchema = z
  .object({ editor: browserScreenshotEditorStateSchema })
  .strict();
const undoResultSchema = z.object({ undone: z.literal(true) }).strict();
const redoResultSchema = z.object({ redone: z.literal(true) }).strict();
const clearDrawingResultSchema = z
  .object({ cleared: z.literal(true) })
  .strict();
const exportTextResultSchema = z
  .object({ text: boundedText(256_000) })
  .strict();
const exportPngResultSchema = experimental_browserCaptureDescriptorSchema;
const copyTextResultSchema = z.object({ copied: z.boolean() }).strict();
const downloadResultSchema = experimental_browserCaptureDescriptorSchema;
const addToChatResultSchema = z
  .object({ addedToChat: z.literal(true) })
  .strict();
const setReviewResultSchema = z
  .object({ review: browserReviewDraftSchema.nullable() })
  .strict();

const operationResults = {
  get: getResultSchema,
  grab: grabResultSchema,
  annotate: annotateResultSchema,
  pick: pickResultSchema,
  "update-note": updateNoteResultSchema,
  "remove-note": removeNoteResultSchema,
  "move-note": moveNoteResultSchema,
  "clear-notes": clearNotesResultSchema,
  screenshot: screenshotResultSchema,
  "set-editor": setEditorResultSchema,
  undo: undoResultSchema,
  redo: redoResultSchema,
  "clear-drawing": clearDrawingResultSchema,
  export: z.union([exportTextResultSchema, exportPngResultSchema]),
  copy: copyTextResultSchema,
  download: downloadResultSchema,
  "add-to-chat": addToChatResultSchema,
  "set-review": setReviewResultSchema,
} satisfies Record<BrowserAnnotationOperation["operation"], z.ZodType>;

export type BrowserAnnotationOperationValue<
  T extends BrowserAnnotationOperation,
> = T extends { operation: "export"; format: "text" }
  ? z.output<typeof exportTextResultSchema>
  : T extends { operation: "export"; format: "png" }
    ? z.output<typeof exportPngResultSchema>
    : T extends { operation: "pick"; mode: infer Mode }
      ? Mode extends "grab"
        ? z.output<typeof grabResultSchema>
        : z.output<typeof pickResultSchema>
      : z.output<(typeof operationResults)[T["operation"]]>;

function resultSchemaForOperation(operation: BrowserAnnotationOperation) {
  if (operation.operation === "pick" && operation.mode === "grab")
    return grabResultSchema;
  return operation.operation === "export"
    ? operation.format === "text"
      ? exportTextResultSchema
      : exportPngResultSchema
    : operationResults[operation.operation];
}

export function validateBrowserAnnotationOperationResult<
  T extends BrowserAnnotationOperation,
>(
  operation: T,
  value: unknown,
): BrowserAnnotationOperationValue<T> {
  const valueParsed = resultSchemaForOperation(operation).safeParse(value);
  if (!valueParsed.success) {
    throw new Error(
      `Browser annotation ${operation.operation} returned an invalid result`,
    );
  }
  return valueParsed.data as BrowserAnnotationOperationValue<T>;
}

export interface BrowserAnnotationError {
  code: string;
  message: string;
  details?: unknown;
}

export function browserAnnotationError(error: unknown): BrowserAnnotationError {
  const message =
    error instanceof Error && error.message.length > 0
      ? error.message.slice(0, 2_048)
      : "Browser annotation failed";
  const code =
    error instanceof Error && error.name.length > 0 && error.name !== "Error"
      ? error.name
      : "browser_annotation_failed";
  return { code, message };
}
