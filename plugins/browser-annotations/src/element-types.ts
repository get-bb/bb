import type { ExperimentalBrowserCaptureDescriptor } from "@get-bb/plugin-sdk/browser";

export type BrowserElementAnnotationIntent =
  | "fix"
  | "change"
  | "question"
  | "approve";

export type BrowserElementAnnotationPriority =
  | "blocking"
  | "important"
  | "suggestion";

export interface BrowserElementAnnotation {
  accessibility: {
    ariaLabel: string | null;
    ariaLabelledBy: string | null;
    description: string | null;
    name: string | null;
    role: string | null;
  };
  ancestorPath: readonly string[];
  capturedAt: string;
  devicePixelRatio: number;
  dom: {
    attributes: Readonly<Record<string, string>>;
    classes: readonly string[];
    id: string | null;
    selector: string;
    tag: string;
  };
  fullDomPath: string;
  html: string | null;
  nearbyElements: readonly string[];
  nearbyText: readonly string[];
  pageUrl: string;
  reactComponents: string | null;
  rect: { height: number; width: number; x: number; y: number };
  rectPage: { height: number; width: number; x: number; y: number };
  scroll: { x: number; y: number };
  selectedText: string | null;
  sensitive: boolean;
  sourceFile: string | null;
  styles: BrowserElementAnnotationStyles;
  text: string;
  title: string | null;
  viewport: { height: number; width: number };
}

export interface BrowserElementAnnotationStyles {
  backgroundColor: string;
  border: string;
  borderRadius: string;
  color: string;
  display: string;
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  height: string;
  lineHeight: string;
  margin: string;
  opacity: string;
  padding: string;
  position: string;
  textAlign: string;
  width: string;
  zIndex: string;
}

export interface BrowserElementAnnotationNote {
  annotation: BrowserElementAnnotation;
  comment: string;
  createdAt: string;
  id: string;
  pageId: string;
  intent: BrowserElementAnnotationIntent;
  screenshot: ExperimentalBrowserCaptureDescriptor | null;
  priority: BrowserElementAnnotationPriority;
}
