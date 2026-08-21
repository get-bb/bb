import {
  normalizeSidebarSectionOrder,
  type LegacySidebarEntityAnchor,
  type SidebarSectionId,
} from "@bb/client-core";
import { useEffect, useMemo } from "react";
import type { SidebarModel } from "./sidebar-model";
import type {
  SidebarOrganizeMode,
  SidebarPreferences,
} from "./sidebar-preferences";
import type { SidebarPreferenceActions } from "./use-sidebar-preferences";

/**
 * Web `useSidebarModeSectionOrder`: the stored order of each mode can still
 * hold the old aggregate token ("projects" / "sections" / "machines") that
 * stood for every entity section at once.
 */
const LEGACY_ENTITY_ANCHOR: Record<
  SidebarOrganizeMode,
  LegacySidebarEntityAnchor
> = {
  project: "projects",
  manual: "sections",
  machine: "machines",
};

/**
 * The top-level sections of a model in display order: the stored order
 * reconciled with the live groups (new sections join after the last entity;
 * Pinned stays in the order even while nothing is pinned so its placement
 * survives). Pure; the hook below persists the result back like the web.
 */
export function resolveSidebarSectionOrder(
  model: Pick<SidebarModel, "organize" | "groups">,
  storedOrder: readonly string[],
): SidebarSectionId[] {
  return normalizeSidebarSectionOrder({
    storedOrder,
    entitySectionIds: model.groups
      .map((group) => group.id)
      .filter(
        (id): id is Exclude<SidebarSectionId, "threads"> => id !== "threads",
      ),
    legacyEntityAnchor: LEGACY_ENTITY_ANCHOR[model.organize],
    hasPinnedSection: true,
    hasThreadsSection: true,
  });
}

export interface SidebarSectionOrderEntry {
  id: SidebarSectionId;
  label: string;
  threadCount: number;
}

/**
 * The sections the user can reorder, labelled, in the given order. Pinned is
 * listed only while something is pinned (it is hidden in the list too);
 * `mergeHiddenSectionOrder` keeps its stored slot across a reorder.
 */
export function listSidebarSectionOrderEntries(
  model: SidebarModel,
  order: readonly SidebarSectionId[],
): SidebarSectionOrderEntry[] {
  const groupsById = new Map(model.groups.map((group) => [group.id, group]));
  const entries: SidebarSectionOrderEntry[] = [];
  for (const id of order) {
    if (id === "pinned") {
      if (model.pinned) {
        entries.push({
          id,
          label: "Pinned",
          threadCount: model.pinned.threads.length,
        });
      }
      continue;
    }
    const group = groupsById.get(id);
    if (!group) continue;
    entries.push({ id, label: group.label, threadCount: group.threads.length });
  }
  return entries;
}

/**
 * A reorder of the visible sections applied to the full order: sections the
 * user could not see (hidden Pinned) stay at their previous index, so moving
 * what is visible never silently relocates what is not.
 */
export function mergeHiddenSectionOrder(
  fullOrder: readonly SidebarSectionId[],
  visibleOrder: readonly SidebarSectionId[],
): SidebarSectionId[] {
  const visible = new Set(visibleOrder);
  const merged: SidebarSectionId[] = [];
  let nextVisible = 0;
  for (const id of fullOrder) {
    if (visible.has(id)) {
      const replacement = visibleOrder[nextVisible];
      nextVisible += 1;
      if (replacement !== undefined) merged.push(replacement);
    } else {
      merged.push(id);
    }
  }
  return merged;
}

function haveSameOrder(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((id, index) => id === right[index])
  );
}

/**
 * The resolved section order for the model's organize mode. Once the model is
 * ready, the normalized order is written back so the stored value stops
 * carrying legacy anchors and stale ids (web `usePersistedSidebarSectionOrder`).
 */
export function useSidebarSectionOrder(
  model: SidebarModel,
  preferences: SidebarPreferences,
  actions: Pick<SidebarPreferenceActions, "setSectionOrder">,
): SidebarSectionId[] {
  const storedOrder = preferences.sectionOrder[model.organize];
  const order = useMemo(
    () => resolveSidebarSectionOrder(model, storedOrder),
    [model, storedOrder],
  );
  const { setSectionOrder } = actions;
  const organize = model.organize;
  const isReady = model.isReady;
  useEffect(() => {
    if (!isReady || haveSameOrder(storedOrder, order)) return;
    setSectionOrder(organize, order);
  }, [isReady, order, organize, setSectionOrder, storedOrder]);
  return order;
}
