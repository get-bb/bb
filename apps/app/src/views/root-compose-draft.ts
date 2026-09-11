import type { DraftContent, DraftOptions } from "@bb/server-contract";
import type {
  NewThreadComposerSeed,
  NewThreadComposerSubmission,
} from "@/components/promptbox/NewThreadComposer";
import { parseDraftRouteId } from "@/lib/draft-route";
import {
  replaceDraftPaneContent,
  type PaneContent,
  type SplitLayout,
} from "@/lib/split-layout";

export interface RootDraftOrigin {
  draftId: string;
  paneId: string | null;
  hadLayout: boolean;
}

export function rootComposeRouteDraftId(location: {
  pathname: string;
  search: string;
}): string | null {
  return location.pathname === "/" ? parseDraftRouteId(location.search) : null;
}

export function ownsRootComposeLocation(
  draftId: string,
  isFocused: boolean,
  location: { pathname: string; search: string },
): boolean {
  return isFocused && rootComposeRouteDraftId(location) === draftId;
}

export function rootDraftComposerSeed(
  options: DraftOptions,
): NewThreadComposerSeed {
  return {
    providerId: options.providerId ?? undefined,
    model: options.model ?? undefined,
    reasoningLevel: options.reasoningLevel ?? undefined,
    serviceTier: options.serviceTier ?? undefined,
    permissionMode: options.permissionMode ?? undefined,
    environment: options.environment ?? undefined,
  };
}

export function rootDraftSubmissionContent(
  content: DraftContent,
  request: NewThreadComposerSubmission,
): DraftContent {
  return {
    ...content,
    options: {
      ...content.options,
      providerId: request.providerId,
      model: request.model,
      reasoningLevel: request.reasoningLevel,
      serviceTier: request.serviceTier ?? null,
      permissionMode: request.permissionMode,
      environment:
        request.environment.type === "provider"
          ? {
              ...request.environment,
              machine: request.environment.machine ?? null,
            }
          : request.environment,
      sendAt: request.sendAt ?? null,
    },
  };
}

export function replaceRootDraftOrigin({
  layout,
  origin,
  destination,
  currentRouteDraftId,
}: {
  layout: SplitLayout | null;
  origin: RootDraftOrigin;
  destination: PaneContent;
  currentRouteDraftId: string | null;
}): { layout: SplitLayout | null; navigate: boolean } {
  if (!origin.hadLayout) {
    return {
      layout,
      navigate: layout === null && currentRouteDraftId === origin.draftId,
    };
  }
  if (layout === null || origin.paneId === null) {
    return { layout, navigate: false };
  }
  const next = replaceDraftPaneContent(
    layout,
    origin.paneId,
    origin.draftId,
    destination,
  );
  return {
    layout: next,
    navigate:
      next !== layout &&
      layout.focusedPaneId === origin.paneId &&
      currentRouteDraftId === origin.draftId,
  };
}
