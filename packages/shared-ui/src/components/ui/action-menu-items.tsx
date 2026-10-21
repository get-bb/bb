import type { ReactNode } from "react";
import { Icon, type IconName } from "./icon";
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
} from "./context-menu";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
} from "./dropdown-menu";
import { cn } from "../../lib/utils";

export type ActionMenuSurface = "context" | "dropdown";

interface ActionMenuShortcut {
  label: string;
  ariaKeyshortcuts: string;
}

interface ActionMenuItemProps {
  children: ReactNode;
  variant?: "default" | "destructive";
  disabled?: boolean;
  icon: IconName;
  href?: string;
  onSelect?: (event: Event) => void;
  shortcut?: ActionMenuShortcut;
  surface: ActionMenuSurface;
}

interface ActionMenuSeparatorProps {
  surface: ActionMenuSurface;
}

export function ActionMenuItem({
  children,
  variant,
  disabled,
  icon,
  href,
  onSelect,
  shortcut,
  surface,
}: ActionMenuItemProps) {
  const Shortcut =
    surface === "context" ? ContextMenuShortcut : DropdownMenuShortcut;
  const content = (
    <>
      <Icon name={icon} aria-hidden="true" />
      {children}
      {shortcut === undefined ? null : (
        <Shortcut aria-hidden="true">{shortcut.label}</Shortcut>
      )}
    </>
  );
  const body = href === undefined ? content : <a href={href}>{content}</a>;

  if (surface === "context") {
    return (
      <ContextMenuItem
        asChild={href !== undefined}
        className={cn(
          variant === "destructive" &&
            "text-destructive focus:bg-destructive/15 focus:text-destructive data-[last-hovered]:bg-destructive/15 data-[last-hovered]:text-destructive",
        )}
        disabled={disabled}
        aria-keyshortcuts={shortcut?.ariaKeyshortcuts}
        onSelect={onSelect}
      >
        {body}
      </ContextMenuItem>
    );
  }

  return (
    <DropdownMenuItem
      asChild={href !== undefined}
      variant={variant}
      disabled={disabled}
      aria-keyshortcuts={shortcut?.ariaKeyshortcuts}
      onSelect={onSelect}
    >
      {body}
    </DropdownMenuItem>
  );
}

export function ActionMenuSeparator({ surface }: ActionMenuSeparatorProps) {
  return surface === "context" ? (
    <ContextMenuSeparator />
  ) : (
    <DropdownMenuSeparator />
  );
}
