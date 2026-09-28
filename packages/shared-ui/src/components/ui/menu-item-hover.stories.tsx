import { MENU_ITEM_LAST_HOVERED_CLASS, MenuHoverProvider, useMenuItemHover } from "./menu-item-hover.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/MenuItemHover",
};

function HoverTrackedItem({ label }: { label: string }) {
  const { hoverProps } = useMenuItemHover();
  return (
    <button
      type="button"
      className={`w-full rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-state-hover ${MENU_ITEM_LAST_HOVERED_CLASS}`}
      {...hoverProps}
    >
      {label}
    </button>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="Last-hovered highlight"
        hint="apps/app/src/components/pickers/BranchPicker.tsx — BranchPickerRow uses this hook internally; here it's shown directly"
      >
        <MenuHoverProvider>
          <div className="w-56 rounded-md border border-border p-1">
            <HoverTrackedItem label="Rename" />
            <HoverTrackedItem label="Archive" />
            <HoverTrackedItem label="Delete" />
          </div>
        </MenuHoverProvider>
      </StoryRow>
    </StoryCard>
  );
}
