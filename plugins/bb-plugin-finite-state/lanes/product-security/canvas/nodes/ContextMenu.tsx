import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { useArchitectureSelection, wp35MutationStubs } from "./selection.js";

export function ContextMenu(): React.JSX.Element | null {
  const selection = useArchitectureSelection();
  const menu = selection.menu;
  if (!menu) return null;
  return (
    <div
      aria-label="Architecture context menu"
      className="fixed z-50 w-52 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
      onKeyDown={(event) => {
        if (event.key === "Escape") selection.closeMenu();
      }}
      role="menu"
      style={{ left: menu.x, top: menu.y }}
      tabIndex={-1}
    >
      <Button
        className="w-full justify-start"
        onClick={() => {
          selection.setSelectedIds([menu.targetId]);
          selection.onFocusRoute(menu.targetKind, menu.targetId);
          selection.closeMenu();
        }}
        role="menuitem"
        size="sm"
        variant="ghost"
      >
        <Icon aria-hidden="true" name="Eye" /> Inspect
      </Button>
      <Button
        className="w-full justify-start"
        disabled
        onClick={wp35MutationStubs.duplicate}
        role="menuitem"
        size="sm"
        variant="ghost"
      >
        <Icon aria-hidden="true" name="Copy" /> Duplicate in WP-35
      </Button>
      <Button
        className="w-full justify-start"
        disabled
        onClick={wp35MutationStubs.remove}
        role="menuitem"
        size="sm"
        variant="ghost"
      >
        <Icon aria-hidden="true" name="Trash2" /> Delete in WP-35
      </Button>
    </div>
  );
}
