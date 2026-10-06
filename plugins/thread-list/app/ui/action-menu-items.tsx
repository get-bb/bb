import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/ui/icon";
import {
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export type ActionMenuSurface = "context" | "dropdown";

interface ActionMenuItemProps {
  children: ReactNode;
  variant?: "default" | "destructive";
  icon: IconName;
  href?: string;
  onSelect?: (event: Event) => void;
  surface: ActionMenuSurface;
}

interface ActionMenuSeparatorProps {
  surface: ActionMenuSurface;
}

export function ActionMenuItem({
  children,
  variant,
  icon,
  href,
  onSelect,
  surface,
}: ActionMenuItemProps) {
  const content = (
    <>
      <Icon name={icon} aria-hidden="true" />
      {children}
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
