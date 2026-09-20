import {
  useEffect,
  useId,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  activityIconClass,
  activityMetaClass,
  activityRowClass,
  activityTextClass,
  type ActivityRowState,
} from "@bb/shared-ui/activity-row-styles";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { Skeleton } from "@bb/shared-ui/skeleton";
import {
  definePluginApp,
  useRpc,
  type PluginMessageDirectiveProps,
} from "@get-bb/plugin-sdk/app";
import type { PreviewFrame, PreviewSize, rpcContract } from "./contracts.js";
import {
  closeLightbox,
  openLightbox,
  useLightboxTarget,
  type LightboxTarget,
} from "./lightbox-store.js";
import { PREVIEW_DIRECTIVE_ID } from "./preview-directive.js";

const MIN_POLL_INTERVAL_MS = 400;
const MAX_RETRY_INTERVAL_MS = 15_000;
const MAX_CONSECUTIVE_FAILURES = 5;
const SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEADER_BUTTON_CLASS =
  "flex min-h-8 min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-none bg-transparent px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-background/80";
const EXPAND_BUTTON_CLASS =
  "flex min-h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-none border-l border-border/35 bg-transparent text-muted-foreground transition-colors hover:text-foreground";

type PreviewStatus = "connecting" | "live" | "ended" | "unavailable";

const STATUS_LABEL: Record<PreviewStatus, string> = {
  connecting: "Connecting",
  live: "Live",
  ended: "Ended",
  unavailable: "Unavailable",
};

function subscribeDocumentVisibility(onChange: () => void): () => void {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

function readDocumentVisible(): boolean {
  return document.visibilityState !== "hidden";
}

function useDocumentVisible(): boolean {
  return useSyncExternalStore(
    subscribeDocumentVisibility,
    readDocumentVisible,
    () => true,
  );
}

function useInViewport(): [(element: Element | null) => void, boolean] {
  const [element, setElement] = useState<Element | null>(null);
  const [inViewport, setInViewport] = useState(true);

  useEffect(() => {
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) setInViewport(entry.isIntersecting);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  return [setElement, inViewport];
}

function pageLocation(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:")
      return `${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}`;
    if (parsed.protocol === "about:") return url;
    if (parsed.protocol === "file:") return decodeURIComponent(parsed.pathname);
    return parsed.protocol;
  } catch {
    return url.slice(0, 80);
  }
}

function pageTitle(frame: PreviewFrame | null): string {
  const title = frame?.title.trim() ?? "";
  return title === "" || title === frame?.url ? "Headless browser" : title;
}

function useLivePreview(args: {
  threadId: string;
  sessionId: string;
  enabled: boolean;
  size: PreviewSize;
  initialFrame: PreviewFrame | null;
}): { frame: PreviewFrame | null; status: PreviewStatus } {
  const { threadId, sessionId, enabled, size, initialFrame } = args;
  const rpc = useRpc<typeof rpcContract>();
  const [frame, setFrame] = useState<PreviewFrame | null>(initialFrame);
  const [status, setStatus] = useState<PreviewStatus>(
    initialFrame ? "live" : "connecting",
  );
  const settled = status === "ended" || status === "unavailable";

  useEffect(() => {
    if (!enabled || settled) return;
    let cancelled = false;
    let timeout: number | null = null;
    let afterSequence = 0;
    let failures = 0;
    const poll = async () => {
      const startedAt = Date.now();
      let delayMs: number;
      try {
        const result = await rpc.call("preview", {
          threadId,
          sessionId,
          afterSequence,
          size,
        });
        if (cancelled) return;
        if (
          result.session.state !== "ready" ||
          result.session.backend !== "local"
        ) {
          setStatus(
            result.session.backend === "local" ? "ended" : "unavailable",
          );
          return;
        }
        failures = 0;
        if (result.frame) {
          afterSequence = result.frame.sequence;
          setFrame(result.frame);
          setStatus("live");
        }
        delayMs = Math.max(0, MIN_POLL_INTERVAL_MS - (Date.now() - startedAt));
      } catch {
        if (cancelled) return;
        failures += 1;
        if (failures >= MAX_CONSECUTIVE_FAILURES) {
          setStatus("unavailable");
          return;
        }
        delayMs = Math.min(1_000 * 2 ** failures, MAX_RETRY_INTERVAL_MS);
      }
      timeout = window.setTimeout(() => void poll(), delayMs);
    };
    void poll();
    return () => {
      cancelled = true;
      if (timeout !== null) window.clearTimeout(timeout);
    };
  }, [enabled, rpc, sessionId, settled, size, threadId]);

  return { frame, status };
}

function PreviewImage({
  frame,
  status,
  title,
  className,
  maxHeight,
}: {
  frame: PreviewFrame | null;
  status: PreviewStatus;
  title: string;
  className: string;
  maxHeight?: string;
}) {
  const aspect = frame ?? { width: 16, height: 9 };
  if (!frame && status !== "connecting") return null;
  return (
    <div
      className={cn(
        "overflow-hidden rounded-md border border-border/60 bg-background",
        className,
      )}
      style={{
        aspectRatio: `${aspect.width} / ${aspect.height}`,
        ...(maxHeight === undefined
          ? {}
          : {
              width: `min(100%, calc(${maxHeight} * ${aspect.width / aspect.height}))`,
            }),
      }}
    >
      {frame ? (
        <img
          src={`data:${frame.mimeType};base64,${frame.data}`}
          alt={
            status === "live"
              ? `Live view of ${title}`
              : `Last view of ${title}`
          }
          draggable={false}
          className={cn(
            "block size-full object-contain",
            status !== "live" && "opacity-60",
          )}
        />
      ) : (
        <div
          role="status"
          aria-busy="true"
          aria-label="Loading browser preview"
          className="size-full"
        >
          <Skeleton className="size-full rounded-none" />
        </div>
      )}
    </div>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function BrowserPreviewDirective({
  attributes,
  source,
  message,
}: PluginMessageDirectiveProps) {
  const sessionId = attributes.session?.trim() ?? "";
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    return (
      <Notice>
        browser-preview requires a valid session attribute, e.g.{" "}
        <code>::browser-preview{'{session="…"}'}</code>
      </Notice>
    );
  }
  return (
    <BrowserPreviewCard
      threadId={message.threadId}
      sessionId={sessionId}
      source={source}
    />
  );
}

function BrowserPreviewCard({
  threadId,
  sessionId,
  source,
}: {
  threadId: string;
  sessionId: string;
  source: string;
}) {
  const visible = useDocumentVisible();
  const [observe, inViewport] = useInViewport();
  const [expanded, setExpanded] = useState(true);
  const enlarged = useLightboxTarget()?.sessionId === sessionId;
  const bodyId = useId();
  const toggleId = useId();
  const { frame, status } = useLivePreview({
    threadId,
    sessionId,
    enabled: visible && inViewport && expanded && !enlarged,
    size: "thumbnail",
    initialFrame: null,
  });
  const activity: ActivityRowState = status === "live" ? "active" : "pending";
  const title = pageTitle(frame);
  const location = frame ? pageLocation(frame.url) : "";

  return (
    <section
      ref={observe}
      aria-label="Browser preview"
      title={source}
      className="my-2 overflow-hidden rounded-lg border border-border bg-surface-recessed"
    >
      <div
        role="group"
        aria-label={`Browser preview controls: ${title}`}
        className={activityRowClass(
          "active",
          "flex w-full items-stretch rounded-none px-0 py-0",
        )}
      >
        <button
          type="button"
          id={toggleId}
          aria-expanded={expanded}
          aria-controls={bodyId}
          aria-label={`Browser preview: ${title}`}
          onClick={() => setExpanded((value) => !value)}
          className={HEADER_BUTTON_CLASS}
        >
          <Icon
            name="Globe"
            className={activityIconClass(activity, "size-3.5 shrink-0")}
            aria-hidden
          />
          <span className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
            <span
              className={activityTextClass(activity, "min-w-0 truncate")}
              title={title}
            >
              {title}
            </span>
            {location ? (
              <span
                className={activityMetaClass(
                  activity,
                  "min-w-0 shrink truncate text-2xs",
                )}
                title={frame?.url}
              >
                {location}
              </span>
            ) : null}
          </span>
          <span className={activityMetaClass(activity, "shrink-0 text-2xs")}>
            {STATUS_LABEL[status]}
          </span>
          <Icon
            name="ChevronDown"
            className={cn(
              activityIconClass("pending"),
              "size-3.5 shrink-0 transition-transform duration-200",
              expanded && "rotate-180",
            )}
            aria-hidden
          />
        </button>
        {frame ? (
          <button
            type="button"
            aria-haspopup="dialog"
            aria-label="Expand browser preview"
            title="Expand"
            onClick={() => openLightbox({ threadId, sessionId, frame })}
            className={EXPAND_BUTTON_CLASS}
          >
            <Icon name="Maximize2" className="size-3.5" aria-hidden />
          </button>
        ) : null}
      </div>
      {expanded && (frame || status === "connecting") ? (
        <div
          id={bodyId}
          role="region"
          aria-labelledby={toggleId}
          className="border-t border-border bg-popover p-2"
        >
          <PreviewImage
            frame={frame}
            status={status}
            title={title}
            className="mx-auto w-full max-w-md"
          />
        </div>
      ) : null}
    </section>
  );
}

function LightboxBody({
  target,
  open,
}: {
  target: LightboxTarget;
  open: boolean;
}) {
  const visible = useDocumentVisible();
  const { frame, status } = useLivePreview({
    threadId: target.threadId,
    sessionId: target.sessionId,
    enabled: visible && open,
    size: "full",
    initialFrame: target.frame,
  });
  const title = pageTitle(frame);
  const location = frame ? pageLocation(frame.url) : "";

  return (
    <>
      <DialogHeader>
        <DialogTitle className="truncate pr-8 text-sm">{title}</DialogTitle>
        <DialogDescription className="truncate text-xs">
          {[location, STATUS_LABEL[status]].filter(Boolean).join(" · ")}
        </DialogDescription>
      </DialogHeader>
      <PreviewImage
        frame={frame}
        status={status}
        title={title}
        className="mx-auto"
        maxHeight="78dvh"
      />
    </>
  );
}

function BrowserPreviewLightbox() {
  const target = useLightboxTarget();
  const [shown, setShown] = useState(target);
  if (target !== null && target !== shown) setShown(target);

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) closeLightbox();
      }}
    >
      <DialogContent className="max-w-6xl gap-3 p-4">
        {shown ? (
          <LightboxBody
            key={shown.sessionId}
            target={shown}
            open={target !== null}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export default definePluginApp((app) => {
  app.slots.messageDirective({
    id: PREVIEW_DIRECTIVE_ID,
    component: BrowserPreviewDirective,
  });
  app.slots.experimental_appOverlay({
    id: "browser-preview-lightbox",
    component: BrowserPreviewLightbox,
  });
});
