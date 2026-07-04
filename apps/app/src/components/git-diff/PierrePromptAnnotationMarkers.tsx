import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type RefObject,
} from "react";
import type { PromptDraftAnnotation } from "@/lib/prompt-draft";
import { Icon } from "@/components/ui/icon.js";
import { cn } from "@/lib/utils";

interface PierrePromptAnnotationMarkersProps {
  annotations: readonly PromptDraftAnnotation[];
  containerRef: RefObject<HTMLElement | null>;
  renderRevision?: number;
}

interface AnnotationMarker {
  annotation: PromptDraftAnnotation;
  top: number;
}

const ANNOTATION_STYLE_ID = "bb-prompt-annotation-lines";

function lineRangeLabel(annotation: PromptDraftAnnotation): string {
  return annotation.startLine === annotation.endLine
    ? `Line ${annotation.startLine}`
    : `Lines ${annotation.startLine}-${annotation.endLine}`;
}

function getAnnotationLineNumbers(annotation: PromptDraftAnnotation): number[] {
  const startLine = Math.min(annotation.startLine, annotation.endLine);
  const endLine = Math.max(annotation.startLine, annotation.endLine);
  const lineNumbers: number[] = [];
  for (let lineNumber = startLine; lineNumber <= endLine; lineNumber += 1) {
    lineNumbers.push(lineNumber);
  }
  return lineNumbers;
}

function getShadowRoots(containerElement: HTMLElement | null): ShadowRoot[] {
  if (containerElement === null) {
    return [];
  }

  const roots: ShadowRoot[] = [];
  const visit = (root: ParentNode) => {
    for (const element of Array.from(root.querySelectorAll("*"))) {
      if (element.shadowRoot !== null) {
        roots.push(element.shadowRoot);
        visit(element.shadowRoot);
      }
    }
  };
  visit(containerElement);
  return roots;
}

function ensureAnnotationStyle(root: ShadowRoot) {
  if (root.getElementById(ANNOTATION_STYLE_ID) !== null) {
    return;
  }

  const style = document.createElement("style");
  style.id = ANNOTATION_STYLE_ID;
  style.textContent = `
    [data-bb-prompt-annotation-line] {
      --diffs-selection-mix-target: var(--diffs-modified-base);
      --mix-selection-light: 94%;
      --mix-selection-dark: 90%;
      --diffs-computed-selected-line-bg: light-dark(
        color-mix(in lab, var(--diffs-computed-decoration-bg) var(--mix-selection-light), var(--diffs-selection-mix-target)),
        color-mix(in lab, var(--diffs-computed-decoration-bg) var(--mix-selection-dark), var(--diffs-selection-mix-target))
      );
      --diffs-line-bg: var(--diffs-computed-selected-line-bg);
    }
    [data-bb-prompt-annotation-line="start"] {
      box-shadow: inset 2px 0 0 var(--diffs-modified-base);
    }
  `;
  root.append(style);
}

function clearAnnotationLineAttributes(root: ShadowRoot) {
  for (const element of Array.from(
    root.querySelectorAll<HTMLElement>("[data-bb-prompt-annotation-line]"),
  )) {
    element.removeAttribute("data-bb-prompt-annotation-line");
  }
}

function findLineElements(root: ShadowRoot, lineNumber: number): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      `[data-line="${lineNumber}"], [data-column-number="${lineNumber}"]`,
    ),
  );
}

function getMarkerAnchorElement(
  roots: readonly ShadowRoot[],
  annotation: PromptDraftAnnotation,
): HTMLElement | null {
  for (const root of roots) {
    const lineElement =
      root.querySelector<HTMLElement>(
        `[data-column-number="${annotation.startLine}"]`,
      ) ??
      root.querySelector<HTMLElement>(`[data-line="${annotation.startLine}"]`);
    if (lineElement !== null) {
      return lineElement;
    }
  }
  return null;
}

export function PierrePromptAnnotationMarkers({
  annotations,
  containerRef,
  renderRevision = 0,
}: PierrePromptAnnotationMarkersProps) {
  const [expandedAnnotationId, setExpandedAnnotationId] = useState<
    string | null
  >(null);
  const [markers, setMarkers] = useState<AnnotationMarker[]>([]);
  const markerKey = useMemo(
    () =>
      annotations
        .map(
          (annotation) =>
            `${annotation.id}:${annotation.path}:${annotation.startLine}:${annotation.endLine}`,
        )
        .join("|"),
    [annotations],
  );

  useEffect(() => {
    const containerElement = containerRef.current;
    if (containerElement === null || annotations.length === 0) {
      setMarkers([]);
      return;
    }

    let animationFrame: number | null = null;
    let cancelled = false;
    let attempts = 0;
    let observer: MutationObserver | null = null;

    function scheduleRenderMarkers() {
      if (animationFrame !== null) {
        return;
      }
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = null;
        renderMarkers();
      });
    }

    function renderMarkers() {
      if (cancelled) {
        return;
      }

      const currentContainer = containerRef.current;
      if (currentContainer === null) {
        setMarkers([]);
        return;
      }

      const roots = getShadowRoots(currentContainer);
      if (roots.length === 0 && attempts < 8) {
        attempts += 1;
        scheduleRenderMarkers();
        return;
      }

      for (const root of roots) {
        ensureAnnotationStyle(root);
        clearAnnotationLineAttributes(root);
      }

      for (const annotation of annotations) {
        const startLine = Math.min(annotation.startLine, annotation.endLine);
        for (const root of roots) {
          for (const lineNumber of getAnnotationLineNumbers(annotation)) {
            for (const element of findLineElements(root, lineNumber)) {
              element.setAttribute(
                "data-bb-prompt-annotation-line",
                lineNumber === startLine &&
                  element.hasAttribute("data-column-number")
                  ? "start"
                  : "",
              );
            }
          }
        }
      }

      const containerRect = currentContainer.getBoundingClientRect();
      setMarkers(
        annotations.flatMap((annotation) => {
          const anchor = getMarkerAnchorElement(roots, annotation);
          if (anchor === null) {
            return [];
          }
          return [
            {
              annotation,
              top: anchor.getBoundingClientRect().top - containerRect.top,
            },
          ];
        }),
      );
    }

    observer = new MutationObserver((mutations) => {
      const changedOutsideOverlay = mutations.some(
        (mutation) =>
          !(mutation.target instanceof Element) ||
          mutation.target.closest("[data-bb-prompt-annotation-overlay]") ===
            null,
      );
      if (changedOutsideOverlay) {
        scheduleRenderMarkers();
      }
    });
    observer.observe(containerElement, { childList: true, subtree: true });
    renderMarkers();
    return () => {
      cancelled = true;
      observer?.disconnect();
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
      for (const root of getShadowRoots(containerElement)) {
        clearAnnotationLineAttributes(root);
      }
    };
  }, [annotations, containerRef, markerKey, renderRevision]);

  const toggleExpandedAnnotation = useCallback((annotationId: string) => {
    setExpandedAnnotationId((currentId) =>
      currentId === annotationId ? null : annotationId,
    );
  }, []);

  if (markers.length === 0) {
    return null;
  }

  return (
    <div
      className="pointer-events-none absolute inset-0 z-10"
      data-bb-prompt-annotation-overlay=""
    >
      {markers.map(({ annotation, top }) => {
        const label = lineRangeLabel(annotation);
        const comment = annotation.comment.trim();
        const expanded = expandedAnnotationId === annotation.id;
        return (
          <div
            key={annotation.id}
            className="absolute left-1 flex max-w-[min(18rem,calc(100%-0.5rem))] items-start gap-1"
            style={{ top }}
          >
            <button
              type="button"
              className="pointer-events-auto flex size-5 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-muted-foreground shadow-sm hover:text-foreground"
              aria-label={`${label} comment`}
              title={`${label}${comment.length > 0 ? `: ${comment}` : ""}`}
              onClick={() => toggleExpandedAnnotation(annotation.id)}
            >
              <Icon name="MessageSquare" className="size-3" />
            </button>
            <button
              type="button"
              className={cn(
                "pointer-events-auto min-w-0 rounded border border-border bg-surface/95 px-2 py-1 text-left text-xs leading-tight shadow-md",
                expanded ? "block" : "hidden",
              )}
              onClick={() => toggleExpandedAnnotation(annotation.id)}
            >
              <span className="block font-medium text-foreground">{label}</span>
              {comment.length > 0 ? (
                <span className="mt-0.5 block max-h-24 overflow-auto whitespace-pre-wrap text-muted-foreground">
                  {comment}
                </span>
              ) : null}
            </button>
          </div>
        );
      })}
    </div>
  );
}
