import { useEffect, useLayoutEffect, useState } from "react";
import { cn } from "@bb/shared-ui/lib/utils";
import { Icon } from "@bb/shared-ui/icon";
import { getDesktopBrowserApi } from "@/lib/bb-desktop";

const imageSizes = new Map<string, number>();

function rememberImageSize(url: string, size: number): void {
  if (size <= 0) return;
  imageSizes.delete(url);
  imageSizes.set(url, size);
  if (imageSizes.size > 128) {
    const oldest = imageSizes.keys().next().value;
    if (oldest !== undefined) imageSizes.delete(oldest);
  }
}

function isBetterSize(size: number, best: number, target: number): boolean {
  return (
    size > 0 &&
    (best === 0 ||
      (best < target ? size > best : size >= target && size < best))
  );
}

function cachedImageUrl(
  urls: readonly string[],
  target: number,
): string | null {
  let selected = urls[0] ?? null;
  let best = 0;
  for (const url of urls) {
    const size = imageSizes.get(url) ?? 0;
    if (isBetterSize(size, best, target)) {
      best = size;
      selected = url;
    }
  }
  return selected;
}

export function BrowserTabIcon({
  tabId,
  className,
}: {
  tabId: string;
  className?: string;
}) {
  const [urls, setUrls] = useState<readonly string[]>([]);

  useLayoutEffect(() => {
    setUrls([]);
    return getDesktopBrowserApi()?.onState((state) => {
      if (state.tabId !== tabId) return;
      const next =
        state.faviconUrls ?? (state.faviconUrl ? [state.faviconUrl] : []);
      setUrls((current) =>
        current.length === next.length &&
        current.every((url, index) => url === next[index])
          ? current
          : next,
      );
    });
  }, [tabId]);

  return (
    <FaviconImage
      key={JSON.stringify([tabId, urls])}
      urls={urls}
      className={className}
    />
  );
}

function FaviconImage({
  urls,
  className,
}: {
  urls: readonly string[];
  className?: string;
}) {
  const targetSize =
    16 * (typeof window === "undefined" ? 1 : window.devicePixelRatio);
  const [selectedUrl, setSelectedUrl] = useState<string | null>(() =>
    cachedImageUrl(urls, targetSize),
  );
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  useEffect(() => {
    if (urls.length < 2) return;
    let bestSize = 0;
    let bestUrl: string | null = null;
    let cancelled = false;
    const select = (url: string, size: number) => {
      if (cancelled) return;
      if (
        isBetterSize(size, bestSize, targetSize) ||
        (size > 0 &&
          size === bestSize &&
          bestUrl !== null &&
          urls.indexOf(url) < urls.indexOf(bestUrl))
      ) {
        bestSize = size;
        bestUrl = url;
        setSelectedUrl(url);
      }
    };
    const images: HTMLImageElement[] = [];
    for (const url of urls) {
      const cachedSize = imageSizes.get(url);
      if (cachedSize !== undefined) {
        rememberImageSize(url, cachedSize);
        select(url, cachedSize);
        continue;
      }
      const image = new Image();
      image.referrerPolicy = "no-referrer";
      image.onload = () => {
        if (cancelled) return;
        const size = Math.min(image.naturalWidth, image.naturalHeight);
        rememberImageSize(url, size);
        select(url, size);
      };
      image.src = url;
      images.push(image);
    }
    return () => {
      cancelled = true;
      for (const image of images) image.onload = null;
    };
  }, [urls, targetSize]);

  if (selectedUrl === null || selectedUrl === failedUrl) {
    return (
      <Icon name="Globe" className={cn("size-3.5", className)} aria-hidden />
    );
  }
  return (
    <img
      src={selectedUrl}
      alt=""
      className={cn("size-3.5 shrink-0 object-contain", className)}
      referrerPolicy="no-referrer"
      onLoad={(event) =>
        rememberImageSize(
          selectedUrl,
          Math.min(
            event.currentTarget.naturalWidth,
            event.currentTarget.naturalHeight,
          ),
        )
      }
      onError={() => {
        imageSizes.delete(selectedUrl);
        setFailedUrl(selectedUrl);
      }}
    />
  );
}
