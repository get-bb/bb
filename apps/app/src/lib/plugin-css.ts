import { HOST_TAILWIND_VERSION } from "@bb/plugin-build/host-tailwind-version";
import { useInsertionEffect } from "react";

const CSS_MARKER = "data-bb-plugin-css";
const CSS_PRELOAD_MARKER = "data-bb-plugin-css-preload";
const CSS_PREFETCH_MARKER = "data-bb-plugin-css-prefetch";
const CSS_RELEASE_GRACE_MS = 1_500;

interface PluginCssRecord {
  consumers: number;
  cleanupEpoch: number;
  cleanupTimer: ReturnType<typeof setTimeout> | null;
  loadedUrl: string | null;
  pendingStylesheet: HTMLLinkElement | null;
  preload: HTMLLinkElement | null;
  stylesheet: HTMLLinkElement | null;
  url: string | null;
  settleWaiters: Array<{ url: string; resolve: () => void }>;
}

const recordsByPluginId = new Map<string, PluginCssRecord>();

function recordFor(pluginId: string): PluginCssRecord {
  const existing = recordsByPluginId.get(pluginId);
  if (existing !== undefined) return existing;
  const created: PluginCssRecord = {
    consumers: 0,
    cleanupEpoch: 0,
    cleanupTimer: null,
    loadedUrl: null,
    pendingStylesheet: null,
    preload: null,
    stylesheet: null,
    url: null,
    settleWaiters: [],
  };
  recordsByPluginId.set(pluginId, created);
  return created;
}

function linkUrl(link: HTMLLinkElement | null): string | null {
  return link?.getAttribute("href") ?? null;
}

function removeLink(link: HTMLLinkElement | null): void {
  link?.remove();
}

function warnLoadFailure(pluginId: string, url: string): void {
  console.warn(`bb plugin "${pluginId}": failed to load stylesheet ${url}`);
}

function settle(
  record: PluginCssRecord,
  matches: (url: string) => boolean,
): void {
  const settled = record.settleWaiters.filter((waiter) => matches(waiter.url));
  record.settleWaiters = record.settleWaiters.filter(
    (waiter) => !matches(waiter.url),
  );
  for (const waiter of settled) waiter.resolve();
}

function whenStylesheetSettled(
  record: PluginCssRecord,
  url: string,
): Promise<void> {
  if (record.loadedUrl === url) return Promise.resolve();
  return new Promise((resolve) => {
    record.settleWaiters.push({ url, resolve });
  });
}

function startPreload(
  pluginId: string,
  record: PluginCssRecord,
  url: string,
  speculative = false,
): void {
  if (record.loadedUrl === url || linkUrl(record.preload) === url) return;
  removeLink(record.preload);
  const link = document.createElement("link");
  link.rel = "preload";
  link.as = "style";
  if (speculative) link.fetchPriority = "low";
  link.href = url;
  link.setAttribute(CSS_PRELOAD_MARKER, pluginId);
  record.preload = link;
  link.onload = () => {
    link.remove();
    if (record.preload === link) record.preload = null;
    if (record.url === url) {
      record.loadedUrl = url;
      if (record.consumers > 0) activateStylesheet(pluginId, record, url);
    }
    settle(record, (waiting) => waiting === url);
  };
  link.onerror = () => {
    link.remove();
    if (record.preload === link) record.preload = null;
    if (record.url === url) warnLoadFailure(pluginId, url);
    settle(record, (waiting) => waiting === url);
  };
  document.head.appendChild(link);
}

function activateStylesheet(
  pluginId: string,
  record: PluginCssRecord,
  url: string,
): void {
  if (linkUrl(record.pendingStylesheet) === url) return;
  if (linkUrl(record.stylesheet) === url) {
    record.loadedUrl = url;
    removeLink(record.preload);
    record.preload = null;
    return;
  }

  removeLink(record.preload);
  record.preload = null;
  removeLink(record.pendingStylesheet);

  const previous = record.stylesheet;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = url;
  link.setAttribute(CSS_MARKER, pluginId);
  record.pendingStylesheet = link;
  link.onload = () => {
    if (record.pendingStylesheet === link && record.url === url) {
      previous?.remove();
      record.stylesheet = link;
      record.pendingStylesheet = null;
      record.loadedUrl = url;
    } else {
      link.remove();
      if (record.pendingStylesheet === link) record.pendingStylesheet = null;
    }
    settle(record, (waiting) => waiting === url);
  };
  link.onerror = () => {
    link.remove();
    if (record.pendingStylesheet === link) record.pendingStylesheet = null;
    if (record.url === url) warnLoadFailure(pluginId, url);
    settle(record, (waiting) => waiting === url);
  };
  document.head.appendChild(link);
}

function deactivateStylesheet(record: PluginCssRecord): void {
  removeLink(record.pendingStylesheet);
  removeLink(record.stylesheet);
  record.pendingStylesheet = null;
  record.stylesheet = null;
}

function cancelDeferredDeactivate(record: PluginCssRecord): void {
  record.cleanupEpoch += 1;
  if (record.cleanupTimer !== null) {
    clearTimeout(record.cleanupTimer);
    record.cleanupTimer = null;
  }
}

function deactivateAfterFinalRelease(
  pluginId: string,
  record: PluginCssRecord,
): void {
  cancelDeferredDeactivate(record);
  const cleanupEpoch = record.cleanupEpoch;
  record.cleanupTimer = setTimeout(() => {
    record.cleanupTimer = null;
    if (record.cleanupEpoch !== cleanupEpoch || record.consumers > 0) return;
    deactivateStylesheet(record);
    if (record.url === null) {
      recordsByPluginId.delete(pluginId);
      return;
    }
    startPreload(pluginId, record, record.url, true);
  }, CSS_RELEASE_GRACE_MS);
}

function hostTailwindUrl(url: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}host-tailwind=${HOST_TAILWIND_VERSION}`;
}

export function prefetchPluginCss(url: string): void {
  const link = document.createElement("link");
  link.rel = "preload";
  link.as = "style";
  link.href = hostTailwindUrl(url);
  link.setAttribute(CSS_PREFETCH_MARKER, "");
  link.onload = () => link.remove();
  link.onerror = () => link.remove();
  document.head.appendChild(link);
}

export function applyPluginCss(
  pluginId: string,
  url: string | null,
): Promise<void> {
  const record = recordFor(pluginId);
  if (url === null) {
    cancelDeferredDeactivate(record);
    record.url = null;
    record.loadedUrl = null;
    removeLink(record.preload);
    record.preload = null;
    deactivateStylesheet(record);
    settle(record, () => true);
    if (record.consumers === 0) recordsByPluginId.delete(pluginId);
    return Promise.resolve();
  }

  url = hostTailwindUrl(url);
  if (record.url === url) {
    if (record.consumers > 0) activateStylesheet(pluginId, record, url);
    else startPreload(pluginId, record, url);
    return whenStylesheetSettled(record, url);
  }

  cancelDeferredDeactivate(record);
  record.url = url;
  record.loadedUrl = linkUrl(record.stylesheet) === url ? url : null;
  removeLink(record.preload);
  record.preload = null;
  settle(record, (waiting) => waiting !== url);
  if (record.consumers > 0) {
    activateStylesheet(pluginId, record, url);
  } else {
    deactivateStylesheet(record);
    startPreload(pluginId, record, url);
  }
  return whenStylesheetSettled(record, url);
}

export function retainPluginCss(pluginId: string): () => void {
  const record = recordFor(pluginId);
  cancelDeferredDeactivate(record);
  record.consumers += 1;
  if (record.url !== null) activateStylesheet(pluginId, record, record.url);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    record.consumers = Math.max(0, record.consumers - 1);
    if (record.consumers === 0) {
      deactivateAfterFinalRelease(pluginId, record);
    }
  };
}

export function usePluginCss(pluginId: string | null): void {
  useInsertionEffect(
    () => (pluginId === null ? undefined : retainPluginCss(pluginId)),
    [pluginId],
  );
}

export function resetPluginCssForTest(): void {
  for (const record of recordsByPluginId.values()) {
    cancelDeferredDeactivate(record);
    removeLink(record.preload);
    deactivateStylesheet(record);
    settle(record, () => true);
  }
  recordsByPluginId.clear();
  for (const link of document.head.querySelectorAll(
    `link[${CSS_MARKER}], link[${CSS_PRELOAD_MARKER}], link[${CSS_PREFETCH_MARKER}]`,
  )) {
    link.remove();
  }
}
