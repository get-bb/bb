import {
  useLayoutEffect,
  useEffect,
  useRef,
  useState,
  useContext,
  type ComponentPropsWithoutRef,
} from "react";
import { cn } from "@bb/shared-ui/lib/utils";
import { useLatestRef } from "@/hooks/useLatestRef";
import {
  MarkdownImageMetadataContext,
  type MarkdownImageDimensions,
} from "./markdown-image-dimensions";

const visibleImages = new Map<Element, () => void>();
let visibilityObserver: IntersectionObserver | undefined;

function observeImage(image: HTMLImageElement, load: () => void): () => void {
  if (typeof IntersectionObserver === "undefined") {
    load();
    return () => {};
  }
  visibilityObserver ??= new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (
        entry.isIntersecting &&
        !entry.target.closest('[hidden], [inert], [aria-hidden="true"]')
      ) {
        visibleImages.get(entry.target)?.();
      }
    }
  });
  visibleImages.set(image, load);
  visibilityObserver.observe(image);
  return () => {
    visibilityObserver?.unobserve(image);
    visibleImages.delete(image);
    if (visibleImages.size === 0) {
      visibilityObserver?.disconnect();
      visibilityObserver = undefined;
    }
  };
}

function positiveDimension(
  value: number | string | undefined,
): number | undefined {
  const number = typeof value === "string" ? Number(value) : value;
  return number !== undefined && Number.isFinite(number) && number > 0
    ? number
    : undefined;
}

function isLocalFileImage(source: string): boolean {
  try {
    const url = new URL(source, window.location.href);
    return (
      url.origin === window.location.origin &&
      /^\/api\/v1\/threads\/[^/]+\/(?:host-files\/content|worktree\/(?:content|files\/.*)|thread-storage\/(?:content|files\/.*))$/u.test(
        url.pathname,
      )
    );
  } catch {
    return false;
  }
}

export function MarkdownImage({
  src,
  srcSet,
  width,
  height,
  style,
  className,
  onLoad,
  onError,
  ...attributes
}: ComponentPropsWithoutRef<"img"> & { src: string }) {
  const imageRef = useRef<HTMLImageElement>(null);
  const metadata = useContext(MarkdownImageMetadataContext);
  const metadataRef = useLatestRef(metadata);
  const etag = useRef<string | null>(null);
  const [dimensions, setDimensions] = useState<
    MarkdownImageDimensions | undefined
  >(() => (srcSet ? undefined : metadata?.read(src)));
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [responsive, setResponsive] = useState(Boolean(srcSet));
  const [localSource, setLocalSource] = useState<string>();
  const revalidate = !responsive && isLocalFileImage(src);
  const requestedWidth = positiveDimension(width);
  const requestedHeight = positiveDimension(height);
  const ratio =
    requestedWidth && requestedHeight
      ? requestedWidth / requestedHeight
      : dimensions
        ? dimensions.width / dimensions.height
        : undefined;
  const aspectRatio =
    requestedWidth && requestedHeight
      ? `${requestedWidth} / ${requestedHeight}`
      : dimensions
        ? `${dimensions.width} / ${dimensions.height}`
        : undefined;
  const displayWidth =
    requestedWidth ??
    (requestedHeight && ratio ? requestedHeight * ratio : dimensions?.width);

  useLayoutEffect(() => {
    const image = imageRef.current;
    if (!image) return;
    if (image.parentElement?.tagName === "PICTURE") {
      setResponsive(true);
      setDimensions(undefined);
    }
    return observeImage(image, () => setActive(true));
  }, []);

  useEffect(() => {
    if (!active || !revalidate) return;
    const controller = new AbortController();
    let objectUrl: string | undefined;
    const load = async () => {
      try {
        const response = await fetch(src, {
          cache: "no-cache",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Image unavailable");
        etag.current = response.headers.get("etag");
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setLocalSource(objectUrl);
      } catch {
        if (!controller.signal.aborted) setStatus("error");
      }
    };
    void load();
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [active, revalidate, src]);

  useLayoutEffect(() => {
    const image = imageRef.current;
    if (!image || (!active && !responsive)) return;
    let cancelled = false;
    const ready = async () => {
      if (!image.complete || image.naturalWidth === 0) return;
      const intrinsic = {
        width: image.naturalWidth,
        height: image.naturalHeight,
      };
      if (!responsive) {
        metadataRef.current?.remember(src, intrinsic, etag.current);
        setDimensions(intrinsic);
      }
      try {
        await image.decode();
      } catch {}
      if (!cancelled && image.complete && image.naturalWidth > 0)
        setStatus("ready");
    };
    image.addEventListener("load", ready);
    void ready();
    return () => {
      cancelled = true;
      image.removeEventListener("load", ready);
    };
  }, [src, active, responsive, localSource, metadataRef]);

  return (
    <img
      {...attributes}
      ref={imageRef}
      src={revalidate ? localSource : active || responsive ? src : undefined}
      srcSet={srcSet}
      width={width}
      height={height}
      data-markdown-image-src={src}
      data-markdown-image-state={status}
      loading={active ? "eager" : "lazy"}
      fetchPriority={active ? "high" : "auto"}
      decoding="async"
      className={cn(
        className,
        status === "loading" && "bg-surface-recessed text-transparent",
      )}
      style={{
        ...(status !== "error" && ratio && displayWidth
          ? {
              aspectRatio,
              width: `min(${displayWidth}px, calc(max(384px, 50vh) * ${ratio}))`,
              height: "auto",
            }
          : status === "loading"
            ? { minWidth: "1lh", minHeight: "1lh" }
            : {}),
        ...style,
      }}
      onLoad={onLoad}
      onError={(event) => {
        setStatus("error");
        onError?.(event);
      }}
    />
  );
}
