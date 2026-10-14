import { useEffect, useState } from "react";
import { getActiveSealedConnection } from "./status";

const objectUrls = new Map<string, { url: string; refs: number }>();
const pending = new Map<string, Promise<string>>();

function sameOriginApiUrl(url: string): boolean {
  if (typeof location === "undefined") return false;
  try {
    const parsed = new URL(url, location.href);
    return (
      parsed.origin === location.origin && parsed.pathname.startsWith("/api/")
    );
  } catch {
    return false;
  }
}

export function needsSealedMedia(
  url: string | null | undefined,
): url is string {
  return (
    typeof url === "string" &&
    url.length > 0 &&
    !url.startsWith("blob:") &&
    !url.startsWith("data:") &&
    getActiveSealedConnection() !== null &&
    sameOriginApiUrl(url)
  );
}

export async function acquireSealedMediaUrl(url: string): Promise<string> {
  const cached = objectUrls.get(url);
  if (cached !== undefined) {
    cached.refs += 1;
    return cached.url;
  }
  const inFlight = pending.get(url);
  if (inFlight !== undefined) {
    const objectUrl = await inFlight;
    const entry = objectUrls.get(url);
    if (entry !== undefined) entry.refs += 1;
    return objectUrl;
  }
  const load = (async () => {
    const response = await fetch(url, { credentials: "same-origin" });
    if (!response.ok) {
      throw new Error(`sealed media load failed with HTTP ${response.status}`);
    }
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    objectUrls.set(url, { url: objectUrl, refs: 1 });
    return objectUrl;
  })().finally(() => {
    pending.delete(url);
  });
  pending.set(url, load);
  return load;
}

export function releaseSealedMediaUrl(url: string): void {
  const entry = objectUrls.get(url);
  if (entry === undefined) return;
  entry.refs -= 1;
  if (entry.refs > 0) return;
  objectUrls.delete(url);
  URL.revokeObjectURL(entry.url);
}

export type SealedMediaState =
  | { kind: "ready"; url: string }
  | { kind: "loading" }
  | { kind: "error"; error: string };

export function useSealedMediaUrl(
  url: string | null | undefined,
): SealedMediaState {
  const sealed = needsSealedMedia(url);
  const [state, setState] = useState<SealedMediaState>(() =>
    sealed ? { kind: "loading" } : { kind: "ready", url: url ?? "" },
  );
  useEffect(() => {
    if (!needsSealedMedia(url)) {
      setState({ kind: "ready", url: url ?? "" });
      return;
    }
    let active = true;
    let acquired = false;
    setState({ kind: "loading" });
    acquireSealedMediaUrl(url).then(
      (objectUrl) => {
        if (active) {
          acquired = true;
          setState({ kind: "ready", url: objectUrl });
        } else {
          releaseSealedMediaUrl(url);
        }
      },
      (error: unknown) => {
        if (active) {
          setState({
            kind: "error",
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
    );
    return () => {
      active = false;
      if (acquired) releaseSealedMediaUrl(url);
    };
  }, [url]);
  return state;
}

export function openSealedLink(
  event: { preventDefault(): void },
  href: string | null | undefined,
  fileName?: string,
): void {
  if (!needsSealedMedia(href)) return;
  event.preventDefault();
  void acquireSealedMediaUrl(href).then(
    (objectUrl) => {
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      if (fileName !== undefined) anchor.download = fileName;
      anchor.target = "_blank";
      anchor.rel = "noreferrer";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => releaseSealedMediaUrl(href), 60_000);
    },
    () => undefined,
  );
}

const SWEPT_ATTRIBUTES = ["src", "poster", "srcset", "href"] as const;

function srcsetNeedsSealing(value: string): boolean {
  return value
    .split(",")
    .map((candidate) => candidate.trim().split(/\s+/u)[0] ?? "")
    .some((url) => needsSealedMedia(url));
}
const SWEPT_TAGS = new Set([
  "IMG",
  "VIDEO",
  "AUDIO",
  "SOURCE",
  "IFRAME",
  "EMBED",
]);
const SWEEP_MARK = "data-bb-sealed-src";
const sweptSources = new Map<Element, Map<string, string>>();

function releaseElement(element: Element): void {
  const owned = sweptSources.get(element);
  if (owned === undefined) return;
  sweptSources.delete(element);
  for (const url of owned.values()) releaseSealedMediaUrl(url);
}

function releaseTree(node: Node): void {
  if (node.nodeType !== 1) return;
  const element = node as Element;
  releaseElement(element);
  for (const child of element.querySelectorAll(
    "img,video,audio,source,iframe,embed",
  )) {
    releaseElement(child);
  }
}

function sweepElement(element: Element): void {
  if (!SWEPT_TAGS.has(element.tagName)) return;
  for (const attribute of SWEPT_ATTRIBUTES) {
    if (attribute === "href") continue;
    const value = element.getAttribute(attribute);
    if (
      value === null ||
      element.getAttribute(`${SWEEP_MARK}-${attribute}`) === value
    ) {
      continue;
    }
    if (attribute === "srcset") {
      if (value.length > 0 && srcsetNeedsSealing(value)) {
        element.setAttribute(`${SWEEP_MARK}-${attribute}`, "");
        element.setAttribute(attribute, "");
      }
      continue;
    }
    if (!needsSealedMedia(value)) continue;
    const owned = sweptSources.get(element) ?? new Map<string, string>();
    const previous = owned.get(attribute);
    if (previous !== undefined) {
      owned.delete(attribute);
      releaseSealedMediaUrl(previous);
    }
    sweptSources.set(element, owned);
    element.setAttribute(`${SWEEP_MARK}-${attribute}`, value);
    element.setAttribute(attribute, "");
    void acquireSealedMediaUrl(value).then(
      (objectUrl) => {
        if (element.getAttribute(`${SWEEP_MARK}-${attribute}`) === value) {
          owned.set(attribute, value);
          element.setAttribute(attribute, objectUrl);
        } else {
          releaseSealedMediaUrl(value);
        }
      },
      () => undefined,
    );
  }
}

function interceptSealedLinkClick(event: MouseEvent): void {
  if (event.defaultPrevented || event.button === 2) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  const anchor = target.closest("a[href]");
  if (!(anchor instanceof HTMLAnchorElement)) return;
  const href = anchor.getAttribute("href");
  if (!needsSealedMedia(href)) return;
  openSealedLink(
    event,
    href,
    anchor.download.length > 0 ? anchor.download : undefined,
  );
}

export function installSealedMediaSweep(root: Node = document): () => void {
  const clickRoot = root instanceof Document ? root : root.ownerDocument;
  clickRoot?.addEventListener("click", interceptSealedLinkClick, true);
  clickRoot?.addEventListener("auxclick", interceptSealedLinkClick, true);
  const sweep = (node: Node) => {
    if (node instanceof Element) {
      sweepElement(node);
      for (const child of node.querySelectorAll(
        "img,video,audio,source,iframe,embed",
      )) {
        sweepElement(child);
      }
    }
  };
  sweep(root);
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (
        mutation.type === "attributes" &&
        mutation.target instanceof Element
      ) {
        sweepElement(mutation.target);
      }
      for (const added of mutation.addedNodes) sweep(added);
      for (const removed of mutation.removedNodes) releaseTree(removed);
    }
  });
  observer.observe(root, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: [...SWEPT_ATTRIBUTES],
  });
  return () => {
    observer.disconnect();
    for (const element of [...sweptSources.keys()]) releaseElement(element);
    clickRoot?.removeEventListener("click", interceptSealedLinkClick, true);
    clickRoot?.removeEventListener("auxclick", interceptSealedLinkClick, true);
  };
}

export function useSealedMediaSrc(
  url: string | null | undefined,
): string | null {
  const state = useSealedMediaUrl(url);
  return state.kind === "ready" && state.url !== "" ? state.url : null;
}
