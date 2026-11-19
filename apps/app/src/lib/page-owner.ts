import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { z } from "zod";
import type {
  ExperimentalPageChrome,
  ExperimentalPageLocation,
  ExperimentalPageRoute,
} from "@get-bb/plugin-sdk";
import { createLastKnownCache } from "@/lib/last-known-cache";
import {
  usePluginFrontendBootComplete,
  usePluginFrontendsSettled,
} from "@/lib/plugin-frontend-boot-state";
import {
  useBuiltinPluginIds,
  usePluginSlotKind,
  type PluginPageSlot,
} from "@/lib/plugin-slots";
import { CORE_PAGE_PLUGIN_ID } from "@/views/core-pages";
import { paneContentForPathname } from "@/views/thread-detail/splitThreadNavigation";

const rememberedPageOwnerSchema = z.object({
  pluginId: z.string().min(1),
  id: z.string().min(1),
  routes: z.array(z.enum(["home", "thread"])),
  chrome: z.object({ sidebar: z.enum(["shown", "hidden"]) }),
});

type RememberedPageOwner = z.infer<typeof rememberedPageOwnerSchema>;

const pageOwnerCache = createLastKnownCache({
  prefix: "bb.page-owners",
  version: "1",
  schema: z.array(rememberedPageOwnerSchema),
});
const PAGE_OWNER_CACHE_KEY = pageOwnerCache.key("all");

let rememberedAtStartup: readonly RememberedPageOwner[] | null = null;

function readRememberedPageOwners(): readonly RememberedPageOwner[] {
  rememberedAtStartup ??= pageOwnerCache.read(PAGE_OWNER_CACHE_KEY) ?? [];
  return rememberedAtStartup;
}

export function resetRememberedPageOwnersForTest(): void {
  rememberedAtStartup = null;
}

export function rememberedPageOwnerPluginIds(pathname: string): string[] {
  const route = pageLocationForPathname(pathname)?.kind;
  if (route === undefined) return [];
  return readRememberedPageOwners()
    .filter((owner) => owner.routes.includes(route))
    .map((owner) => owner.pluginId);
}

export type PageOwner =
  | { kind: "page"; slot: PluginPageSlot }
  | { kind: "pending"; chrome: ExperimentalPageChrome };

function isCoreSlot(slot: PluginPageSlot): boolean {
  return slot.pluginId === CORE_PAGE_PLUGIN_ID;
}

export function resolvePageSlot(
  pages: readonly PluginPageSlot[],
  route: ExperimentalPageRoute | null,
  builtinPluginIds: ReadonlySet<string>,
): PluginPageSlot {
  const core = pages.find(isCoreSlot);
  if (core === undefined) {
    throw new Error("bb's core page registration is missing");
  }
  if (route === null) return core;
  const claims = pages.filter(
    (slot) => !isCoreSlot(slot) && slot.routes.includes(route),
  );
  return (
    claims.find((slot) => !builtinPluginIds.has(slot.pluginId)) ??
    claims[0] ??
    core
  );
}

export function resolvePageOwner({
  pages,
  route,
  builtinPluginIds,
  settled,
  remembered,
}: {
  pages: readonly PluginPageSlot[];
  route: ExperimentalPageRoute | null;
  builtinPluginIds: ReadonlySet<string>;
  settled: boolean;
  remembered: readonly RememberedPageOwner[];
}): PageOwner {
  const slot = resolvePageSlot(pages, route, builtinPluginIds);
  if (!isCoreSlot(slot) || settled || route === null) {
    return { kind: "page", slot };
  }
  const awaited = remembered.find((owner) => owner.routes.includes(route));
  return awaited === undefined
    ? { kind: "page", slot }
    : { kind: "pending", chrome: awaited.chrome };
}

export function pageLocationForPathname(
  pathname: string,
): ExperimentalPageLocation | null {
  const content = paneContentForPathname(pathname);
  if (content?.kind === "new-thread") return { kind: "home" };
  if (content?.kind === "thread") {
    return {
      kind: "thread",
      projectId: content.projectId,
      threadId: content.threadId,
    };
  }
  return null;
}

export function usePageLocation(): ExperimentalPageLocation | null {
  return pageLocationForPathname(useLocation().pathname);
}

export function usePageOwner(route: ExperimentalPageRoute | null): PageOwner {
  const pages = usePluginSlotKind("pages");
  const builtinPluginIds = useBuiltinPluginIds();
  const settled = usePluginFrontendsSettled();
  return resolvePageOwner({
    pages,
    route,
    builtinPluginIds,
    settled,
    remembered: settled ? [] : readRememberedPageOwners(),
  });
}

export function usePageChrome(
  route: ExperimentalPageRoute | null,
): ExperimentalPageChrome | null {
  const owner = usePageOwner(route);
  if (owner.kind === "pending") return owner.chrome;
  return route === null ? null : owner.slot.chrome;
}

export function rememberPageOwners(
  bootComplete: boolean,
  pages: readonly PluginPageSlot[],
): void {
  if (!bootComplete) return;
  pageOwnerCache.write(
    PAGE_OWNER_CACHE_KEY,
    pages
      .filter((slot) => !isCoreSlot(slot))
      .map((slot) => ({
        pluginId: slot.pluginId,
        id: slot.id,
        routes: [...slot.routes],
        chrome: { sidebar: slot.chrome.sidebar },
      })),
  );
}

export function useRememberPageOwners(): void {
  const bootComplete = usePluginFrontendBootComplete();
  const pages = usePluginSlotKind("pages");
  useEffect(() => {
    rememberPageOwners(bootComplete, pages);
  }, [bootComplete, pages]);
}
