import { useMemo } from "react";
import { createStore, Provider as JotaiProvider, useAtomValue } from "jotai";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";
import { SidebarGroupOptionsMenu, SidebarSortOptionsMenu } from "./ProjectList";
import {
  sidebarChronologicalSortAtom,
  sidebarOrganizationModeAtom,
  sidebarSortDirectionAtom,
} from "./sidebarCollapsedAtoms";

export default {
  title: "sidebar/View options menu",
};

// Live readout of the atoms the menus drive, so the effect of each click is
// visible even after a menu closes.
function StateReadout() {
  const organizationMode = useAtomValue(sidebarOrganizationModeAtom);
  const sort = useAtomValue(sidebarChronologicalSortAtom);
  const direction = useAtomValue(sidebarSortDirectionAtom);
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
      <dt className="text-muted-foreground">group</dt>
      <dd className="font-mono">{organizationMode}</dd>
      <dt className="text-muted-foreground">sort</dt>
      <dd className="font-mono">{sort}</dd>
      <dt className="text-muted-foreground">direction</dt>
      <dd className="font-mono">{direction}</dd>
    </dl>
  );
}

// The menus write to global (atomWithStorage) atoms. A story-local Jotai store
// keeps each mount self-contained and seeded with the same defaults the app
// ships, instead of inheriting whatever the last Ladle session left behind.
function InteractiveMenus() {
  const store = useMemo(() => {
    const next = createStore();
    next.set(sidebarOrganizationModeAtom, "project");
    next.set(sidebarChronologicalSortAtom, "updated");
    next.set(sidebarSortDirectionAtom, "desc");
    return next;
  }, []);

  return (
    <JotaiProvider store={store}>
      <div className="flex w-72 flex-col gap-4 rounded-md bg-sidebar p-4 text-sidebar-foreground">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">
            Projects
          </span>
          <div className="flex items-center gap-1">
            <SidebarGroupOptionsMenu />
            <SidebarSortOptionsMenu />
          </div>
        </div>
        <StateReadout />
      </div>
    </JotaiProvider>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="interactive"
        hint="click an icon to open · pick a sort field, click it again to flip ↑/↓"
      >
        <InteractiveMenus />
      </StoryRow>
    </StoryCard>
  );
}
