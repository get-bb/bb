import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type {
  ExperimentalBrowserControllerLifecycle,
  ExperimentalBrowserControllerProps,
  ExperimentalBrowserPageCapture,
} from "@get-bb/plugin-sdk/app";
import type { ExperimentalBrowserCaptureDescriptor } from "@get-bb/plugin-sdk/browser";
import { useComposer } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { z } from "zod";
import type { AnnotationJsonValue } from "./contracts";
import {
  browserAnnotationSnapshot,
  clearBrowserAnnotationRecord,
  createEmptyBrowserScreenshotEditor,
  isBrowserAnnotationEpochCurrent,
  markBrowserAnnotationEpoch,
  retainBrowserAnnotationPreview,
  setBrowserAnnotationElements,
  setBrowserAnnotationScreenshot,
  subscribeBrowserAnnotationStore,
  type BrowserAnnotationKey,
  type BrowserElementReviewDraft,
  type BrowserScreenshotEditorSnapshot,
  type BrowserScreenshotSession,
} from "./annotation-state";
import {
  browserElementAnnotationAgentText,
  browserElementAnnotationsAgentText,
  browserElementAnnotationCaptureSchema,
  browserElementPickerSource,
  browserElementReactMetadataSource,
  redactBrowserElementAnnotation,
  type BrowserElementAnnotationIntent,
  type BrowserElementAnnotationNote,
} from "./element-capture";
import {
  registerAnnotationToolbarController,
  type AnnotationControllerInteractionState,
  type AnnotationToolbarController,
  type AnnotationToolbarMode,
} from "./annotation-toolbar-bridge";
import { readBrowserElementPickerTheme } from "./element-picker-theme";
import { cropBrowserElementScreenshot } from "./element-crop";
import {
  annotatedScreenshotBlob,
  BrowserScreenshotAnnotation,
  loadScreenshotImage,
} from "./BrowserScreenshotAnnotation";
import {
  copyImageToClipboard,
  copyTextToClipboard,
  toastError,
  toastSuccess,
} from "./clipboard";
import {
  BrowserAnnotationOverlay,
  BrowserElementAnnotationReview,
  BrowserElementAnnotationTray,
} from "./BrowserAnnotationReview";
import {
  browserAnnotationOperationSchema,
  browserReviewDraftSchema,
  browserScreenshotEditorStateSchema,
  validateBrowserAnnotationOperationResult,
  type BrowserAnnotationOperation,
} from "./contracts";

type JsonValue = AnnotationJsonValue;

type AnnotationTargetLike = NonNullable<
  ExperimentalBrowserControllerProps["target"]
>;


type RequestHandlerArgs = {
  input: JsonValue;
  target: AnnotationTargetLike;
  signal: AbortSignal;
};

function json(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

/**
 * Distinguish expected user cancellation (picker Escape, request/controller
 * abort, navigation-invalidated picker) from real capture failures so the UI
 * can exit quietly without an error toast.
 */
function isExpectedBrowserCancellation(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") {
    return true;
  }
  if (error instanceof Error) {
    if (error.name === "AbortError") return true;
    return error.message === "Element picker cancelled";
  }
  return false;
}

function readOperation(raw: JsonValue): BrowserAnnotationOperation {
  const parsed = browserAnnotationOperationSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `Invalid Browser annotation operation: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}


export function BrowserAnnotationController(
  props: ExperimentalBrowserControllerProps,
) {
  const target = props.target;
  const isCompactViewport = useIsCompactViewport();
  const [isTrayOpen, setIsTrayOpen] = useState(true);
  const annotationKey: BrowserAnnotationKey | null = useMemo(() => {
    if (target === null) return null;
    return {
      environmentId: props.environmentId,
      threadId: props.threadId,
      tabId: target.tabId,
    };
  }, [props.environmentId, props.threadId, target]);

  const record = useSyncExternalStore(
    subscribeBrowserAnnotationStore,
    () =>
      annotationKey === null ? null : browserAnnotationSnapshot(annotationKey),
    () => null,
  );
  const recordRef = useRef(record);
  recordRef.current = record;
  const targetRef = useRef(target);
  targetRef.current = target;
  const propsRef = useRef(props);
  propsRef.current = props;

  const [pickerMode, setPickerMode] = useState<AnnotationToolbarMode | null>(
    null,
  );
  const pickerControllerRef = useRef<AbortController | null>(null);
  const composer = useComposer();
  const composerRef = useRef(composer);
  composerRef.current = composer;

  const recordFor = (): NonNullable<
    ReturnType<typeof browserAnnotationSnapshot>
  > | null => {
    if (annotationKey === null) return null;
    return browserAnnotationSnapshot(annotationKey);
  };

  const isCurrent = useCallback((): boolean => {
    const currentTarget = targetRef.current;
    const currentRecord = recordFor();
    return (
      currentTarget !== null &&
      currentRecord !== null &&
      currentRecord.navigationEpoch === currentTarget.navigationEpoch
    );
  }, [annotationKey]);

  const review: BrowserElementReviewDraft | null = isCurrent()
    ? (recordRef.current?.elements?.review ?? null)
    : null;
  const notes: readonly BrowserElementAnnotationNote[] = isCurrent()
    ? (recordRef.current?.elements?.notes ?? [])
    : [];
  const pendingAnnotation = review?.kind === "new" ? review.annotation : null;
  const editingNote =
    review?.kind === "edit"
      ? (notes.find((note) => note.id === review.noteId) ?? null)
      : null;
  const screenshotPreviewUrl = isCurrent()
    ? (recordRef.current?.screenshot?.previewUrl ?? null)
    : null;
  const pageSnapshotPreviewUrl = isCurrent()
    ? (recordRef.current?.elements?.pageSnapshotPreviewUrl ?? null)
    : null;
  const isPickerActive = pickerMode !== null;
  const isEditorOpen = screenshotPreviewUrl !== null;
  const isReviewOpen = review !== null;
  const isSnapshotOverlayOpen =
    !isPickerActive &&
    pageSnapshotPreviewUrl !== null &&
    (pendingAnnotation !== null || notes.length > 0);

  const assertCurrent = useCallback(
    (epoch: number): void => {
      const currentTarget = targetRef.current;
      if (annotationKey === null || currentTarget === null) {
        throw new Error("Annotation target is unavailable");
      }
      if (
        !isBrowserAnnotationEpochCurrent(annotationKey, epoch) ||
        currentTarget.navigationEpoch !== epoch
      ) {
        throw new Error("The Browser page changed after the request started");
      }
    },
    [annotationKey],
  );

  const runPageScript = useCallback(
    async (
      source: string,
      input: JsonValue,
      epoch: number,
      signal: AbortSignal,
      options: {
        frame?: { frameId: string; documentEpoch: number };
        timeoutMs?: number;
        world?: "isolated" | "main";
      } = {},
    ) => {
      const runtime = propsRef.current;
      if (!runtime.experimental_browserControlAvailable) {
        throw new Error("Browser page scripts are unavailable");
      }
      const result = await runtime.experimental_runBrowserPageScript(
        {
          source,
          input,
          expectedNavigationEpoch: epoch,
          ...(options.frame === undefined ? {} : { frame: options.frame }),
          ...(options.timeoutMs === undefined
            ? {}
            : { timeoutMs: options.timeoutMs }),
          ...(options.world === undefined ? {} : { world: options.world }),
        },
        { signal },
      );
      if (result.navigationEpoch !== epoch) {
        throw new Error("The Browser page changed during annotation");
      }
      return result.value;
    },
    [],
  );

  const pickElement = useCallback(
    async (args: {
      epoch: number;
      element?: unknown;
      frame?: { frameId: string; documentEpoch: number };
      signal: AbortSignal;
      timeoutMs?: number;
    }) => {
      const input: JsonValue = json({
        ...(args.element === undefined ? {} : { element: args.element }),
        ...readBrowserElementPickerTheme(),
      });
      const value = await runPageScript(
        browserElementPickerSource,
        input,
        args.epoch,
        args.signal,
        {
          ...(args.frame === undefined ? {} : { frame: args.frame }),
          ...(args.timeoutMs === undefined
            ? {}
            : { timeoutMs: args.timeoutMs }),
          world: "isolated",
        },
      );
      const parsed = browserElementAnnotationCaptureSchema.safeParse(value);
      if (!parsed.success) {
        throw new Error("Browser annotation capture was invalid");
      }
      let capture = parsed.data;
      if (args.element !== undefined) {
        const metadata = await runPageScript(
          browserElementReactMetadataSource,
          json({ target: args.element }),
          args.epoch,
          args.signal,
          {
            ...(args.frame === undefined ? {} : { frame: args.frame }),
            ...(args.timeoutMs === undefined
              ? {}
              : { timeoutMs: args.timeoutMs }),
            world: "main",
          },
        );
        const parsedMetadata = z
          .object({
            reactComponents: z.string().max(500).nullable(),
            sourceFile: z.string().max(500).nullable(),
          })
          .strict()
          .safeParse(metadata);
        if (parsedMetadata.success) {
          capture = {
            ...capture,
            reactComponents: parsedMetadata.data.reactComponents,
            sourceFile: parsedMetadata.data.sourceFile,
          };
        }
      }
      const annotation = redactBrowserElementAnnotation(capture);
      if (annotation === null) {
        throw new Error("Browser annotation capture was invalid");
      }
      return annotation;
    },
    [runPageScript],
  );
  const capturePage = useCallback(
    async (args: {
      epoch: number;
      format: "png" | "jpeg";
      quality: number;
      signal?: AbortSignal;
    }): Promise<{
      descriptor: ExperimentalBrowserCaptureDescriptor;
      preview: ExperimentalBrowserPageCapture;
    }> => {
      const runtime = propsRef.current;
      const currentTarget = targetRef.current;
      if (
        currentTarget === null ||
        !runtime.experimental_browserControlAvailable
      ) {
        throw new Error("Browser screenshot capture is unavailable");
      }
      const preview = await runtime.experimental_capturePage({
        expectedNavigationEpoch: args.epoch,
        format: args.format,
        quality: args.quality,
        ...(args.signal === undefined ? {} : { signal: args.signal }),
      });
      if (preview.navigationEpoch !== args.epoch) {
        preview.dispose();
        throw new Error("The Browser page changed during screenshot capture");
      }
      const response = await fetch(preview.url);
      if (!response.ok) {
        preview.dispose();
        throw new Error("Browser screenshot capture could not be read");
      }
      const descriptor = await runtime.experimental_createImageResource(
        {
          blob: await response.blob(),
          pixelSize: preview.pixelSize,
        },
        {
          ...(args.signal === undefined ? {} : { signal: args.signal }),
        },
      );
      return { descriptor, preview };
    },
    [],
  );

  const cancelActivePicker = useCallback(async () => {
    const controller = pickerControllerRef.current;
    pickerControllerRef.current = null;
    controller?.abort();
    setPickerMode(null);
  }, []);

  const startPicker = useCallback(
    async (mode: AnnotationToolbarMode) => {
      const runtime = propsRef.current;
      const currentTarget = targetRef.current;
      const currentRecord = recordFor();
      if (
        annotationKey === null ||
        currentTarget === null ||
        !runtime.isVisible ||
        !runtime.experimental_browserControlAvailable ||
        pickerControllerRef.current !== null ||
        currentRecord === null ||
        currentRecord.navigationEpoch !== currentTarget.navigationEpoch ||
        screenshotPreviewUrl !== null ||
        (recordFor()?.elements?.review ?? null) !== null
      ) {
        return;
      }
      const epoch = currentTarget.navigationEpoch;
      const controller = new AbortController();
      pickerControllerRef.current = controller;
      setPickerMode(mode);
      let preview: ExperimentalBrowserPageCapture | null = null;
      try {
        const annotation = await pickElement({
          epoch,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (mode === "grab") {
          const text = browserElementAnnotationAgentText(annotation);
          if (text !== null) {
            const copied = await copyTextToClipboard(text);
            if (copied) toastSuccess(toast, "Element context copied");
            else toastError(toast, "Failed to copy element context");
          }
          return;
        }
        let captureError: string | null = null;
        let pageSnapshot: ExperimentalBrowserCaptureDescriptor | null = null;
        let pageSnapshotPreviewUrl: string | null = null;
        let screenshot: ExperimentalBrowserCaptureDescriptor | null = null;
        let screenshotPreviewUrl: string | null = null;
        try {
          const capture = await capturePage({
            epoch,
            format: "jpeg",
            quality: 82,
            signal: controller.signal,
          });
          preview = capture.preview;
          pageSnapshot = capture.descriptor;
          pageSnapshotPreviewUrl = capture.preview.url;
          screenshotPreviewUrl = await cropBrowserElementScreenshot({
            annotation,
            dataUrl: capture.preview.url,
          });
          if (screenshotPreviewUrl !== null) {
            screenshot = await propsRef.current.experimental_createImageResource(
              { blob: await (await fetch(screenshotPreviewUrl)).blob() },
              { signal: controller.signal },
            );
          }
        } catch (error) {
          if (isExpectedBrowserCancellation(error)) throw error;
          captureError = "The page preview could not be captured.";
        }
        if (controller.signal.aborted) return;
        assertCurrent(epoch);
        setBrowserAnnotationElements(annotationKey, epoch, {
          notes: recordFor()?.elements?.notes ?? [],
          pageSnapshot,
          pageSnapshotPreviewUrl,
          review: {
            annotation,
            captureError,
            comment: "",
            intent: "change",
            kind: "new",
            screenshot,
            screenshotPreviewUrl,
          },
        });
      } catch (error) {
        if (
          !controller.signal.aborted &&
          !isExpectedBrowserCancellation(error)
        ) {
          toastError(
            toast,
            error instanceof Error ? error.message : "Element selection failed",
          );
        }
      } finally {
        if (preview !== null)
          retainBrowserAnnotationPreview(annotationKey, preview);
        if (pickerControllerRef.current === controller) {
          pickerControllerRef.current = null;
          setPickerMode(null);
        }
      }
    },
    [
      annotationKey,
      assertCurrent,
      capturePage,
      pickElement,
      screenshotPreviewUrl,
    ],
  );

  const closeReview = useCallback(() => {
    const currentRecord = recordFor();
    const currentTarget = targetRef.current;
    if (
      annotationKey === null ||
      currentTarget === null ||
      currentRecord === null ||
      currentRecord.elements === null
    ) {
      return;
    }
    setBrowserAnnotationElements(annotationKey, currentRecord.navigationEpoch, {
      ...currentRecord.elements,
      review: null,
    });
  }, [annotationKey]);

  const addNote = useCallback(
    (comment: string, intent: BrowserElementAnnotationIntent) => {
      const currentRecord = recordFor();
      const currentTarget = targetRef.current;
      const draft = currentRecord?.elements?.review;
      if (
        annotationKey === null ||
        currentTarget === null ||
        currentRecord === null ||
        currentRecord.elements === null ||
        draft === null ||
        draft === undefined ||
        draft.kind !== "new"
      ) {
        return;
      }
      const note: BrowserElementAnnotationNote = {
        annotation: draft.annotation,
        comment,
        createdAt: new Date().toISOString(),
        id: crypto.randomUUID(),
        pageId: currentTarget.tabId,
        intent,
        screenshot: draft.screenshot,
        priority: "important",
      };
      setBrowserAnnotationElements(
        annotationKey,
        currentRecord.navigationEpoch,
        {
          ...currentRecord.elements,
          notes: [...currentRecord.elements.notes, note],
          review: null,
        },
      );
    },
    [annotationKey],
  );

  const updateReviewDraft = useCallback(
    (draft: BrowserElementReviewDraft) => {
      const currentRecord = recordFor();
      if (
        annotationKey === null ||
        currentRecord === null ||
        currentRecord.elements === null
      ) {
        return;
      }
      setBrowserAnnotationElements(
        annotationKey,
        currentRecord.navigationEpoch,
        {
          ...currentRecord.elements,
          review: draft,
        },
      );
    },
    [annotationKey],
  );

  const retryNewReviewCapture = useCallback(async () => {
    const currentRecord = recordFor();
    const currentTarget = targetRef.current;
    const draft = currentRecord?.elements?.review;
    if (
      annotationKey === null ||
      currentTarget === null ||
      currentRecord === null ||
      currentRecord.elements === null ||
      draft == null ||
      draft.kind !== "new"
    ) {
      return;
    }
    let preview: ExperimentalBrowserPageCapture | null = null;
    try {
      const capture = await capturePage({
        epoch: currentRecord.navigationEpoch,
        format: "jpeg",
        quality: 82,
      });
      preview = capture.preview;
      const screenshotPreviewUrl = await cropBrowserElementScreenshot({
        annotation: draft.annotation,
        dataUrl: preview.url,
      });
      const screenshot =
        screenshotPreviewUrl === null
          ? null
          : await propsRef.current.experimental_createImageResource(
              { blob: await (await fetch(screenshotPreviewUrl)).blob() },
            );
      assertCurrent(currentRecord.navigationEpoch);
      const current = recordFor();
      if (current === null || current.elements === null) return;
      setBrowserAnnotationElements(annotationKey, current.navigationEpoch, {
        ...current.elements,
        pageSnapshot: capture.descriptor,
        pageSnapshotPreviewUrl: preview.url,
        review: {
          ...draft,
          captureError: null,
          screenshot,
          screenshotPreviewUrl,
        },
      });
    } catch (error) {
      if (!isExpectedBrowserCancellation(error)) {
        updateReviewDraft({
          ...draft,
          captureError: "The page preview could not be captured.",
        });
      }
    } finally {
      if (preview !== null)
        retainBrowserAnnotationPreview(annotationKey, preview);
    }
  }, [annotationKey, assertCurrent, capturePage, updateReviewDraft]);

  const updateNote = useCallback(
    (
      noteId: string,
      comment: string,
      intent: BrowserElementAnnotationIntent,
    ) => {
      const currentRecord = recordFor();
      if (
        annotationKey === null ||
        currentRecord === null ||
        currentRecord.elements === null
      ) {
        throw new Error("No page-element session is open");
      }
      const note = currentRecord.elements.notes.find(
        (candidate) => candidate.id === noteId,
      );
      if (note === undefined) {
        throw new Error("Annotation note not found");
      }
      setBrowserAnnotationElements(
        annotationKey,
        currentRecord.navigationEpoch,
        {
          ...currentRecord.elements,
          notes: currentRecord.elements.notes.map((candidate) =>
            candidate.id === noteId
              ? { ...candidate, comment, intent }
              : candidate,
          ),
          review: null,
        },
      );
    },
    [annotationKey],
  );

  const moveNote = useCallback(
    (noteId: string, direction: "up" | "down") => {
      const currentRecord = recordFor();
      if (
        annotationKey === null ||
        currentRecord === null ||
        currentRecord.elements === null
      ) {
        throw new Error("No page-element session is open");
      }
      const sourceIndex = currentRecord.elements.notes.findIndex(
        (note) => note.id === noteId,
      );
      const targetIndex = sourceIndex + (direction === "up" ? -1 : 1);
      if (
        sourceIndex < 0 ||
        targetIndex < 0 ||
        targetIndex >= currentRecord.elements.notes.length
      ) {
        throw new Error("Annotation note cannot move in that direction");
      }
      const notes = [...currentRecord.elements.notes];
      [notes[sourceIndex], notes[targetIndex]] = [
        notes[targetIndex],
        notes[sourceIndex],
      ];
      setBrowserAnnotationElements(
        annotationKey,
        currentRecord.navigationEpoch,
        {
          ...currentRecord.elements,
          notes,
        },
      );
    },
    [annotationKey],
  );

  const removeNote = useCallback(
    (noteId: string) => {
      const currentRecord = recordFor();
      if (
        annotationKey === null ||
        currentRecord === null ||
        currentRecord.elements === null
      ) {
        throw new Error("No page-element session is open");
      }
      const note = currentRecord.elements.notes.find(
        (candidate) => candidate.id === noteId,
      );
      if (note === undefined) throw new Error("Annotation note not found");
      const notes = currentRecord.elements.notes.filter(
        (candidate) => candidate.id !== noteId,
      );
      setBrowserAnnotationElements(
        annotationKey,
        currentRecord.navigationEpoch,
        {
          pageSnapshot:
            notes.length > 0 ? currentRecord.elements.pageSnapshot : null,
          pageSnapshotPreviewUrl:
            notes.length > 0
              ? currentRecord.elements.pageSnapshotPreviewUrl
              : null,
          notes,
          review:
            currentRecord.elements.review?.kind === "edit" &&
            currentRecord.elements.review.noteId === noteId
              ? null
              : currentRecord.elements.review,
        },
      );
    },
    [annotationKey],
  );

  const clearNotes = useCallback(() => {
    const currentRecord = recordFor();
    if (
      annotationKey === null ||
      currentRecord === null ||
      currentRecord.elements === null
    ) {
      return;
    }
    setBrowserAnnotationElements(
      annotationKey,
      currentRecord.navigationEpoch,
      null,
    );
  }, [annotationKey]);

  const editNote = useCallback(
    (note: BrowserElementAnnotationNote) => {
      const currentRecord = recordFor();
      if (
        annotationKey === null ||
        currentRecord === null ||
        currentRecord.elements === null
      ) {
        return;
      }
      setBrowserAnnotationElements(
        annotationKey,
        currentRecord.navigationEpoch,
        {
          ...currentRecord.elements,
          review: {
            comment: note.comment,
            intent: note.intent,
            kind: "edit",
            noteId: note.id,
          },
        },
      );
    },
    [annotationKey],
  );

  const publishEditor = useCallback(
    (editor: BrowserScreenshotEditorSnapshot) => {
      const currentRecord = recordFor();
      if (
        annotationKey === null ||
        currentRecord === null ||
        currentRecord.screenshot === null
      ) {
        return;
      }
      setBrowserAnnotationScreenshot(
        annotationKey,
        currentRecord.navigationEpoch,
        {
          ...currentRecord.screenshot,
          editor,
        },
      );
    },
    [annotationKey],
  );

  const closeScreenshotEditor = useCallback(() => {
    const currentRecord = recordFor();
    if (
      annotationKey === null ||
      currentRecord === null ||
      currentRecord.screenshot === null
    ) {
      return;
    }
    setBrowserAnnotationScreenshot(
      annotationKey,
      currentRecord.navigationEpoch,
      null,
    );
  }, [annotationKey]);

  const startScreenshotEditor = useCallback(async () => {
    const runtime = propsRef.current;
    const currentTarget = targetRef.current;
    const currentRecord = recordFor();
    if (
      annotationKey === null ||
      currentTarget === null ||
      !runtime.experimental_browserControlAvailable ||
      !runtime.isVisible ||
      currentRecord === null ||
      currentRecord.screenshot !== null
    ) {
      return;
    }
    let preview: ExperimentalBrowserPageCapture | null = null;
    try {
      const capture = await capturePage({
        epoch: currentTarget.navigationEpoch,
        format: "png",
        quality: 100,
      });
      preview = capture.preview;
      assertCurrent(currentTarget.navigationEpoch);
      setBrowserAnnotationScreenshot(
        annotationKey,
        currentTarget.navigationEpoch,
        {
          editor: createEmptyBrowserScreenshotEditor({
            id: crypto.randomUUID(),
            ...capture.descriptor.pixelSize,
          }),
          screenshot: capture.descriptor,
          previewUrl: capture.preview.url,
        },
      );
    } catch (error) {
      if (!isExpectedBrowserCancellation(error)) {
        toastError(toast, "Browser screenshot capture failed");
      }
    } finally {
      if (preview !== null)
        retainBrowserAnnotationPreview(annotationKey, preview);
    }
  }, [annotationKey, assertCurrent, capturePage]);

  const editorSession = useCallback((): BrowserScreenshotSession | null => {
    const currentRecord = recordFor();
    if (annotationKey === null || currentRecord === null) return null;
    return currentRecord.screenshot;
  }, [annotationKey]);

  const mutateEditor = useCallback(
    (
      mutator: (
        editor: BrowserScreenshotEditorSnapshot,
      ) => BrowserScreenshotEditorSnapshot,
    ): void => {
      const currentRecord = recordFor();
      if (
        annotationKey === null ||
        currentRecord === null ||
        currentRecord.screenshot === null
      ) {
        throw new Error("No screenshot drawing is open");
      }
      const session = currentRecord.screenshot;
      setBrowserAnnotationScreenshot(
        annotationKey,
        currentRecord.navigationEpoch,
        {
          ...session,
          editor: mutator(session.editor),
        },
      );
    },
    [annotationKey],
  );

  const undoEditor = useCallback(() => {
    mutateEditor((editor) => {
      const previous = editor.past.at(-1);
      if (previous === undefined) return editor;
      return {
        ...editor,
        past: editor.past.slice(0, -1),
        redo: [editor.shapes, ...editor.redo],
        shapes: previous,
      };
    });
  }, [mutateEditor]);

  const redoEditor = useCallback(() => {
    mutateEditor((editor) => {
      const next = editor.redo[0];
      if (next === undefined) return editor;
      return {
        ...editor,
        past: [...editor.past, editor.shapes],
        redo: editor.redo.slice(1),
        shapes: next,
      };
    });
  }, [mutateEditor]);

  const clearDrawing = useCallback(() => {
    mutateEditor((editor) => {
      if (editor.shapes.length === 0) return editor;
      return {
        ...editor,
        past: [...editor.past, editor.shapes],
        redo: [],
        shapes: [],
      };
    });
  }, [mutateEditor]);

  const replaceEditorState = useCallback(
    (editor: BrowserScreenshotEditorSnapshot): void => {
      const currentRecord = recordFor();
      if (
        annotationKey === null ||
        currentRecord === null ||
        currentRecord.screenshot === null
      ) {
        throw new Error("No screenshot drawing is open");
      }
      setBrowserAnnotationScreenshot(
        annotationKey,
        currentRecord.navigationEpoch,
        {
          ...currentRecord.screenshot,
          editor,
        },
      );
    },
    [annotationKey],
  );

  const requestScreenshot = useCallback(
    async (
      signal: AbortSignal,
    ): Promise<{
      screenshot: ExperimentalBrowserCaptureDescriptor;
    }> => {
      const currentTarget = targetRef.current;
      if (
        annotationKey === null ||
        currentTarget === null ||
        !propsRef.current.isVisible
      ) {
        throw new Error(
          "Browser screenshot capture requires a visible Browser page",
        );
      }
      const capture = await capturePage({
        epoch: currentTarget.navigationEpoch,
        format: "png",
        quality: 100,
        signal,
      });
      try {
        assertCurrent(currentTarget.navigationEpoch);
        setBrowserAnnotationScreenshot(
          annotationKey,
          currentTarget.navigationEpoch,
          {
            editor: createEmptyBrowserScreenshotEditor({
              id: crypto.randomUUID(),
              ...capture.descriptor.pixelSize,
            }),
            screenshot: capture.descriptor,
            previewUrl: capture.preview.url,
          },
        );
        return { screenshot: capture.descriptor };
      } finally {
        retainBrowserAnnotationPreview(annotationKey, capture.preview);
      }
    },
    [annotationKey, assertCurrent, capturePage],
  );

  const exportAnnotatedPng = useCallback(async (): Promise<Blob> => {
    const session = editorSession();
    if (session === null) {
      throw new Error("No screenshot drawing is open");
    }
    const image = await loadScreenshotImage(session.previewUrl);
    if (image === null) {
      throw new Error("The annotated screenshot could not be decoded");
    }
    const blob = await annotatedScreenshotBlob(image, session.editor.shapes);
    if (blob === null) {
      throw new Error("The annotated screenshot could not be encoded");
    }
    return blob;
  }, [editorSession]);

  const notesForExport = useCallback((): string | null => {
    const currentTarget = targetRef.current;
    const currentRecord = recordFor();
    const exportNotes = currentRecord?.elements?.notes ?? [];
    if (currentTarget === null || exportNotes.length === 0) return null;
    return browserElementAnnotationsAgentText(exportNotes, currentTarget.tabId);
  }, [annotationKey]);

  const copyAnnotationsText = useCallback(async (): Promise<{
    copied: boolean;
  }> => {
    const text = notesForExport();
    if (text === null) {
      throw new Error("No page annotations are available to copy");
    }
    const copied = await copyTextToClipboard(text);
    return { copied };
  }, [notesForExport]);

  const composerScopeTargetsThread = useCallback((): boolean => {
    const scope = composerRef.current?.scope;
    if (scope === null || scope === undefined) return false;
    if (scope.kind === "thread") return scope.threadId === props.threadId;
    if (scope.kind === "queued-message")
      return scope.threadId === props.threadId;
    return false;
  }, [props.threadId]);

  const addAnnotationsToChat = useCallback(async (): Promise<{
    addedToChat: boolean;
  }> => {
    if (!composerScopeTargetsThread()) {
      throw new Error(
        "The annotation composer is unavailable for this Browser thread",
      );
    }
    const text = notesForExport();
    if (text === null) {
      throw new Error("No page annotations are available to add to chat");
    }
    composerRef.current?.addQuote(text);
    return { addedToChat: true };
  }, [composerScopeTargetsThread, notesForExport]);

  const handleRequest = useCallback(
    async (request: RequestHandlerArgs): Promise<JsonValue> => {
      const operation = readOperation(request.input);
      const epoch = request.target.navigationEpoch;
      const succeed = (value: unknown): JsonValue => {
        validateBrowserAnnotationOperationResult(operation, value);
        return json(value);
      };
      switch (operation.operation) {
        case "get": {
          assertCurrent(epoch);
          const currentRecord = recordFor();
          if (currentRecord === null) {
            return succeed({ notes: [], screenshot: null, review: null });
          }
          if (currentRecord.navigationEpoch !== epoch) {
            throw new Error("Annotation target is unavailable");
          }
          const screenshot =
            currentRecord.screenshot === null
              ? null
              : {
                  editor: currentRecord.screenshot.editor,
                  screenshot: currentRecord.screenshot.screenshot,
                };
          const review =
            currentRecord.elements?.review?.kind === "new"
              ? {
                  annotation: currentRecord.elements.review.annotation,
                  captureError: currentRecord.elements.review.captureError,
                  comment: currentRecord.elements.review.comment,
                  intent: currentRecord.elements.review.intent,
                  kind: "new" as const,
                  screenshot: currentRecord.elements.review.screenshot,
                }
              : (currentRecord.elements?.review ?? null);
          return succeed({
            notes: currentRecord.elements?.notes ?? [],
            screenshot,
            review,
          });
        }
        case "pick": {
          const mode: AnnotationToolbarMode =
            operation.mode === "annotate" ? "annotate" : "grab";
          assertCurrent(epoch);
          if (!propsRef.current.experimental_browserControlAvailable) {
            throw new Error("Browser page scripts are unavailable");
          }
          if (!propsRef.current.isVisible) {
            throw new Error("Element picking requires a visible Browser page");
          }
          const controller = new AbortController();
          const abortFromRequest = () =>
            controller.abort(request.signal?.reason);
          if (request.signal.aborted) controller.abort(request.signal.reason);
          else
            request.signal.addEventListener("abort", abortFromRequest, {
              once: true,
            });
          pickerControllerRef.current = controller;
          setPickerMode(mode);
          let preview: ExperimentalBrowserPageCapture | null = null;
          try {
            const annotation = await pickElement({
              epoch,
              signal: controller.signal,
              ...(operation.timeoutMs === undefined
                ? {}
                : { timeoutMs: operation.timeoutMs }),
            });
            if (mode === "grab") {
              return succeed({
                annotation,
                text: browserElementAnnotationAgentText(annotation),
              });
            }
            let captureError: string | null = null;
            let pageSnapshot: ExperimentalBrowserCaptureDescriptor | null =
              null;
            let screenshot: ExperimentalBrowserCaptureDescriptor | null = null;
            let pageSnapshotPreviewUrl: string | null = null;
            let screenshotPreviewUrl: string | null = null;
            try {
              const capture = await capturePage({
                epoch,
                format: "jpeg",
                quality: 82,
                signal: controller.signal,
              });
              preview = capture.preview;
              pageSnapshot = capture.descriptor;
              pageSnapshotPreviewUrl = capture.preview.url;
              screenshotPreviewUrl = await cropBrowserElementScreenshot({
                annotation,
                dataUrl: capture.preview.url,
              });
              if (screenshotPreviewUrl !== null) {
                screenshot =
                  await propsRef.current.experimental_createImageResource(
                    { blob: await (await fetch(screenshotPreviewUrl)).blob() },
                    { signal: controller.signal },
                  );
              }
            } catch (error) {
              if (isExpectedBrowserCancellation(error)) throw error;
              captureError = "The page preview could not be captured.";
            }
            if (controller.signal.aborted) {
              throw new DOMException("cancelled", "AbortError");
            }
            assertCurrent(epoch);
            setBrowserAnnotationElements(annotationKey!, epoch, {
              notes: recordFor()?.elements?.notes ?? [],
              pageSnapshot,
              pageSnapshotPreviewUrl,
              review: {
                annotation,
                captureError,
                comment: "",
                intent: "change",
                kind: "new",
                screenshot,
                screenshotPreviewUrl,
              },
            });
            return succeed({
              annotation,
              pageSnapshot,
              screenshot,
              captureError,
            });
          } catch (error) {
            if (isExpectedBrowserCancellation(error)) {
              throw new DOMException("cancelled", "AbortError");
            }
            throw error;
          } finally {
            if (preview !== null && annotationKey !== null) {
              retainBrowserAnnotationPreview(annotationKey, preview);
            }
            request.signal.removeEventListener("abort", abortFromRequest);
            if (pickerControllerRef.current === controller) {
              pickerControllerRef.current = null;
              setPickerMode(null);
            }
          }
        }
        case "grab": {
          assertCurrent(epoch);
          const annotation = await pickElement({
            epoch,
            element: operation.element,
            frame: operation.frame,
            signal: request.signal,
            ...(operation.timeoutMs === undefined
              ? {}
              : { timeoutMs: operation.timeoutMs }),
          });
          return succeed({
            annotation,
            text: browserElementAnnotationAgentText(annotation),
          });
        }
        case "annotate": {
          const annotation = await pickElement({
            epoch,
            element: operation.element,
            frame: operation.frame,
            signal: request.signal,
            ...(operation.timeoutMs === undefined
              ? {}
              : { timeoutMs: operation.timeoutMs }),
          });
          assertCurrent(epoch);
          const existing = recordFor()?.elements?.notes ?? [];
          const note: BrowserElementAnnotationNote = {
            annotation,
            comment: operation.feedback,
            createdAt: new Date().toISOString(),
            id: crypto.randomUUID(),
            pageId: request.target.tabId,
            intent: operation.intent,
            screenshot: null,
            priority: "important",
          };
          const elements = recordFor()?.elements;
          setBrowserAnnotationElements(annotationKey!, epoch, {
            notes: [...existing, note],
            pageSnapshot: elements?.pageSnapshot ?? null,
            pageSnapshotPreviewUrl: elements?.pageSnapshotPreviewUrl ?? null,
            review: null,
          });
          return succeed({
            annotation,
            intent: operation.intent,
            feedback: operation.feedback,
            tab: request.target,
          });
        }
        case "update-note": {
          assertCurrent(epoch);
          updateNote(operation.id, operation.feedback, operation.intent);
          return succeed({ id: operation.id, updated: true });
        }
        case "remove-note": {
          assertCurrent(epoch);
          removeNote(operation.id);
          return succeed({ id: operation.id, removed: true });
        }
        case "move-note": {
          assertCurrent(epoch);
          moveNote(operation.id, operation.direction);
          return succeed({ id: operation.id, moved: true });
        }
        case "clear-notes": {
          assertCurrent(epoch);
          clearNotes();
          return succeed({ cleared: true });
        }
        case "screenshot": {
          assertCurrent(epoch);
          const result = await requestScreenshot(request.signal);
          return succeed(result);
        }
        case "set-editor": {
          assertCurrent(epoch);
          const parsedEditor = browserScreenshotEditorStateSchema.safeParse(
            operation.editor,
          );
          if (!parsedEditor.success) {
            throw new Error(
              "set-editor requires a bounded editor snapshot with valid shapes",
            );
          }
          const session = editorSession();
          if (session === null)
            throw new Error("No screenshot drawing is open");
          const image = session.editor.image;
          if (
            parsedEditor.data.image.id !== image.id ||
            parsedEditor.data.image.width !== image.width ||
            parsedEditor.data.image.height !== image.height
          ) {
            throw new Error(
              "set-editor must describe the current screenshot image",
            );
          }
          replaceEditorState(parsedEditor.data);
          return succeed({ editor: parsedEditor.data });
        }
        case "undo": {
          assertCurrent(epoch);
          undoEditor();
          return succeed({ undone: true });
        }
        case "redo": {
          assertCurrent(epoch);
          redoEditor();
          return succeed({ redone: true });
        }
        case "clear-drawing": {
          assertCurrent(epoch);
          clearDrawing();
          return succeed({ cleared: true });
        }
        case "export": {
          assertCurrent(epoch);
          if (operation.format === "text") {
            const text = notesForExport();
            if (text === null) {
              throw new Error("No page annotations are available to export");
            }
            return succeed({ text });
          }
          const png = await exportAnnotatedPng();
          assertCurrent(epoch);
          return succeed(
            await propsRef.current.experimental_createImageResource(
              { blob: png },
              { signal: request.signal },
            ),
          );
        }
        case "copy": {
          assertCurrent(epoch);
          if (operation.format === "text") {
            const result = await copyAnnotationsText();
            return succeed(result);
          }
          const session = editorSession();
          if (session === null) {
            throw new Error("No screenshot drawing is open");
          }
          const image = await loadScreenshotImage(session.previewUrl);
          if (image === null) {
            throw new Error("The annotated screenshot could not be decoded");
          }
          const blob = await annotatedScreenshotBlob(
            image,
            session.editor.shapes,
          );
          if (blob === null) {
            throw new Error("The annotated screenshot could not be encoded");
          }
          const copied = await copyImageToClipboard(blob);
          return succeed({ copied });
        }
        case "download": {
          assertCurrent(epoch);
          const png = await exportAnnotatedPng();
          assertCurrent(epoch);
          return succeed(
            await propsRef.current.experimental_createImageResource(
              { blob: png },
              { signal: request.signal },
            ),
          );
        }
        case "add-to-chat": {
          assertCurrent(epoch);
          const result = await addAnnotationsToChat();
          return succeed(result);
        }
        case "set-review": {
          assertCurrent(epoch);
          const currentRecord = recordFor();
          if (
            annotationKey === null ||
            currentRecord === null ||
            currentRecord.elements === null
          ) {
            throw new Error("No page-element session is open");
          }
          if (operation.review === null) {
            setBrowserAnnotationElements(annotationKey, epoch, {
              ...currentRecord.elements,
              review: null,
            });
            return succeed({ review: null });
          }
          const parsedDraft = browserReviewDraftSchema.safeParse(
            operation.review,
          );
          if (!parsedDraft.success) {
            throw new Error("set-review requires a valid review draft");
          }
          const draft = parsedDraft.data;
          if (draft.kind === "edit") {
            const noteExists = currentRecord.elements.notes.some(
              (note) => note.id === draft.noteId,
            );
            if (!noteExists) {
              throw new Error(
                "set-review requires a current note id for an edit draft",
              );
            }
            setBrowserAnnotationElements(annotationKey, epoch, {
              ...currentRecord.elements,
              review: draft,
            });
            return succeed({ review: draft });
          }
          const existing = currentRecord.elements.review;
          if (existing?.kind !== "new") {
            throw new Error("set-review requires a current captured draft");
          }
          const retained = {
            ...existing,
            comment: draft.comment,
            intent: draft.intent,
          };
          setBrowserAnnotationElements(annotationKey, epoch, {
            ...currentRecord.elements,
            review: retained,
          });
          return succeed({
            review: {
              annotation: retained.annotation,
              captureError: retained.captureError,
              comment: retained.comment,
              intent: retained.intent,
              kind: "new",
              screenshot: retained.screenshot,
            },
          });
        }
        default: {
          const exhaustive: never = operation;
          throw new Error(
            `Unknown annotation operation: ${JSON.stringify(exhaustive)}`,
          );
        }
      }
    },
    [
      addAnnotationsToChat,
      annotationKey,
      composerScopeTargetsThread,
      assertCurrent,
      clearDrawing,
      clearNotes,
      copyAnnotationsText,
      editorSession,
      exportAnnotatedPng,
      moveNote,
      notesForExport,
      pickElement,
      removeNote,
      replaceEditorState,
      requestScreenshot,
      redoEditor,
      undoEditor,
      updateNote,
    ],
  );

  useEffect(() => {
    return props.experimental_registerRequestHandler(handleRequest);
  }, [handleRequest, props.experimental_registerRequestHandler]);

  useEffect(() => {
    if (target === null || annotationKey === null) return;
    markBrowserAnnotationEpoch(annotationKey, target.navigationEpoch);
    const stored = browserAnnotationSnapshot(annotationKey);
    if (stored !== null && stored.navigationEpoch !== target.navigationEpoch) {
      clearBrowserAnnotationRecord(annotationKey);
      setPickerMode(null);
    }
  }, [annotationKey, target]);

  useEffect(() => {
    return props.experimental_onLifecycle(
      (event: ExperimentalBrowserControllerLifecycle) => {
        if (event.kind !== "disposed" || annotationKey === null) return;
        const scopeGone =
          event.reason === "tab-closed" ||
          event.reason === "thread-removed" ||
          event.reason === "environment-removed" ||
          event.reason === "client-disconnected";
        if (!scopeGone) return;
        clearBrowserAnnotationRecord(annotationKey);
        setPickerMode(null);
      },
    );
  }, [annotationKey, props.experimental_onLifecycle]);

  useEffect(() => {
    return () => {
      pickerControllerRef.current?.abort();
      pickerControllerRef.current = null;
    };
  }, []);

  const interactionState: AnnotationControllerInteractionState = {
    pickerMode,
    reviewOpen: isReviewOpen,
    editorOpen: isEditorOpen,
    browserControlAvailable: props.experimental_browserControlAvailable,
  };
  const interactionStateRef = useRef(interactionState);
  interactionStateRef.current = interactionState;
  const interactionListenersRef = useRef<Set<() => void>>(new Set());

  useEffect(() => {
    for (const listener of interactionListenersRef.current) listener();
  }, [
    pickerMode,
    isReviewOpen,
    isEditorOpen,
    props.experimental_browserControlAvailable,
  ]);

  const startPickerRef = useRef(startPicker);
  startPickerRef.current = startPicker;
  const cancelActivePickerRef = useRef(cancelActivePicker);
  cancelActivePickerRef.current = cancelActivePicker;
  const startScreenshotEditorRef = useRef(startScreenshotEditor);
  startScreenshotEditorRef.current = startScreenshotEditor;

  const controllerApiRef = useRef<AnnotationToolbarController | null>(null);
  if (controllerApiRef.current === null && annotationKey !== null) {
    const api: AnnotationToolbarController = {
      getInteractionState: () => interactionStateRef.current,
      subscribe: (listener) => {
        interactionListenersRef.current.add(listener);
        return () => interactionListenersRef.current.delete(listener);
      },
      startPicker: (mode) => {
        void startPickerRef.current(mode);
      },
      cancelPicker: () => {
        void cancelActivePickerRef.current();
      },
      startScreenshotEditor: () => {
        void startScreenshotEditorRef.current();
      },
    };
    controllerApiRef.current = api;
  }

  useEffect(() => {
    if (annotationKey === null) return;
    const api = controllerApiRef.current;
    if (api === null) return;
    return registerAnnotationToolbarController(annotationKey.tabId, api);
  }, [annotationKey]);

  useEffect(() => {
    const shouldHideNativeView =
      isEditorOpen || isReviewOpen || isSnapshotOverlayOpen;
    props.experimental_setOverlayOpen(shouldHideNativeView);
  }, [isEditorOpen, isReviewOpen, isSnapshotOverlayOpen, props]);

  useEffect(() => {
    setIsTrayOpen(true);
  }, [notes.length, target?.navigationEpoch]);

  if (annotationKey === null || target === null) {
    return null;
  }

  const canShowTray =
    !isPickerActive && !isReviewOpen && !isEditorOpen && notes.length > 0;

  return (
    <div data-browser-annotation-controller="" className="absolute inset-0">
      {isSnapshotOverlayOpen ? (
        <img
          src={pageSnapshotPreviewUrl!}
          alt=""
          draggable={false}
          className="pointer-events-none absolute inset-0 size-full"
        />
      ) : null}
      <BrowserAnnotationOverlay
        open={isEditorOpen}
        onClose={closeScreenshotEditor}
        label="Screenshot annotation"
        fill={true}
      >
        {isEditorOpen && recordRef.current !== null ? (
          <BrowserScreenshotAnnotation
            key={recordRef.current.screenshot?.editor.image.id}
            screenshotUrl={screenshotPreviewUrl!}
            onClose={closeScreenshotEditor}
            initialEditorState={recordRef.current.screenshot?.editor}
            onEditorStateChange={publishEditor}
          />
        ) : null}
      </BrowserAnnotationOverlay>
      <BrowserAnnotationOverlay
        open={isReviewOpen}
        onClose={closeReview}
        label={
          review?.kind === "edit"
            ? "Edit page annotation"
            : "Add page annotation"
        }
        fill={false}
      >
        {isReviewOpen && review !== null && review.kind === "new" ? (
          <BrowserElementAnnotationReview
            key="new-annotation"
            annotation={review.annotation}
            dialogLabel="Add page annotation"
            screenshotUrl={review.screenshotPreviewUrl}
            captureError={review.captureError}
            onRetryCapture={() => {
              void retryNewReviewCapture();
            }}
            comment={review.comment}
            intent={review.intent}
            onCommentChange={(comment) =>
              updateReviewDraft({ ...review, comment })
            }
            onIntentChange={(intent) =>
              updateReviewDraft({ ...review, intent })
            }
            submitLabel="Add"
            onSubmit={addNote}
            onClose={closeReview}
          />
        ) : isReviewOpen &&
          review !== null &&
          review.kind === "edit" &&
          editingNote !== null ? (
          <BrowserElementAnnotationReview
            key={`edit-${editingNote.id}`}
            annotation={editingNote.annotation}
            dialogLabel="Edit page annotation"
            screenshotUrl={null}
            comment={review.comment}
            intent={review.intent}
            onCommentChange={(comment) =>
              updateReviewDraft({ ...review, comment })
            }
            onIntentChange={(intent) =>
              updateReviewDraft({ ...review, intent })
            }
            submitLabel="Save"
            onSubmit={(comment, intent) =>
              updateNote(editingNote.id, comment, intent)
            }
            onClose={closeReview}
          />
        ) : null}
      </BrowserAnnotationOverlay>
      {isCompactViewport && canShowTray && !isTrayOpen ? (
        <button
          type="button"
          onClick={() => setIsTrayOpen(true)}
          className="absolute bottom-3 right-3 z-30 min-h-11 rounded-md border border-border bg-popover px-3 text-sm text-popover-foreground"
        >
          Review {notes.length} annotations
        </button>
      ) : null}
      <BrowserAnnotationOverlay
        open={canShowTray && (!isCompactViewport || isTrayOpen)}
        onClose={() => setIsTrayOpen(false)}
        label="Page annotations"
        fill={false}
      >
        {canShowTray ? (
          <>
            {isCompactViewport ? (
              <button
                type="button"
                onClick={() => setIsTrayOpen(false)}
                className="min-h-11 shrink-0 self-end rounded-md px-3 text-sm text-muted-foreground"
              >
                Close annotations
              </button>
            ) : null}
            <BrowserElementAnnotationTray
              annotations={notes}
              tabId={target.tabId}
              onAddToChat={(text) => {
                if (!composerScopeTargetsThread()) {
                  toastError(
                    toast,
                    "Annotations cannot be added to this composer scope",
                  );
                  return;
                }
                composerRef.current?.addQuote(text);
                toastSuccess(toast, "Page annotations added to chat");
              }}
              onClear={() => {
                clearNotes();
              }}
              onCopy={(text) => {
                void copyTextToClipboard(text).then((copied) => {
                  if (copied) {
                    toastSuccess(toast, "Page annotations copied");
                  } else {
                    toastError(toast, "Failed to copy page annotations");
                  }
                });
              }}
              onEdit={(note) => editNote(note)}
              onRemove={(id) => removeNote(id)}
              onMove={moveNote}
              onSelectElement={() => {
                void startPickerRef.current("annotate");
              }}
            />
          </>
        ) : null}
      </BrowserAnnotationOverlay>
    </div>
  );
}
